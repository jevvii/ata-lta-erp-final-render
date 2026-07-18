/**
 * Local development server for the ATA & LTA ERP SPA.
 *
 * Serves the static prototype and injects env.js at runtime so the same
 * built artifacts can talk to local, UAT, or production backends without
 * rebuilding. This is the dev counterpart to Render's buildCommand.
 *
 * Usage:
 *   ERP_API_BASE_URL=http://localhost:3000/v1 node dev-server.js
 *   # or, with a .env file:
 *   node dev-server.js
 *
 * Environment variables:
 *   ERP_API_BASE_URL   Backend API origin + /v1  (default: http://localhost:3000/v1)
 *   PORT               Port for the dev server    (default: 8080)
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

require('dotenv').config();

const ROOT = __dirname;
const DEFAULT_API_URL = 'http://localhost:3000/v1';
const HOST = process.env.HOST || '127.0.0.1';
const PORT = parseInt(process.env.PORT || '8080', 10);

let rawApiUrl = process.env.ERP_API_BASE_URL || DEFAULT_API_URL;
// Render Blueprint fromService gives a bare hostname; ensure a full https origin.
if (!rawApiUrl.startsWith('http://') && !rawApiUrl.startsWith('https://')) {
  rawApiUrl = `https://${rawApiUrl}`;
}
const API_BASE_URL = rawApiUrl.endsWith('/v1')
  ? rawApiUrl
  : `${rawApiUrl.replace(/\/$/, '')}/v1`;

const ENV_JS = `window.__ERP_API_BASE_URL__ = ${JSON.stringify(API_BASE_URL)};\n`;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function send(res, status, body, contentType = 'text/plain') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Active-Entity',
  });
  res.end(body);
}

function serveStatic(filePath, res) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      return send(res, 404, 'Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    return send(res, 204, '');
  }

  if (url.pathname === '/env.js') {
    return send(res, 200, ENV_JS, 'application/javascript');
  }

  if (url.pathname === '/health') {
    return send(res, 200, JSON.stringify({ status: 'ok', apiBaseUrl: API_BASE_URL }), 'application/json');
  }

  // Strip leading slash and serve file from ROOT.
  let relativePath = url.pathname.slice(1) || 'index.html';
  // Prevent directory traversal.
  relativePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.join(ROOT, relativePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // SPA fallback: unknown paths return index.html so the hash router handles them.
      return serveStatic(path.join(ROOT, 'index.html'), res);
    }
    serveStatic(filePath, res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`SPA dev server running at http://${HOST}:${PORT}`);
  console.log(`API base URL (injected into env.js): ${API_BASE_URL}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use.`);
    console.error(`Run with a different port: PORT=${PORT + 1} npm run dev`);
    process.exit(1);
  }
  console.error('Dev server error:', err);
  process.exit(1);
});
