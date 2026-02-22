import { onSchedule } from 'firebase-functions/v2/scheduler';
import { spawn } from 'child_process';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const scheduledLateOrders = onSchedule({
  schedule: '0 18 * * *', // 6pm UTC every day
  timeZone: 'America/New_York' // Change to your local timezone if needed
}, async (event) => {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [__dirname + '/lateOrders.js'], {
      stdio: 'inherit',
      env: process.env
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('lateOrders.js exited with code ' + code));
    });
    child.on('error', reject);
  });
});

export const scheduledUpdatePurchaseOrders = onSchedule({
  schedule: '0 19 * * *', 
  timeZone: 'America/New_York' // Change to your local timezone if needed
}, async (event) => {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [__dirname + '/update_purchase_orders.js'], {
      stdio: 'inherit',
      env: process.env
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('update_purchase_orders.js exited with code ' + code));
    });
    child.on('error', reject);
  });
});
