import 'dotenv/config';
import { MongoClient } from 'mongodb';
import EasyPost from '@easypost/api';

const api = new EasyPost(process.env.EASYPOST_API_KEY);
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || 'orders';

async function trackAndUpdateOrders() {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(MONGODB_DB);
    const collection = db.collection(MONGODB_COLLECTION);
    // Find all orders with tracking_number exists (status filter commented out)
    // const orders = await collection.find({ status: 'sent_out', tracking_number: { $exists: true, $ne: null } }).toArray();
    const orders = await collection.find({ tracking_number: { $exists: true, $ne: null } }).toArray();
    for (const order of orders) {
      // Log order being processed
      console.log(`Processing order id: ${order.id}, store_id: ${order.store_id}, tracking_number: ${order.tracking_number}`);
      // Skip tracking if carrier is asendia, or if tracking number starts with TBA (Amazon partnered)
      const carrier = order.carrier || order.shipment?.carrier || null;
      if (carrier === 'asendia') {
        console.log(`Skipping tracking for carrier asendia, order id: ${order.id}`);
        continue;
      }
      if (order.tracking_number && order.tracking_number.startsWith('TBA')) {
        console.log(`Skipping tracking for Amazon partnered (TBA) tracking number, order id: ${order.id}`);
        continue;
      }
      try {
        let tracker;
        // Always try to retrieve tracker by tracker_id if present
        if (order.tracker_id) {
          try {
            tracker = await api.Tracker.retrieve(order.tracker_id);
            console.log(`Retrieved tracker for order id: ${order.id} using tracker_id.`);
          } catch (e) {
            console.log(`Failed to retrieve tracker by id for order id: ${order.id}, will create new. Reason: ${e.message}`);
          }
        }
        // If not found, create new tracker
        if (!tracker) {
          tracker = await api.Tracker.create({ tracking_code: order.tracking_number });
          // Save tracker id for future retrieval
          await collection.updateOne(
            { _id: order._id },
            { $set: { tracker_id: tracker.id } }
          );
          console.log(`Created new tracker for order id: ${order.id}`);
        }
        const trackingInfo = {
          trackingNumber: tracker.tracking_code,
          carrier: tracker.carrier,
          status: tracker.status,
          estDelivery: tracker.est_delivery_date,
          lastEvent: tracker.tracking_details?.[0] || null,
        };
        await collection.updateOne(
          { _id: order._id },
          { $set: { tracking: trackingInfo } }
        );
        console.log(`Updated order id: ${order.id} with tracking info.`);
      } catch (err) {
        await collection.updateOne(
          { _id: order._id },
          { $set: { tracking: { error: err.message, trackingNumber: order.tracking_number } } }
        );
        console.log(`Error updating order id: ${order.id}: ${err.message}`);
      }
    }
  } finally {
    await client.close();
  }
}

// Run as a script
trackAndUpdateOrders().then(() => {
  console.log('Tracking update complete');
}).catch(err => {
  console.error('Tracking update failed:', err);
});
