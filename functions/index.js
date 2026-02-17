import { spawn } from 'child_process';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';
import compression from 'compression';
import { randomUUID } from 'crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { config as firebaseConfig } from 'firebase-functions';
import { dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { fetchOrdersDueBy } from './goFlow/goflow_orders_due_by.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config();
let runtimeConfig = {};
try {
  runtimeConfig = firebaseConfig();
} catch {
  runtimeConfig = {};
}

process.env.MONGODB_URI ||= runtimeConfig.mongodb?.uri || runtimeConfig.mongo?.uri;
process.env.MONGODB_DB ||= runtimeConfig.mongodb?.db || runtimeConfig.mongo?.db;
process.env.MONGODB_COLLECTION ||= runtimeConfig.mongodb?.collection || runtimeConfig.mongo?.collection;
process.env.MONGODB_INVENTORY_COLLECTION ||= runtimeConfig.mongodb?.inventory_collection || runtimeConfig.mongo?.inventory_collection;
process.env.MONGODB_PURCHASE_ORDERS_COLLECTION ||= runtimeConfig.mongodb?.purchase_orders_collection || runtimeConfig.mongo?.purchase_orders_collection;
process.env.MONGODB_LATE_ORDERS_COLLECTION ||= runtimeConfig.mongodb?.late_orders_collection || runtimeConfig.mongo?.late_orders_collection;
process.env.JWT_SECRET ||= runtimeConfig.jwt?.secret;
process.env.GOOGLE_CLIENT_ID ||= runtimeConfig.google?.client_id;
process.env.GOOGLE_CLIENT_SECRET ||= runtimeConfig.google?.client_secret;
process.env.EASYPOST_API_KEY ||= runtimeConfig.easypost?.api_key;
process.env.MAGENTO_API_KEY ||= runtimeConfig.magento?.api_key;
process.env.GOFLOW_API_KEY ||= runtimeConfig.goflow?.api_key;
process.env.GOFLOW_BASE_URL ||= runtimeConfig.goflow?.base_url;
process.env.MAPLEPRIME_API_KEY ||= runtimeConfig.mapleprime?.api_key;
const app = express();
app.use(cors());

app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const reqId = randomUUID();
  const start = Date.now();
  res.setHeader('X-Request-Id', reqId);
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms ${reqId}`);
  });
  next();
});
const client = new MongoClient(process.env.MONGODB_URI);
const dbName = process.env.MONGODB_DB;
const lateOrdersCollectionName = process.env.MONGODB_LATE_ORDERS_COLLECTION || 'late_orders_report';

const requiredEnv = ['MONGODB_URI', 'MONGODB_DB', 'MONGODB_PURCHASE_ORDERS_COLLECTION'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error(`Missing required env vars: ${missingEnv.join(', ')}`);
  process.exit(1);
}

let db;
let indexesReady = false;
const getDb = async () => {
  if (!db) {
    await client.connect();
    db = client.db(dbName);
  }
  return db;
};

const ensureIndexes = async () => {
  if (indexesReady) return;
  const db = await getDb();
  await Promise.all([
    db.collection('orders').createIndex({ status: 1 }),
    db.collection('orders').createIndex({ status_updated_at: -1 }),
    db.collection('orders').createIndex({ order_number: 1 }),
    db.collection('orders').createIndex({ tracking_number: 1 }),
    db.collection(process.env.MONGODB_PURCHASE_ORDERS_COLLECTION).createIndex({ supplier_name: 1 }),
    db.collection(process.env.MONGODB_PURCHASE_ORDERS_COLLECTION).createIndex({ new_po_status: 1 }),
    db.collection(process.env.MONGODB_PURCHASE_ORDERS_COLLECTION).createIndex({ purchase_order_date: -1, _id: -1 }),
    db.collection(lateOrdersCollectionName).createIndex({ report_date: -1 })
  ]);
  indexesReady = true;
};

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const isValidObjectId = (id) => ObjectId.isValid(id);

const cache = {
  users: { data: null, expiresAt: 0 },
  deliveries: { data: null, expiresAt: 0 }
};
const CACHE_TTL_MS = 30 * 1000;

// In-memory rate limit for purchase order refresh (2 minutes)
let lastPurchaseOrderRefreshTime = 0;
const REFRESH_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

// In-memory rate limit for GoFlow orders refresh (2 minutes)
let lastOrdersRefreshTime = 0;

// In-memory status for late orders report generation
let lateOrdersReportRunning = false;
const LATE_ORDERS_REPORT_COOLDOWN_MS = 60 * 60 * 1000;

const getLatestLateOrdersReportDate = async (db) => {
  const names = [lateOrdersCollectionName, 'late_orders_report', 'late-orders-report'];
  const uniqueNames = Array.from(new Set(names));
  let latest = null;
  for (const name of uniqueNames) {
    const doc = await db.collection(name).findOne({}, { sort: { report_date: -1 }, projection: { report_date: 1 } });
    if (doc?.report_date) {
      const ts = new Date(doc.report_date).getTime();
      if (!Number.isNaN(ts) && (latest === null || ts > latest)) {
        latest = ts;
      }
    }
  }
  return latest;
};

// Endpoint to update pallet_amount and box_amount for a delivery group
app.post('/api/delivery-amounts', asyncHandler(async (req, res) => {
  await ensureIndexes();
  const { delivery_id, supplier_name, eta, pallet_amount, box_amount } = req.body;
  if (!delivery_id && (!supplier_name || !eta)) {
    return res.status(400).json({ error: 'delivery_id or supplier_name and eta are required' });
  }
  if (pallet_amount === undefined && box_amount === undefined) {
    return res.status(400).json({ error: 'pallet_amount or box_amount is required' });
  }
  const db = await getDb();
  const deliveries = db.collection('deliveries');
  const update = {};
  if (pallet_amount) update.pallet_amount = pallet_amount;
  if (box_amount) update.box_amount = box_amount;
  const filter = delivery_id ? { _id: new ObjectId(delivery_id) } : { supplier_name, eta };
  const result = await deliveries.updateOne(filter, { $set: update });
  if (result.matchedCount === 0) {
    return res.status(404).json({ error: 'Delivery group not found' });
  }
  res.json({ success: true });
}));

// Mark delivery POs as complete
app.post('/api/deliveries/complete', asyncHandler(async (req, res) => {
  await ensureIndexes();
  const { po_numbers } = req.body;
  if (!Array.isArray(po_numbers) || po_numbers.length === 0) {
    return res.status(400).json({ error: 'po_numbers array is required' });
  }
  const db = await getDb();
  const deliveries = db.collection('deliveries');
  const collection = db.collection(process.env.MONGODB_PURCHASE_ORDERS_COLLECTION);
  const now = new Date();
  const result = await collection.updateMany(
    { purchase_order_number: { $in: po_numbers } },
    { $set: { new_po_status: 'complete', status_last_updated: now } }
  );
  await deliveries.updateMany(
    { po_numbers: { $in: po_numbers } },
    { $set: { status: 'complete', completed_at: now } }
  );
  res.json({ success: true, matched: result.matchedCount, modified: result.modifiedCount });
}));
// Upsert delivery group in deliveries collection when PO with ETA is added/updated
async function upsertDeliveryGroup(supplier_name, eta, po_number) {
  const db = await getDb();
  const deliveries = db.collection('deliveries');
  await deliveries.updateOne(
    { supplier_name, eta, status: { $ne: 'complete' } },
    { $addToSet: { po_numbers: po_number }, $setOnInsert: { pallet_amount: '', box_amount: '', status: 'open' } },
    { upsert: true }
  );
}
// Endpoint to trigger update_purchase_orders.js
app.post('/api/refresh-purchase-orders', asyncHandler(async (req, res) => {
  await ensureIndexes();
  const now = Date.now();
  if (now - lastPurchaseOrderRefreshTime < REFRESH_COOLDOWN_MS) {
    const wait = Math.ceil((REFRESH_COOLDOWN_MS - (now - lastPurchaseOrderRefreshTime)) / 1000);
    return res.status(429).json({ error: `Please wait ${wait} seconds before refreshing again.` });
  }
  lastPurchaseOrderRefreshTime = now;
  const child = spawn('node', ['update_purchase_orders.js'], {
    cwd: __dirname,
    stdio: 'ignore',
    detached: true
  });
  child.unref();
  res.json({ success: true, message: 'Purchase order update started.' });
}));

// Endpoint to trigger goflow_orders_sync.js
app.post('/api/refresh-orders', asyncHandler(async (req, res) => {
  await ensureIndexes();
  const now = Date.now();
  if (now - lastOrdersRefreshTime < REFRESH_COOLDOWN_MS) {
    const wait = Math.ceil((REFRESH_COOLDOWN_MS - (now - lastOrdersRefreshTime)) / 1000);
    return res.status(429).json({ error: `Please wait ${wait} seconds before refreshing again.` });
  }
  lastOrdersRefreshTime = now;
  const child = spawn('node', ['goflow_orders_sync.js'], {
    cwd: __dirname,
    stdio: 'ignore',
    detached: true
  });
  child.unref();
  res.json({ success: true, message: 'GoFlow orders update started.' });
}));

// Endpoint to trigger lateOrders.js report generation
app.post('/api/refresh-late-orders-report', asyncHandler(async (req, res) => {
  await ensureIndexes();
  if (lateOrdersReportRunning) {
    return res.status(409).json({ error: 'Late orders report is already running.' });
  }
  const db = await getDb();
  const latestReportTs = await getLatestLateOrdersReportDate(db);
  if (latestReportTs) {
    const now = Date.now();
    const elapsed = now - latestReportTs;
    if (elapsed < LATE_ORDERS_REPORT_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((LATE_ORDERS_REPORT_COOLDOWN_MS - elapsed) / 1000);
      const minutes = Math.floor(waitSeconds / 60);
      const seconds = waitSeconds % 60;
      return res.status(429).json({
        error: `Please wait ${minutes} minute${minutes !== 1 ? 's' : ''} ${seconds} second${seconds !== 1 ? 's' : ''} before generating a new report.`
      });
    }
  }
  lateOrdersReportRunning = true;
  const child = spawn('node', ['lateOrders.js'], {
    cwd: __dirname,
    stdio: 'ignore',
    detached: true
  });
  child.on('exit', () => {
    lateOrdersReportRunning = false;
  });
  child.on('error', () => {
    lateOrdersReportRunning = false;
  });
  child.unref();
  res.json({ success: true, message: 'Late orders report generation started.' });
}));

// Late orders report status
app.get('/api/late-orders-report/status', asyncHandler(async (req, res) => {
  res.json({ running: lateOrdersReportRunning });
}));

// Fetch orders by tag (from frontend)
app.post('/api/orders-due-by', asyncHandler(async (req, res) => {
  await ensureIndexes();
  try {
    const data = await fetchOrdersDueBy();
    return res.json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    const payload = err.response?.data || { error: err.message };
    return res.status(status).json(payload);
  }
}));

// Get latest late orders report
app.get('/api/late-orders-report', asyncHandler(async (req, res) => {
  await ensureIndexes();
  const db = await getDb();
  const primaryCollection = db.collection(lateOrdersCollectionName);
  let report = await primaryCollection.findOne({}, { sort: { report_date: -1 } });
  if (!report) {
    const fallbackNames = ['late_orders_report', 'late-orders-report'].filter(name => name !== lateOrdersCollectionName);
    for (const name of fallbackNames) {
      const fallback = db.collection(name);
      report = await fallback.findOne({}, { sort: { report_date: -1 } });
      if (report) break;
    }
  }
  if (!report) {
    return res.json({ report: null });
  }
  return res.json(report);
}));

// Debug: show late orders report collection counts
app.get('/api/late-orders-report/debug', asyncHandler(async (req, res) => {
  await ensureIndexes();
  const db = await getDb();
  const names = [lateOrdersCollectionName, 'late_orders_report', 'late-orders-report'];
  const uniqueNames = Array.from(new Set(names));
  const counts = {};
  for (const name of uniqueNames) {
    counts[name] = await db.collection(name).countDocuments();
  }
  res.json({ db: dbName, collections: counts });
}));
// Get all purchase orders
app.get('/api/purchase-orders', asyncHandler(async (req, res) => {
  await ensureIndexes();
  const db = await getDb();
  const collection = db.collection(process.env.MONGODB_PURCHASE_ORDERS_COLLECTION);
  const filter = { new_po_status: { $ne: 'complete' } };
  // Filter by status (new_po_status)
  if (req.query.status) {
    filter.new_po_status = req.query.status;
  }
  // Filter by vendor (supplier_name)
  if (req.query.vendor) {
    filter.supplier_name = req.query.vendor;
  }
  const includeItems = String(req.query.includeItems || '').toLowerCase() === 'true';
  const projection = includeItems ? {} : { items: 0 };
  const total = await collection.countDocuments(filter);
  const all = String(req.query.all || '').toLowerCase() === 'true';
  if (all) {
    const orders = await collection.find(filter, { projection }).toArray();
    return res.json({ orders, total, all: true });
  }
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
  const skip = (page - 1) * limit;
  const orders = await collection
    .find(filter, { projection })
    .sort({ purchase_order_date: -1, _id: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
  res.json({ orders, total, page, limit });
}));

// Update ETA for a purchase order
app.post('/api/purchase-orders/:id/eta', asyncHandler(async (req, res) => {
  await ensureIndexes();
  const db = await getDb();
  const collection = db.collection(process.env.MONGODB_PURCHASE_ORDERS_COLLECTION);
  const { id } = req.params;
  const { eta } = req.body;
  if (!isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
  if (!eta) return res.status(400).json({ error: 'ETA is required' });

  const result = await collection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { eta } }
  );
  if (result.matchedCount === 0) {
    return res.status(404).json({ error: 'Purchase order not found' });
  }
  // Find PO number and supplier_name for this PO
  const po = await collection.findOne({ _id: new ObjectId(id) });
  if (po && po.purchase_order_number && po.supplier_name) {
    await upsertDeliveryGroup(po.supplier_name, eta, po.purchase_order_number);
  }
  res.json({ success: true });
  // ...existing code...
}));
// Endpoint to get all deliveries
app.get('/api/deliveries', asyncHandler(async (req, res) => {
  await ensureIndexes();
  // const now = Date.now();
  // if (cache.deliveries.data && cache.deliveries.expiresAt > now) {
  //   return res.json({ deliveries: cache.deliveries.data, cached: true });
  // }
  const db = await getDb();
  const deliveries = await db.collection('deliveries')
    .find({ status: { $ne: 'complete' } })
    .toArray();
  // cache.deliveries = { data: deliveries, expiresAt: now + CACHE_TTL_MS };
  res.json({ deliveries });
}));
// Remove ETA for a purchase order
app.delete('/api/purchase-orders/:id/eta', asyncHandler(async (req, res) => {
  await ensureIndexes();
  const db = await getDb();
  const collection = db.collection(process.env.MONGODB_PURCHASE_ORDERS_COLLECTION);
  const { id } = req.params;
  if (!isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
  
  // Get PO details before removing ETA
  const po = await collection.findOne({ _id: new ObjectId(id) });
  if (!po) {
    return res.status(404).json({ error: 'Purchase order not found' });
  }
  
  const result = await collection.updateOne(
    { _id: new ObjectId(id) },
    { $unset: { eta: "" } }
  );
  
  // Remove PO from delivery group if it exists
  if (po.purchase_order_number && po.supplier_name && po.eta) {
    const deliveries = db.collection('deliveries');
    await deliveries.updateOne(
      { supplier_name: po.supplier_name, eta: po.eta },
      { $pull: { po_numbers: po.purchase_order_number } }
    );
    // Clean up empty delivery groups
    await deliveries.deleteMany({
      supplier_name: po.supplier_name,
      eta: po.eta,
      po_numbers: { $size: 0 }
    });
  }
  
  res.json({ success: true });
}));

// Delete a purchase order
app.delete('/api/purchase-orders/:id', asyncHandler(async (req, res) => {
  await ensureIndexes();
  const db = await getDb();
  const collection = db.collection(process.env.MONGODB_PURCHASE_ORDERS_COLLECTION);
  const { id } = req.params;
  if (!isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
  
  const result = await collection.deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) {
    return res.status(404).json({ error: 'Purchase order not found' });
  }
  
  res.json({ success: true });
}));

//update status and last update time for a purchase order
app.post('/api/purchase-orders/:id/status', asyncHandler(async (req, res) => {
  await ensureIndexes();
  const db = await getDb();
  const collection = db.collection(process.env.MONGODB_PURCHASE_ORDERS_COLLECTION);
  const { id } = req.params;
  const { status, refreshOnly } = req.body;
  if (!isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
  let update;
  if (refreshOnly) {
    update = { $set: { status_last_updated: new Date() } };
  } else {
    if (!status) return res.status(400).json({ error: 'Status is required' });
    update = { $set: { new_po_status: status, status_last_updated: new Date() } };
  }
  const result = await collection.updateOne(
    { _id: new ObjectId(id) },
    update
  );
  if (result.matchedCount === 0) {
    return res.status(404).json({ error: 'Purchase order not found' });
  }
  res.json({ success: true });
}));

// Get paginated, filterable orders with multi-select status and user filters
app.get('/api/orders', asyncHandler(async (req, res) => {
  await ensureIndexes();
  const db = await getDb();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;
  const filter = {};
  // Support searching by order_number or tracking_number
  if (req.query.search) {
    const search = req.query.search.trim();
    filter.$or = [
      { order_number: { $regex: search, $options: 'i' } },
      { tracking_number: { $regex: search, $options: 'i' } }
    ];
  }
  // Multi-select status support (comma-separated)
  if (req.query.status) {
    const statuses = req.query.status.split(',').map(s => s.trim()).filter(Boolean);
    if (statuses.length > 0) filter.status = { $in: statuses };
  }
  if (req.query.packed_by) filter.packed_by = req.query.packed_by;
  if (req.query.sent_out_by) filter.sent_out_by = req.query.sent_out_by;
  const total = await db.collection('orders').countDocuments(filter);
  const orders = await db.collection('orders')
    .find(filter)
    .sort({ status_updated_at: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
  res.json({ orders, total });
}));
// Get all users (for dropdowns)
app.get('/api/users', asyncHandler(async (req, res) => {
  await ensureIndexes();
  const now = Date.now();
  if (cache.users.data && cache.users.expiresAt > now) {
    return res.json({ users: cache.users.data, cached: true });
  }
  const db = await getDb();
  const users = await db.collection('users').find({}, { projection: { username: 1, name: 1, _id: 0 } }).toArray();
  cache.users = { data: users, expiresAt: now + CACHE_TTL_MS };
  res.json({ users });
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const shutdown = async () => {
  try {
    await client.close();
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export const api = onRequest({ cors: true }, app);

const isFirebaseRuntime = Boolean(process.env.K_SERVICE || process.env.FUNCTION_TARGET);
const isDirectRun = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();
if (!isFirebaseRuntime && isDirectRun) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`Server listening on ${PORT}`);
  });
}

ensureIndexes().catch((err) => {
  console.error('Failed to create indexes', err);
});

