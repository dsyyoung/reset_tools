const express = require('express');
const cors = require('cors');
const serverless = require('serverless-http');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const app = express();
const mongoUri = process.env.MONGO_URI;
const mongoDb = process.env.MONGO_DB || 'test';
const mongoCollection = process.env.MONGO_COLL || 'items';
const caPath = process.env.CA_PATH;

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
  if (!fs.existsSync(resolved)) {
    console.warn(`CA_PATH file not found: ${resolved}. Lambda looks in /var/task/ by default.`);
  } else {
    clientOptions.tlsCAFile = resolved;
    clientOptions.tls = true;
  }
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
    });
  }
  return connecting;
}
// app.use(cors({
//   origin: '*',
// }));

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