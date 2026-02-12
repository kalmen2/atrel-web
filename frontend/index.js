import process from 'node:process';
import { spawn } from 'child_process';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fetch from 'node-fetch';
import { OAuth2Client } from 'google-auth-library';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchOrdersDueBy } from '../functions/goFlow/goflow_orders_due_by.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config();
console.log('DEBUG: MONGODB_PURCHASE_ORDERS_COLLECTION =', process.env.MONGODB_PURCHASE_ORDERS_COLLECTION);

const app = express();
app.use(cors());
app.use(express.json());

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
const client = new MongoClient(process.env.MONGODB_URI);
const dbName = process.env.MONGODB_DB;

// In-memory rate limit for purchase order refresh (2 minutes)
let lastPurchaseOrderRefreshTime = 0;
const REFRESH_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

// In-memory rate limit for GoFlow orders refresh (2 minutes)
let lastOrdersRefreshTime = 0;

// Endpoint to update pallet_amount and box_amount for a delivery group
app.post('/api/delivery-amounts', async (req, res) => {
  const { supplier_name, eta, pallet_amount, box_amount } = req.body;
  if (!supplier_name || !eta) {
    return res.status(400).json({ error: 'supplier_name and eta are required' });
  }
  await client.connect();
  const db = client.db(dbName);
  const deliveries = db.collection('deliveries');
  const update = {};
  if (pallet_amount !== undefined) update.pallet_amount = pallet_amount;
  if (box_amount !== undefined) update.box_amount = box_amount;
  const result = await deliveries.updateOne(
    { supplier_name, eta },
    { $set: update }
  );
  if (result.matchedCount === 0) {
    return res.status(404).json({ error: 'Delivery group not found' });
  }
  res.json({ success: true });
});
// Upsert delivery group in deliveries collection when PO with ETA is added/updated
async function upsertDeliveryGroup(supplier_name, eta, po_number) {
  await client.connect();
  const db = client.db(dbName);
  const deliveries = db.collection('deliveries');
  await deliveries.updateOne(
    { supplier_name, eta },
    { $addToSet: { po_numbers: po_number }, $setOnInsert: { pallet_amount: '', box_amount: '' } },
    { upsert: true }
  );
}
// Endpoint to trigger update_purchase_orders.js
app.post('/api/refresh-purchase-orders', async (req, res) => {
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
});

// Endpoint to trigger goflow_orders_sync.js
app.post('/api/refresh-orders', async (req, res) => {
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
});

// Fetch orders by tag (from frontend)
app.post('/api/orders-due-by', async (req, res) => {
  try {
    const data = await fetchOrdersDueBy();
    return res.json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    const payload = err.response?.data || { error: err.message };
    return res.status(status).json(payload);
  }
});
// Get all purchase orders
app.get('/api/purchase-orders', async (req, res) => {
  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection(process.env.MONGODB_PURCHASE_ORDERS_COLLECTION);
  const filter = {};
  // Filter by status (new_po_status)
  if (req.query.status) {
    filter.new_po_status = req.query.status;
  }
  // Filter by vendor (supplier_name)
  if (req.query.vendor) {
    filter.supplier_name = req.query.vendor;
  }
  const orders = await collection.find(filter).toArray();
  res.json({ orders });
});

// Update ETA for a purchase order
app.post('/api/purchase-orders/:id/eta', async (req, res) => {
  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection(process.env.MONGODB_PURCHASE_ORDERS_COLLECTION);
  const { id } = req.params;
  const { eta } = req.body;
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
});
// Endpoint to get all deliveries
app.get('/api/deliveries', async (req, res) => {
  await client.connect();
  const db = client.db(dbName);
  const deliveries = await db.collection('deliveries').find({}).toArray();
  res.json({ deliveries });
});
// Remove ETA for a purchase order
app.delete('/api/purchase-orders/:id/eta', async (req, res) => {
  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection(process.env.MONGODB_PURCHASE_ORDERS_COLLECTION);
  const { id } = req.params;
  const result = await collection.updateOne(
    { _id: new ObjectId(id) },
    { $unset: { eta: "" } }
  );
  if (result.matchedCount === 0) {
    return res.status(404).json({ error: 'Purchase order not found' });
  }
  res.json({ success: true });
});

//update status and last update time for a purchase order
app.post('/api/purchase-orders/:id/status', async (req, res) => {
  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection(process.env.MONGODB_PURCHASE_ORDERS_COLLECTION);
  const { id } = req.params;
  const { status } = req.body;
  console.log('Status update request:', { id, status });
  if (!status) return res.status(400).json({ error: 'Status is required' });

  // Update status and last updated time
  const result = await collection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { new_po_status: status, status_last_updated: new Date() } }
  );
  if (result.matchedCount === 0) {
    return res.status(404).json({ error: 'Purchase order not found' });
  }
  res.json({ success: true });
});
//update last update time for a purchase order
app.post('/api/purchase-orders/:id/status', async (req, res) => {
  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection(process.env.MONGODB_PURCHASE_ORDERS_COLLECTION);
  const { id } = req.params;
  const { status, refreshOnly } = req.body;
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
});

// Get paginated, filterable orders with multi-select status and user filters
app.get('/api/orders', async (req, res) => {
  await client.connect();
  const db = client.db(dbName);
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
});
// Get all users (for dropdowns)
app.get('/api/users', async (req, res) => {
  await client.connect();
  const db = client.db(dbName);
  const users = await db.collection('users').find({}, { projection: { username: 1, name: 1, _id: 0 } }).toArray();
  res.json({ users });
});

// Middleware for authentication
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// User login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  await client.connect();
  const db = client.db(dbName);
  const user = await db.collection('users').findOne({ username });
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ username: user.username, name: user.name }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, name: user.name });
});

// REPLACE /api/scan endpoint with repack/check logic
app.post('/api/scan', auth, async (req, res) => {
  const { tracking_number, check_only, repack } = req.body;
  await client.connect();
  const db = client.db(dbName);
  const order = await db.collection('orders').findOne({ tracking_number });
  if (!order) return res.status(404).json({ error: 'Order not found' });

  // If already packed and not repack, just report
  if (order.packed_by && !repack) {
    return res.json({
      success: true,
      already_packed: true,
      packed_by: order.packed_by,
      packed_time: order.packed_time
    });
  }

  // If check_only, do not update, just report
  if (check_only) {
    return res.json({
      success: true,
      already_packed: !!order.packed_by,
      packed_by: order.packed_by,
      packed_time: order.packed_time
    });
  }

  // Mark as packed or repacked
  let packed_time;
  try {
    const resp = await fetch('https://worldtimeapi.org/api/timezone/America/New_York');
    const data = await resp.json();
    packed_time = data.datetime || new Date().toISOString();
  } catch {
    packed_time = new Date().toISOString();
  }
  await db.collection('orders').updateOne(
    { _id: order._id },
    { $set: { status: 'packed', packed_time, packed_by: req.user.name } }
  );
  res.json({ success: true, packed_time, packed_by: req.user.name });
});

// Add backend endpoint for send out
app.post('/api/sendout', auth, async (req, res) => {
  const { tracking_number, check_only, repack } = req.body;
  await client.connect();
  const db = client.db(dbName);
  const order = await db.collection('orders').findOne({ tracking_number });
  if (!order) return res.status(404).json({ error: 'Order not found' });

  // If check_only, only report status
  if (check_only) {
    if (order.sent_out_by) {
      return res.json({
        success: true,
        already_sent_out: true,
        sent_out_by: order.sent_out_by,
        sent_out_time: order.sent_out_time
      });
    } else {
      return res.json({ success: true, already_sent_out: false });
    }
  }

  // If already sent out and not repack, just report
  if (order.sent_out_by && !repack) {
    return res.json({
      success: true,
      already_sent_out: true,
      sent_out_by: order.sent_out_by,
      sent_out_time: order.sent_out_time
    });
  }

  // Mark as sent out or repacked
  let sent_out_time;
  try {
    const resp = await fetch('https://worldtimeapi.org/api/timezone/America/New_York');
    const data = await resp.json();
    sent_out_time = data.datetime || new Date().toISOString();
  } catch {
    sent_out_time = new Date().toISOString();
  }
  await db.collection('orders').updateOne(
    { _id: order._id },
    { $set: { status: 'sent_out', sent_out_time, sent_out_by: req.user.name } }
  );
  res.json({ success: true, sent_out_by: req.user.name, sent_out_time });
});

// (Optional) Create user endpoint for setup
app.post('/api/create-user', async (req, res) => {
  const { username, password, name } = req.body;
  await client.connect();
  const db = client.db(dbName);
  const hash = bcrypt.hashSync(password, 10);
  await db.collection('users').insertOne({ username, password: hash, name });
  res.json({ success: true });
});

// Add backend endpoints for user language
app.post('/api/set-language', auth, async (req, res) => {
  const { language } = req.body;
  await client.connect();
  const db = client.db(dbName);
  await db.collection('users').updateOne(
    { username: req.user.username },
    { $set: { language } }
  );
  res.json({ success: true });
});

app.get('/api/get-language', auth, async (req, res) => {
  await client.connect();
  const db = client.db(dbName);
  const user = await db.collection('users').findOne({ username: req.user.username });
  res.json({ language: user?.language || 'en' });
});

// Default root endpoint for health check
app.get('/', (req, res) => {
  res.send('GoFlow backend is running');
});

// const PORT = process.env.PORT || 4000;
// app.listen(PORT, () => console.log('Backend running on port', PORT));

// Google OAuth GET endpoint to start login flow
app.get('/api/google-login', (req, res) => {
  const redirectUri = 'http://localhost:4000/api/google-callback'; // Backend callback
  const scope = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'openid'
  ].join(' ');
  const url = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=select_account`;
  res.redirect(url);
});

// Google OAuth callback endpoint (to exchange code for tokens)
app.get('/api/google-callback', async (req, res) => {
  const code = req.query.code;
  const redirectUri = 'http://localhost:4000/api/google-callback'; // Must match above
  try {
    const { tokens } = await googleClient.getToken({
      code,
      redirect_uri: redirectUri
    });
    console.log('Google tokens:', tokens);
    const ticket = await googleClient.verifyIdToken({ idToken: tokens.id_token, audience: GOOGLE_CLIENT_ID });
    console.log('Google ticket:', ticket);
    const payload = ticket.getPayload();
    console.log('Google payload:', payload);
    await client.connect();
    const db = client.db(dbName);
    let user = await db.collection('users').findOne({ username: payload.email });
    if (!user) {
      await db.collection('users').insertOne({ username: payload.email, name: payload.name, google: true });
      user = { username: payload.email, name: payload.name };
    }
    const token = jwt.sign({ username: user.username, name: user.name }, process.env.JWT_SECRET, { expiresIn: '8h' });
    // Redirect to frontend with token and name
    res.redirect(`http://localhost:3000?token=${token}&name=${encodeURIComponent(user.name)}`);
  } catch (err) {
    console.error('Google login error:', err);
    res.status(401).send('Google login failed');
  }
});


// Google login endpoint for token verification (used for frontend POST)
app.post('/api/google-login', async (req, res) => {
  const { id_token } = req.body;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: id_token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    await client.connect();
    const db = client.db(dbName);
    let user = await db.collection('users').findOne({ username: payload.email });
    if (!user) {
      await db.collection('users').insertOne({ username: payload.email, name: payload.name, google: true });
      user = { username: payload.email, name: payload.name };
    }
    const token = jwt.sign({ username: user.username, name: user.name }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, name: user.name });
  } catch (err) {
    console.error('Google login failed:', err);
    res.status(401).json({ error: 'Google login failed' });
  }
});
import { onRequest } from 'firebase-functions/v2/https';
export const api = onRequest(app);