require('dotenv').config();
const express = require('express');
const cors = require('cors');
const serverless = require('serverless-http');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const { normalizeId, checkCompleteness } = require('./completeness-service');
const completenessConfig = require('./completeness-config.json');
const { createQuestionnairePool } = require('./completeness-postgres');
const questionnairePool = createQuestionnairePool();

const app = express();
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'ap-southeast-1' });
const mongoUri = process.env.MONGO_URI;
const mongoDb = process.env.MONGO_DB || 'test';
const mongoCollection = process.env.MONGO_COLL || 'items';
const caPath = process.env.CA_PATH || path.join(__dirname, 'mongodb-ca.pem');

if (!mongoUri) {
  console.error('Missing MONGO_URI in environment.');
  process.exit(1);
}

const clientOptions = {
  directConnection: true,
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 10000,
};

if (caPath) {
  const resolved = path.resolve(caPath);
  console.log(`[Diagnostic] CA Path resolved to: ${resolved}`);
  const exists = fs.existsSync(resolved);
  console.log(`[Diagnostic] CA Path exists: ${exists}`);
  if (!exists) {
    console.warn(`CA_PATH file not found: ${resolved}. Lambda looks in /var/task/ by default.`);
  } else {
    try {
      const stats = fs.statSync(resolved);
      const contentSample = fs.readFileSync(resolved, 'utf8').substring(0, 30);
      console.log(`[Diagnostic] CA Path size: ${stats.size} bytes. Content sample: "${contentSample.replace(/\n/g, '\\n')}"`);
    } catch (e) {
      console.error(`[Diagnostic] Error reading CA file: ${e.message}`);
    }
    clientOptions.tlsCAFile = resolved;
    clientOptions.tls = true;
  }
} else {
  console.log('[Diagnostic] caPath is not defined.');
}

const client = new MongoClient(mongoUri, clientOptions);
let db;
let connecting = null;

async function connectMongo() {
  if (db) return db;

  if (!connecting) {
    connecting = client.connect().then(() => {
      db = client.db(mongoDb);
      console.log(`Connected to MongoDB database: ${mongoDb}`);
      return db;
    }).catch(error => {
      // Allow a later request to retry after a transient connection failure.
      connecting = null;
      throw error;
    });
  }
  return connecting;
}
if (!process.env.LAMBDA_TASK_ROOT) {
  app.use(cors({
    origin: '*',
  }));
}

// Availability checks use S3 and PostgreSQL independently of MongoDB middleware.
app.get('/api/completeness', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const resId = normalizeId(req.query.res_id);
  if (!resId) return res.status(400).json({ error: 'Enter a RESET ID such as RES5216.' });
  try {
    const result = await checkCompleteness(s3Client, { ...completenessConfig, bucket: process.env.CLINICAL_DATA_BUCKET || completenessConfig.bucket }, resId, questionnairePool);
    res.json(result);
  } catch {
    res.status(503).json({ error: 'Reports could not be checked. Please try again.' });
  }
});

// Middleware to ensure DB connection
app.use(async (req, res, next) => {
  try {
    await connectMongo();
    next();
  } catch (err) {
    console.error('MongoDB connection failed:', err);
    res.status(500).json({ error: 'MongoDB connection failed.' });
  }
});

// Primary Data Route
app.get('/api/data', async (req, res) => {
  const allowedFields = ['drug_info', 'medical_history'];
  const targetField = req.query.field;
  const resId = req.query.res_id;

  if (!resId) {
    return res.status(400).json({ error: 'Missing required query parameter: res_id.' });
  }

  if (!targetField || !allowedFields.includes(targetField)) {
    return res.status(400).json({ error: `Unsupported or missing field. Use ${allowedFields.join(' or ')}.` });
  }

  try {
    const collection = db.collection(mongoCollection);
    const projection = { res_id: 1, [targetField]: 1 };
    const items = await collection.find({ res_id: resId }, { projection }).limit(100).toArray();

    res.json({
      data: items,
      meta: {
        db: mongoDb,
        collection: mongoCollection,
        count: items.length,
        field: targetField,
        res_id: resId,
      },
    });
  } catch (error) {
    console.error('Failed to query MongoDB:', error);
    res.status(500).json({ error: 'Unable to load data from MongoDB.' });
  }
});

// Authorization Route
app.get('/api/authorize', async (req, res) => {
  const resId = req.query.res_id;

  if (!resId) {
    return res.status(400).json({ error: 'Missing required query parameter: res_id.' });
  }

  const sanitizedResId = resId.trim().toUpperCase();

  try {
    const crfDb = client.db('CRF_data');
    const collection = crfDb.collection('Wearables');
    const doc = await collection.findOne({ res_id: sanitizedResId });

    if (!doc) {
      return res.status(404).json({ error: `RESET ID "${sanitizedResId}" not found.` });
    }

    res.json({
      success: true,
      user_id: doc.user_id,
      res_id: doc.res_id,
      type: doc.type,
      serialNumber: doc.serialNumber,
    });
  } catch (error) {
    console.error('Failed to query Wearables MongoDB:', error);
    res.status(500).json({ error: 'Unable to query Wearables database.' });
  }
});

// Helper month mapping
const MONTH_MAP = {
  'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
  'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
};

// S3 Helper: List subfolders with delimiter
async function listSubfolders(bucket, prefix) {
  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
    Delimiter: '/'
  });
  const response = await s3Client.send(command);
  if (!response.CommonPrefixes) return [];
  return response.CommonPrefixes.map(cp => cp.Prefix);
}

// S3 Helper: List objects recursively under a folder
async function listObjects(bucket, prefix) {
  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix
  });
  const response = await s3Client.send(command);
  return response.Contents || [];
}

// S3 Traversal logic
async function findLatestS3Document(userId) {
  const bucketName = 'garmin-watch-data-lakehouse';
  
  // 1. Years
  let years = await listSubfolders(bucketName, `${userId}/`);
  if (years.length === 0) return null;
  
  years = years.filter(p => {
    const yr = p.replace(/\/$/, '').split('/').pop();
    return /^\d{4}$/.test(yr);
  });
  
  years.sort((a, b) => {
    const yearA = parseInt(a.replace(/\/$/, '').split('/').pop(), 10);
    const yearB = parseInt(b.replace(/\/$/, '').split('/').pop(), 10);
    return yearB - yearA;
  });
  
  for (const yearPath of years) {
    const year = yearPath.replace(/\/$/, '').split('/').pop();
    
    // 2. Months
    let months = await listSubfolders(bucketName, yearPath);
    if (months.length === 0) continue;
    
    months = months.filter(p => {
      const mo = p.replace(/\/$/, '').split('/').pop();
      return MONTH_MAP.hasOwnProperty(mo);
    });
    
    months.sort((a, b) => {
      const monthA = a.replace(/\/$/, '').split('/').pop();
      const monthB = b.replace(/\/$/, '').split('/').pop();
      return (MONTH_MAP[monthB] || 0) - (MONTH_MAP[monthA] || 0);
    });
    
    for (const monthPath of months) {
      const month = monthPath.replace(/\/$/, '').split('/').pop();
      
      // 3. Days
      let days = await listSubfolders(bucketName, monthPath);
      if (days.length === 0) continue;
      
      days = days.filter(p => {
        const dy = p.replace(/\/$/, '').split('/').pop();
        return /^\d{1,2}$/.test(dy);
      });
      
      days.sort((a, b) => {
        const dayA = parseInt(a.replace(/\/$/, '').split('/').pop(), 10);
        const dayB = parseInt(b.replace(/\/$/, '').split('/').pop(), 10);
        return dayB - dayA;
      });
      
      for (const dayPath of days) {
        const day = dayPath.replace(/\/$/, '').split('/').pop();
        
        // 4. Daily Objects
        const objects = await listObjects(bucketName, dayPath);
        if (objects.length === 0) continue;
        
        objects.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
        const latestObj = objects[0];
        
        const monthNum = MONTH_MAP[month];
        const formattedMonth = monthNum < 10 ? `0${monthNum}` : `${monthNum}`;
        const formattedDay = parseInt(day, 10) < 10 ? `0${parseInt(day, 10)}` : `${day}`;
        const formattedDate = `${year}-${formattedMonth}-${formattedDay}`;
        
        return {
          key: latestObj.Key,
          lastModified: latestObj.LastModified,
          date: formattedDate
        };
      }
    }
  }
  return null;
}

// Latest Garmin data date Route
app.get('/api/latest-date', async (req, res) => {
  const resId = req.query.res_id;

  if (!resId) {
    return res.status(400).json({ error: 'Missing required query parameter: res_id.' });
  }

  const sanitizedResId = resId.trim().toUpperCase();

  try {
    const crfDb = client.db('CRF_data');
    const collection = crfDb.collection('Wearables');
    const doc = await collection.findOne({ res_id: sanitizedResId });

    if (!doc) {
      return res.status(404).json({ error: `RESET ID "${sanitizedResId}" not found.` });
    }

    const userId = doc.user_id;
    if (!userId) {
      return res.status(404).json({ error: `RESET ID "${sanitizedResId}" does not have an associated user_id.` });
    }

    const latestInfo = await findLatestS3Document(userId);

    if (!latestInfo) {
      return res.status(404).json({ 
        error: `No Garmin data documents found for User ID "${userId}".`,
        user_id: userId,
        res_id: sanitizedResId
      });
    }

    res.json({
      success: true,
      res_id: sanitizedResId,
      user_id: userId,
      latest_date: latestInfo.date,
      latest_file_key: latestInfo.key,
      last_modified: latestInfo.lastModified,
    });
  } catch (error) {
    console.error('Failed to search latest Garmin data:', error);
    res.status(500).json({ error: 'Unable to query latest Garmin data.' });
  }
});

// Local execution fallback
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}

// Export for AWS Lambda Function URL
module.exports = app;
module.exports.handler = serverless(app);