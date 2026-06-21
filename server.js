const express = require('express');
const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
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
};

if (caPath) {
  const resolved = path.resolve(caPath);
  if (!fs.existsSync(resolved)) {
    console.warn(`CA_PATH file not found: ${resolved}`);
  } else {
    clientOptions.tlsCAFile = resolved;
    clientOptions.tls = true;
  }
}

const client = new MongoClient(mongoUri, clientOptions);
let db;

async function connectMongo() {
  await client.connect();
  db = client.db(mongoDb);
  console.log(`Connected to MongoDB database: ${mongoDb}`);
}

connectMongo().catch((err) => {
  console.error('MongoDB connection failed:', err);
  process.exit(1);
});

app.use(express.static(path.join(process.cwd(), 'public')));

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

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
