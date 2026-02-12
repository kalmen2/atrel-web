import 'dotenv/config';
import axios from 'axios';

import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
dayjs.extend(utc);
dayjs.extend(timezone);

const BASE_URL = process.env.GOFLOW_BASE_URL;
const API_KEY = process.env.GOFLOW_API_KEY;

const STATE_FILE = path.resolve('./sync_state.json');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/goflow';
const MONGODB_DB = process.env.MONGODB_DB || 'goflow';
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || 'orders';


function loadLast() {
  if (!fs.existsSync(STATE_FILE)) {
    return { last_order_date: null, last_order_id: null };
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function saveLast(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}


async function saveOrdersToMongo(newOrders) {
  if (!newOrders.length) return;
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(MONGODB_DB);
    const collection = db.collection(MONGODB_COLLECTION);
    // Insert only new orders (skip duplicates by id)
    const bulkOps = newOrders.map(order => ({
      updateOne: {
        filter: { id: order.id },
        update: { $set: order },
        upsert: true
      }
    }));
    if (bulkOps.length) {
      await collection.bulkWrite(bulkOps);
    }
  } finally {
    await client.close();
  }
}

async function goflowRequest(url) {
  try {
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'X-Beta-Contact': 'kalmi@atrelgroup.com',
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    return res.data;
  } catch (err) {
    if (err.response) {
      throw new Error(`GoFlow API error ${err.response.status}: ${JSON.stringify(err.response.data)}`);
    } else {
      throw new Error(`GoFlow request failed: ${err.message}`);
    }
  }
}

// Main sync function
async function syncShippedOrders(latestOrderId, latestOrderDate) {
  let url = `${BASE_URL}/orders?filters[status]=shipped&filters[date:gte]=${latestOrderDate}`;
  let page = 1;
  let newestDate = latestOrderDate;
  let newestId = latestOrderId;
  let foundLatestOrder = false;
  let newOrders = [];

  while (url && !foundLatestOrder) {
    const data = await goflowRequest(url);
    const orders = data.data || [];

    for (const order of orders) {
      const orderDate = order.date;
      const orderId = order.id;
      if (orderId === latestOrderId) {
        foundLatestOrder = true;
        break;
      }

      let shippedAtFormatted = null;
      if (order.shipment && order.shipment.shipped_at) {
        shippedAtFormatted = dayjs(order.shipment.shipped_at)
          .tz('America/New_York')
          .format('YYYY-MM-DD HH:mm:ss');
      }
      const filteredOrder = {
        id: order.id,
        order_number: order.order_number,
        status: order.status,
        store_id: order.store.id ?? null,
        shipped_at: shippedAtFormatted,
        tracking_number: order.shipment?.boxes?.[0]?.tracking_number ?? null,
        carrier: order.shipment?.carrier ?? null,
        store_name: order.store?.name ?? null
      };
      newOrders.push(filteredOrder);
      // Track newest order
      if (!newestDate || orderDate > newestDate) {
        newestDate = orderDate;
        newestId = orderId;
      }
    }
    if (!foundLatestOrder && data.next) {
      url = data.next;
      page++;
    } else {
      break;
    }
  }
  
  await saveOrdersToMongo(newOrders);
  saveLast({ last_order_date: newestDate, last_order_id: newestId });
}

async function main() {
  const state = loadLast();
  let latestOrderId = state.last_order_id;
  let latestOrderDate = state.last_order_date;
  
  await syncShippedOrders(latestOrderId, latestOrderDate);
}

main().catch(err => {
  console.error(`Failed:`, err.message);
});
