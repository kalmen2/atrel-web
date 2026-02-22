import axios from 'axios';
import dayjs from 'dayjs';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env') });

const GOFLOW_API_KEY = process.env.GOFLOW_API_KEY;
const GOFLOW_BASE_URL = process.env.GOFLOW_BASE_URL;
const magento_url = 'https://host.mapleprime.com/api/v1/purchase-order/product/bulk-download';
let gf_url = `${GOFLOW_BASE_URL}/purchasing/purchase-orders?filters[status]=awaiting_receipt`;
const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB;
const COLLECTION = process.env.MONGODB_PURCHASE_ORDERS_COLLECTION;
const magento_api_key = process.env.MAGENTO_API_KEY;
const client = new MongoClient(MONGO_URI);
await client.connect();
const db = client.db(DB_NAME);
const collection = db.collection(COLLECTION);
const GOFLOW_HEADERS = {
  Authorization: `Bearer ${GOFLOW_API_KEY}`,
  'X-Beta-Contact': 'kalmi@atrelgroup.com',
  'Content-Type': 'application/json'
};

async function fetchMagentoPOs() {
  try {
    const https = await import('https');
    const { parse } = await import('csv-parse/sync');

    function fetchCSV(magento_url, magento_api_key) {
      return new Promise((resolve, reject) => {
        https.get(magento_url, { headers: { 'X-API-KEY': magento_api_key } }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(data));
          res.on('error', reject);
        }).on('error', reject);
      });
    }
    
    const csvData = await fetchCSV(magento_url, magento_api_key);
    const records = parse(csvData, { columns: true, skip_empty_lines: true });
    console.log(`Parsed ${records.length} records from CSV.`);
    // Build maps for all statuses
    const poMap = {};
    const completePOs = {};
    let filteredCount = 0;
    records.forEach(row => {
      const poNum = row.purchase_order_number;
      const status = row.purchase_order_status;
      if (!poNum) return;
      if (status === 'waiting_for_supplier') {
        const supplier = row.supplier_name || '';
        let date = row.purchase_order_date || '';
        if (date && dayjs(date).isValid()) {
          date = dayjs(date).format('MM-DD-YYYY');
        }
        if (!poMap[poNum]) {
          poMap[poNum] = {
            purchase_order_number: poNum,
            new_po_status: status,
            supplier_name: supplier,
            purchase_order_date: date,
            items: []
          };
          filteredCount++;
        }
        poMap[poNum].items.push({
          product_name: row.product_name || '',
          product_sku: row.product_sku || row.purchase_order_product_sku || '',
          upc: row.upc || row.product_upc || '',
          purchase_order_product_goflow_qty: row.purchase_order_product_goflow_qty || '0',
          purchase_order_product_fba_qty: row.purchase_order_product_fba_qty || '0',
          purchase_order_product_delivered_fba_qty: row.purchase_order_product_delivered_fba_qty || '0',
          purchase_order_product_delivered_goflow_qty: row.purchase_order_product_delivered_goflow_qty || '0'
        });
      } else if (status === 'complete') {
        completePOs[poNum] = true;
      }
      // Ignore all other statuses
    });
    const uniquePOs = Object.values(poMap);
    console.log(`Magento: Filtered ${filteredCount} records with status 'waiting_for_supplier'.`);
    console.log(`Magento: Pulled ${uniquePOs.length} unique POs with status 'waiting_for_supplier'.`);
    return { uniquePOs, completePOs };
  } catch (err) {
    console.error("Error fetching Magento POs:", err);
    return [];
  }
}


async function fetchGoFlowPOs() {
  let allPOs = [];
  try {
    while (gf_url) {
      const res = await axios.get(gf_url, { headers: GOFLOW_HEADERS, timeout: 15000 });
      const data = res.data;
      const items = Array.isArray(data.data) ? data.data : [];
      for (const item of items) {
        // Skip if created by admin
        if (item.meta?.created?.by?.user?.username === "admin") {
          console.log(`Skipped PO ${item.purchase_order_number} (created by admin)`);
          continue;
        }
        console.log(`Fetched GoFlow PO: ${item.purchase_order_number}`);
        // Format date to MM-DD-YYYY (no time)
        let poDate = '';
        if (item.date && dayjs(item.date).isValid()) {
          poDate = dayjs(item.date).format('MM-DD-YYYY');
        }
        allPOs.push({
          purchase_order_number: item.purchase_order_number,
          new_po_status: item.status,
          supplier_name: item.vendor?.name || null,
          purchase_order_date: poDate,
          items: item.lines
        });
      }
      gf_url = data.next || null;
    }
    // // Deduplicate by purchase_order_number
    const poMap = {};
    allPOs.forEach(po => {
        if (!poMap[po.purchase_order_number]) {
          poMap[po.purchase_order_number] = po;
        }
      }); 
    return Object.values(poMap);
  } catch (err) {
    console.error("Error fetching GoFlow POs:", err);
    return [];
  }
}

// Helper to log function runs to function_logs
async function logFunctionRun({ message, level = 'info', meta = {} }) {
  try {
    const mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    const db = mongoClient.db(DB_NAME);
    await db.collection('function_logs').insertOne({
      message,
      level,
      meta,
      timestamp: new Date()
    });
    await mongoClient.close();
  } catch (e) {
    // Logging failure should not crash the main job
    console.error('Failed to log function run:', e.message);
  }
}

async function fetchAndStorePOs() {
  try {
    // Fetch from both sources
    const [magentoResult, goflowPOs] = await Promise.all([
      fetchMagentoPOs(),
      fetchGoFlowPOs()
    ]);
    const magentoPOs = magentoResult.uniquePOs;
    const magentoCompletePOs = magentoResult.completePOs;
    // Get all POs from DB
    const dbPOs = await collection.find({}).toArray();
    // Build a set of all pulled Magento PO numbers
    for (const dbPO of dbPOs) {
      const poNum = dbPO.purchase_order_number;
      // If PO is now complete in Magento, remove from DB
      if (magentoCompletePOs[poNum]) {
        await collection.deleteOne({ purchase_order_number: poNum });
        console.log(`Removed PO ${poNum} from DB (status: complete in Magento)`);
  
      }
    }
    // Merge and deduplicate by purchase_order_number
    const poMap = {};
    [...magentoPOs, ...goflowPOs].forEach(po => {
      if (!poMap[po.purchase_order_number]) {
        poMap[po.purchase_order_number] = po;
      }
    });
    const uniquePOs = Object.values(poMap);
    console.log(`Found ${uniquePOs.length} unique purchase orders to upsert.`);
    // Upsert into MongoDB (insert or update)
    for (const po of uniquePOs) {
      // Preserve delivery_method if it exists in DB
      const existing = await collection.findOne({ purchase_order_number: po.purchase_order_number });
      if (existing && existing.delivery_method) {
        po.delivery_method = existing.delivery_method;
      }
      await collection.updateOne(
        { purchase_order_number: po.purchase_order_number },
        { $set: po },
        { upsert: true }
      );
      console.log(`Upserted PO: ${po.purchase_order_number}`);
    }
    await client.close();
    console.log("Purchase orders updated.");
    await logFunctionRun({ message: 'update_purchase_orders.js completed successfully', level: 'info' });
  } catch (err) {
    console.error("Error:", err);
    if (err?.response?.status === 429) return;
    await logFunctionRun({ message: 'update_purchase_orders.js failed: ' + err.message, level: 'error' });
  }
}

fetchAndStorePOs();
