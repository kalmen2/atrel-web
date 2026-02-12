import 'dotenv/config';
import axios from 'axios';
import { MongoClient } from 'mongodb';

const BASE_URL = process.env.GOFLOW_BASE_URL;
const API_KEY = process.env.GOFLOW_API_KEY;
const DUE_BY_TAG_ID = '6960583e585b7bca055c1846';
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;
const MONGODB_INVENTORY_COLLECTION = process.env.MONGODB_INVENTORY_COLLECTION || 'inventory';

const HEADERS = {
	Authorization: `Bearer ${API_KEY}`,
	'X-Beta-Contact': 'kalmi@atrelgroup.com',
	'Content-Type': 'application/json'
};

function buildItemTotals(orders) {
	const totals = new Map();
	for (const order of orders) {
		const lines = Array.isArray(order?.lines) ? order.lines : [];
		for (const line of lines) {
			const itemNumber = line?.item_number || line?.product?.item_number;
			if (!itemNumber) continue;
			const qty = Number(line?.quantity?.amount ?? line?.quantity ?? 0);
			if (Number.isNaN(qty) || qty === 0) continue;
			const current = totals.get(itemNumber) || 0;
			totals.set(itemNumber, current + qty);
		}
	}
	return Array.from(totals.entries()).map(([item_number, total_quantity]) => ({
		item_number,
		total_quantity
	}));
}

async function fetchInventoryTotalsMap(itemNumbers) {
	if (!MONGODB_URI || !MONGODB_DB || itemNumbers.length === 0) {
		return new Map();
	}
	const client = new MongoClient(MONGODB_URI);
	try {
		await client.connect();
		const db = client.db(MONGODB_DB);
		const collection = db.collection(MONGODB_INVENTORY_COLLECTION);
		const rows = await collection
			.aggregate([
				{ $match: { product_item_number: { $in: itemNumbers } } },
				{
					$group: {
						_id: '$product_item_number',
						on_purchase_order: { $sum: { $ifNull: ['$on_purchase_order', 0] } },
						on_hand: { $sum: { $ifNull: ['$on_hand', 0] } }
					}
				}
			])
			.toArray();
		return new Map(rows.map((row) => [row._id, row]));
	} finally {
		await client.close();
	}
}

export async function fetchOrdersDueBy() {
	const params = new URLSearchParams();
	params.append('filters[tags.id]', DUE_BY_TAG_ID);
	let url = `${BASE_URL}orders?${params.toString()}`;
	const all = [];
	while (url) {
		const res = await axios.get(url, { headers: HEADERS, timeout: 20000 });
		const pageData = Array.isArray(res.data?.data) ? res.data.data : [];
		all.push(...pageData);
		url = res.data?.next || null;
	}
	const mapped = all.map((order) => {
		const lines = Array.isArray(order?.lines) ? order.lines : [];
		const itemNumbers = lines
			.map((line) => line?.item_number || line?.product?.item_number)
			.filter(Boolean);
		const totalItems = lines.reduce((sum, line) => {
			const qty = Number(line?.quantity?.amount ?? line?.quantity ?? 0);
			return sum + (Number.isNaN(qty) ? 0 : qty);
		}, 0);
		return {
			order_number: order?.order_number ?? '',
			status: order?.status ?? '',
			latest_ship: order?.ship_dates?.latest_ship ?? '',
			total_items: totalItems,
			item_numbers: itemNumbers.join(', ')
		};
	});
	const item_totals = buildItemTotals(all);
	const itemNumbers = item_totals.map((item) => item.item_number);
	const inventoryTotalsMap = await fetchInventoryTotalsMap(itemNumbers);
	const enriched_item_totals = item_totals.map((item) => ({
		...item,
		on_purchase_order: inventoryTotalsMap.get(item.item_number)?.on_purchase_order || 0,
		on_hand: inventoryTotalsMap.get(item.item_number)?.on_hand || 0
	}));
	console.log('[orders-due-by] item_totals', enriched_item_totals);
	return { data: mapped, item_totals: enriched_item_totals };
}
