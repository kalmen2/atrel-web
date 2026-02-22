import axios from 'axios';
import dotenv from 'dotenv';
import { resolve } from 'path';
import { MongoClient } from 'mongodb';
dotenv.config({ path: resolve(process.cwd(), '.env') });

const GOFLOW_BASE_URL = process.env.GOFLOW_BASE_URL;
const GOFLOW_API_KEY = process.env.GOFLOW_API_KEY;
const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB;
const COLLECTION = process.env.MONGODB_PURCHASE_ORDERS_COLLECTION;
const LATE_ORDERS_COLLECTION = 'late_orders_report';

const GOFLOW_HEADERS = {
	Authorization: `Bearer ${GOFLOW_API_KEY}`,
	'X-Beta-Contact': 'kalmi@atrelgroup.com',
	'Content-Type': 'application/json'
};

const WAREHOUSE_ID = '07a215d8-3244-4b7b-beda-d81ddbef5fb6';

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

async function fetchOpenOrdersByStores() {
	let url = `${GOFLOW_BASE_URL}/orders?filters[status:not]=shipped&filters[status:not]=canceled&filters[store.id]=1002&filters[store.id]=1003`;
	const allOrders = [];

	while (url) {
		const res = await axios.get(url, { headers: GOFLOW_HEADERS });
		const data = res.data || {};
		const orders = Array.isArray(data.data) ? data.data : [];
		allOrders.push(...orders);
		url = data.next || null;
	}
	return allOrders;
}

function countItemsFromOrders(orders) {
	const totals = {};
	for (const order of orders) {
		const lines = Array.isArray(order.lines) ? order.lines : [];
		for (const line of lines) {
			const productId = line?.product?.id;
			const itemNumber = line?.product?.item_number;
			const qty = Number(line?.quantity?.amount || 0);
			if (!totals[productId]) {
				totals[productId] = { product_id: productId, item_number: itemNumber || null, quantity: 0 };
			}
			totals[productId].quantity += qty;
		}
	}
	return Object.values(totals);
}

async function fetchOnHandByProductId(productId) {
	const url = `${GOFLOW_BASE_URL}/products/${productId}/inventory`;
	const { data = {} } = await axios.get(url, { headers: GOFLOW_HEADERS });
	const warehouses = data.warehouses || [];
	const match = warehouses.find(w => w?.warehouse?.id === WAREHOUSE_ID);
	return Number(match?.on_hand || 0);
}

function detectPOType(po) {
	// Check if it's GoFlow type (has item.id structure)
	if (po.items && po.items.length > 0 && po.items[0].id) {
		return 'goflow';
	}
	// Check if it's Magento type ending in GF
	if (po.purchase_order_number && po.purchase_order_number.endsWith('-GF') || po.purchase_order_number.includes('PO-') && po.purchase_order_number.includes('-GF')) {
		return 'magento_gf';
	}
	// Otherwise it's regular Magento
	return 'magento';
}

function getAwaitingQuantity(po, item) {
	const poType = detectPOType(po);
	
	if (poType === 'goflow') {
		// GoFlow format: quantity.amount - units_received
		const qty = Number(item.quantity?.amount || 0);
		const received = Number(item.units_received || 0);
		return { goflow: Math.max(0, qty - received), fba: 0 };
	} else if (poType === 'magento_gf') {
		// Magento ending in GF: both goflow_qty and fba_qty count as goflow
		const goflowQty = Number(item.purchase_order_product_goflow_qty || 0);
		const goflowDelivered = Number(item.purchase_order_product_delivered_goflow_qty || 0);
		const fbaQty = Number(item.purchase_order_product_fba_qty || 0);
		const fbaDelivered = Number(item.purchase_order_product_delivered_fba_qty || 0);
		const totalAwaiting = Math.max(0, goflowQty - goflowDelivered) + Math.max(0, fbaQty - fbaDelivered);
		return { goflow: totalAwaiting, fba: 0 };
	} else {
		// Regular Magento: separate goflow and fba tracking
		const goflowQty = Number(item.purchase_order_product_goflow_qty || 0);
		const goflowDelivered = Number(item.purchase_order_product_delivered_goflow_qty || 0);
		const fbaQty = Number(item.purchase_order_product_fba_qty || 0);
		const fbaDelivered = Number(item.purchase_order_product_delivered_fba_qty || 0);
		return {
			goflow: Math.max(0, goflowQty - goflowDelivered),
			fba: Math.max(0, fbaQty - fbaDelivered)
		};
	}
}

async function run() {
	let mongoClient;
	try {
		mongoClient = new MongoClient(MONGO_URI);
		await mongoClient.connect();
		const db = mongoClient.db(DB_NAME);
		const poCollection = db.collection(COLLECTION);
		const reportCollection = db.collection(LATE_ORDERS_COLLECTION);
		// Remove previous report
		await reportCollection.deleteMany({});
		
		const orders = await fetchOpenOrdersByStores();
		const nyDateString = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
		const [nyYear, nyMonth, nyDay] = nyDateString.split('-').map(Number);
		const cutoff = new Date(Date.UTC(nyYear, nyMonth - 1, nyDay, 23, 59, 59, 999));
		const dueOrders = orders.filter(order => {
			const latest = order?.ship_dates?.latest_ship;
			return latest && new Date(latest) <= cutoff;
		});
		const totalDueOrders = dueOrders.length;
		const itemTotals = countItemsFromOrders(dueOrders);
		const totalUnits = itemTotals.reduce((sum, item) => sum + item.quantity, 0);
		
		// Fetch all purchase orders for awaiting calculation
		const purchaseOrders = await poCollection.find({}).toArray();
		const poMap = {};
		purchaseOrders.forEach(po => {
			poMap[po.purchase_order_number] = po;
		});
		
		// Track totals
		let totalOnHand = 0;
		let totalItemsWithOnHand = 0;
		let totalAwaitingGoflow = 0;
		let totalAwaitingFBA = 0;
		let totalItemsShort = 0;
		const reportTimestamp = new Date();
		const itemsData = [];
		
		console.log(`\nUnique items due: ${itemTotals.length}`);
		console.log(`Total units due: ${totalUnits}\n`);

		for (const item of itemTotals) {
			const onHand = await fetchOnHandByProductId(item.product_id);
			totalOnHand += onHand;
			if (onHand > 0) {
				totalItemsWithOnHand += 1;
			}
			
			// Search for this item in purchase orders and calculate awaiting quantities
			let awaitingGoflow = 0;
			let awaitingFBA = 0;
			const awaitingGoflowByPo = {};
			const awaitingFbaByPo = {};
			
			for (const po of purchaseOrders) {
				const poItems = po.items || [];
				for (const poItem of poItems) {
					let isMatch = false;
					// Match by SKU for Magento items or item_number for GoFlow items
					if (poItem.product_sku && poItem.product_sku === item.item_number) {
						isMatch = true;
					} else if (poItem.product?.item_number === item.item_number) {
						isMatch = true;
					}
					
					if (isMatch) {
						const awaiting = getAwaitingQuantity(po, poItem);
						awaitingGoflow += awaiting.goflow;
						awaitingFBA += awaiting.fba;
						if (awaiting.goflow > 0) {
							const poNumber = po.purchase_order_number || 'unknown';
							awaitingGoflowByPo[poNumber] = (awaitingGoflowByPo[poNumber] || 0) + awaiting.goflow;
						}
						if (awaiting.fba > 0) {
							const poNumber = po.purchase_order_number || 'unknown';
							awaitingFbaByPo[poNumber] = (awaitingFbaByPo[poNumber] || 0) + awaiting.fba;
						}
					}
				}
			}
			
			totalAwaitingGoflow += awaitingGoflow;
			totalAwaitingFBA += awaitingFBA;
			
			const awaitingTotal = awaitingGoflow + awaitingFBA;
			const effectiveOnHand = Math.max(0, onHand);
			if (effectiveOnHand + awaitingTotal < item.quantity) {
				totalItemsShort += 1;
			}

			// Add to items data for database
			const awaitingGoflowDetails = Object.entries(awaitingGoflowByPo).map(([purchase_order_number, qty]) => ({
				purchase_order_number,
				qty
			}));
			const awaitingFbaDetails = Object.entries(awaitingFbaByPo).map(([purchase_order_number, qty]) => ({
				purchase_order_number,
				qty
			}));
			itemsData.push({
				item_number: item.item_number || 'unknown',
				product_id: item.product_id,
				units_due: item.quantity,
				on_hand: onHand,
				awaiting_goflow: awaitingGoflow,
				awaiting_fba: awaitingFBA,
				awaiting_goflow_details: awaitingGoflowDetails,
				awaiting_fba_details: awaitingFbaDetails
			});
			
			console.log(`Item ${item.item_number || 'unknown'} (product ${item.product_id})`);
			console.log(`  On Hand: ${onHand}`);
			console.log(`  Awaiting GoFlow: ${awaitingGoflow}`);
			console.log(`  Awaiting FBA: ${awaitingFBA}\n`);
			
			await new Promise(resolve => setTimeout(resolve, 2000));
		}
		
		// Prepare report document
		const reportDoc = {
			report_date: reportTimestamp,
			cutoff_date: cutoff,
			summary: {
				total_due_orders_amount: totalDueOrders,
				total_items_due: itemTotals.length,
				total_units_due: totalUnits,
				total_on_hand: totalItemsWithOnHand,
				total_awaiting: totalAwaitingGoflow + totalAwaitingFBA,
				total_items_short: totalItemsShort
			},
			items: itemsData
		};
		
		// Save to database
		const result = await reportCollection.insertOne(reportDoc);
		
		console.log("=".repeat(60));
		console.log("SUMMARY");
		console.log("=".repeat(60));
		console.log(`Total Due Orders: ${totalDueOrders}`);
		console.log(`Total Items Due: ${itemTotals.length}`);
		console.log(`Total Units Due: ${totalUnits}`);
		console.log(`Total On Hand (items with stock): ${totalItemsWithOnHand}`);
		console.log(`Total Awaiting: ${totalAwaitingGoflow + totalAwaitingFBA}`);
		console.log(`Total Items Short: ${totalItemsShort}`);
		console.log("\nReport saved to database with ID:", result.insertedId);
		console.log("Report created at:", reportTimestamp.toISOString());
		console.log("=".repeat(60));
		
		await mongoClient.close();
		await logFunctionRun({ message: 'lateOrders.js completed successfully', level: 'info' });
	} catch (err) {
		console.error('Failed to fetch open orders:', err.message);
		if (mongoClient) await mongoClient.close();
		if (err?.response?.status === 429) return;
		await logFunctionRun({ message: 'lateOrders.js failed: ' + err.message, level: 'error' });
		process.exit(1);
	}
}


run();
