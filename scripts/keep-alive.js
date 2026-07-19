/**
 * Render free-tier keep-alive ping.
 *
 * Render free web services spin down after inactivity. This script hits the
 * backend health endpoint every 10–14 minutes so the UAT/demo instance stays
 * warm. This is a convenience for demos/UAT, not a production architecture.
 *
 * Usage:
 *   KEEP_ALIVE_URL=https://api.example.com/health node scripts/keep-alive.js
 *
 * Environment:
 *   KEEP_ALIVE_URL   Full URL to ping (required if no fallback).
 *   ERP_API_BASE_URL Fallback origin; /health is appended automatically.
 */
const https = require('https');
const http = require('http');
const path = require('path');

// Try to load a local .env from the project root or erp_prototype.
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  require('dotenv').config({ path: path.join(__dirname, '..', 'erp_prototype', '.env') });
} catch (e) {
  // dotenv is optional; ignore if missing.
}

function getPingUrl() {
  if (process.env.KEEP_ALIVE_URL) return process.env.KEEP_ALIVE_URL;
  let base = process.env.ERP_API_BASE_URL;
  if (!base) {
    console.error('[keep-alive] Set KEEP_ALIVE_URL or ERP_API_BASE_URL environment variable.');
    process.exit(1);
  }
  if (!base.startsWith('http://') && !base.startsWith('https://')) {
    base = `https://${base}`;
  }
  base = base.replace(/\/$/, '');
  if (base.endsWith('/v1')) {
    base = base.slice(0, -3);
  }
  return `${base}/health`;
}

function ping(url) {
  const client = url.startsWith('https:') ? https : http;
  const start = Date.now();
  return new Promise((resolve) => {
    const req = client.get(url, { timeout: 30000 }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        const elapsed = Date.now() - start;
        console.log(`[keep-alive] ${new Date().toISOString()} ${url} ${res.statusCode} (${elapsed}ms)`);
        resolve();
      });
    });
    req.on('error', (err) => {
      console.error(`[keep-alive] ${new Date().toISOString()} ping failed: ${err.message}`);
      resolve();
    });
    req.on('timeout', () => {
      req.destroy();
      console.error(`[keep-alive] ${new Date().toISOString()} ping timed out`);
      resolve();
    });
  });
}

function scheduleNext() {
  // Randomize between 10 and 14 minutes to avoid fleet-wide stampede.
  const minutes = 10 + Math.random() * 4;
  const ms = Math.round(minutes * 60 * 1000);
  console.log(`[keep-alive] Next ping in ${Math.round(minutes * 10) / 10} minutes.`);
  setTimeout(run, ms);
}

async function run() {
  const url = getPingUrl();
  await ping(url);
  scheduleNext();
}

run();
