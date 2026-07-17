/**
 * Build script for the ATA & LTA ERP SPA.
 * Generates env.js with the backend API URL injected at build time.
 * Used by Render Static Site during deployment.
 */
const fs = require('fs');
const path = require('path');

const apiUrl = process.env.ERP_API_BASE_URL;
if (!apiUrl) {
  console.error('ERP_API_BASE_URL is required');
  process.exit(1);
}

// Render Blueprint fromService gives us a bare hostname; ensure a full https origin.
const withProtocol = apiUrl.startsWith('http://') || apiUrl.startsWith('https://')
  ? apiUrl
  : `https://${apiUrl}`;
const normalizedUrl = withProtocol.endsWith('/v1') ? withProtocol : `${withProtocol.replace(/\/$/, '')}/v1`;
const output = `window.__ERP_API_BASE_URL__ = ${JSON.stringify(normalizedUrl)};\n`;

fs.writeFileSync(path.join(__dirname, 'env.js'), output);
console.log('Generated env.js with API base URL:', normalizedUrl);
