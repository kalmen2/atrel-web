import 'dotenv/config';
import axios from 'axios';
import { MongoClient } from 'mongodb';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = `${__dirname}/../.env`;
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const BASE_URL = process.env.GOFLOW_BASE_URL;
const API_KEY = process.env.GOFLOW_API_KEY;

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'goflow';
const MONGODB_COLLECTION = process.env.MONGODB_INVENTORY_COLLECTION || 'inventory';



const REPORT_COLUMNS = [
  'product_id',
  'product_item_number',
  'warehouse_name',
  'product_name',
  'on_hand',
  'available',
  'on_purchase_order'
];

const BASE_HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'X-Beta-Contact': 'kalmi@atrelgroup.com'
};

const JSON_HEADERS = {
  ...BASE_HEADERS,
  'Content-Type': 'application/json'
};

async function goflowPost(url, payload) {
    const res = await axios.post(url, payload, {
      headers: JSON_HEADERS,
      timeout: 20000
    });
    return res.data;
}

async function goflowGet(url, includeContentType = true) {
    const res = await axios.get(url, {
      headers: includeContentType ? JSON_HEADERS : BASE_HEADERS,
      timeout: 20000
    });
    return res.data;
  
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchReportFileRows(report) {
  const fileUrl = report?.completed?.file_url;
  if (!fileUrl) {
    return [];
  }
  const fileData = await goflowGet(fileUrl, false);
  if (Array.isArray(fileData)) return fileData;
  throw new Error('Report file did not return a JSON array. Check report format.');
}

async function pollReport(locationUrl, maxAttempts = 20, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const report = await goflowGet(locationUrl);
    const status = report?.status || report?.state || report?.report?.status;
    if (status === 'completed') {
      return report;
    }
    if (status === 'error') {
      const message = report?.error?.message || 'Report generation failed';
      throw new Error(message);
    }
    await sleep(delayMs);
  }
  throw new Error('Report not ready after polling');
}

async function upsertInventory(rows) {
  if (!rows.length) return 0;
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(MONGODB_DB);
    const collection = db.collection(MONGODB_COLLECTION);
    const batchUpdatedAt = new Date();
    await collection.deleteMany({});
    const docs = rows.map(row => ({
      ...row,
      updated_at: batchUpdatedAt
    }));
    const result = await collection.insertMany(docs, { ordered: false });
    return result.insertedCount;
  } finally {
    await client.close();
  }
}

async function run() {
  const url = `${BASE_URL}/reports/inventory/counts`;
  const payload = {
    columns: REPORT_COLUMNS,
    format: 'json'
  };

  const data = await goflowPost(url, payload);
  if (!data?.location) {
    throw new Error('GoFlow report did not return a location URL');
  }

  const report = await pollReport(data.location);
  const rows = await fetchReportFileRows(report);
  const updatedCount = await upsertInventory(rows);

  console.log(`Inventory sync complete. Rows received: ${rows.length}. Rows upserted: ${updatedCount}.`);
}

run().catch(err => {
  console.error('Inventory sync failed:', err.message);
  process.exit(1);
});
