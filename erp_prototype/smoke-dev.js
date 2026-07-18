/**
 * Lightweight development smoke test.
 *
 * Does NOT use Playwright. It verifies that the local SPA dev server is up
 * and that env.js points to the intended backend. Optionally it also pings the
 * backend /health endpoint when the API base URL is localhost.
 *
 * Usage:
 *   node smoke-dev.js [spaUrl]
 *
 * Defaults:
 *   spaUrl = http://localhost:8080
 */

const http = require('http');
const https = require('https');

const BASE = process.env.BASE_URL || process.argv[2] || 'http://localhost:8080';
const TIMEOUT_MS = 5000;

let results = [];
let discoveredApiUrl = null;

function request(url, options, callback) {
  return url.startsWith('https:') ? https.get(url, options, callback) : http.get(url, options, callback);
}

function log(label, passed, detail) {
  results.push({ label, passed, detail });
  const status = passed ? '✅' : '❌';
  console.log(`${status} ${label}${detail ? ': ' + detail : ''}`);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, { timeout: TIMEOUT_MS }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null });
        } catch (e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, { timeout: TIMEOUT_MS }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

async function runTests() {
  console.log(`Running dev smoke tests against ${BASE}...`);
  // ─── SPA health ─────────────────────────────────────────────────
  let spaHealth;
  try {
    spaHealth = await fetchJson(`${BASE}/health`);
    log('SPA dev server health', spaHealth.status === 200 && spaHealth.body?.status === 'ok', JSON.stringify(spaHealth.body));
  } catch (e) {
    log('SPA dev server health', false, e.message);
  }

  // ─── env.js injection ───────────────────────────────────────────
  let envJs;
  try {
    envJs = await fetchText(`${BASE}/env.js`);
    const matches = envJs.body.match(/window\.__ERP_API_BASE_URL__\s*=\s*"([^"]+)"/);
    discoveredApiUrl = matches ? matches[1] : null;
    const looksValid = discoveredApiUrl && (discoveredApiUrl.startsWith('http://') || discoveredApiUrl.startsWith('https://')) && discoveredApiUrl.endsWith('/v1');
    log('env.js API URL injection', looksValid, discoveredApiUrl);
  } catch (e) {
    log('env.js API URL injection', false, e.message);
  }

  // ─── index.html fallback ────────────────────────────────────────
  let indexHtml;
  try {
    indexHtml = await fetchText(`${BASE}/`);
    const hasShell = indexHtml.body.includes('id="app-shell"');
    const hasApiClient = indexHtml.body.includes('js/apiClient.js');
    log('index.html shell loaded', hasShell && hasApiClient, `status=${indexHtml.status}`);
  } catch (e) {
    log('index.html shell loaded', false, e.message);
  }

  // ─── Backend health (only when pointing at localhost backend) ─────
  const isLocalBackend = (discoveredApiUrl || '').includes('localhost:3000');
  if (isLocalBackend) {
    try {
      const backendHealth = await fetchJson('http://localhost:3000/health');
      // In dev the backend may be "degraded" if a dummy/test Supabase URL is used;
      // we accept 200 "ok" or 503 "degraded" as evidence the API is reachable.
      const reachable = [200, 503].includes(backendHealth.status);
      log('Local backend health', reachable, `status=${backendHealth.status} body=${JSON.stringify(backendHealth.body)}`);
    } catch (e) {
      log('Local backend health', false, e.message);
    }
  } else {
    log('Local backend health', true, 'skipped — not targeting localhost:3000');
  }

  // ─── Summary ────────────────────────────────────────────────────
  console.log('\n========== DEV SMOKE TEST SUMMARY ==========');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);
  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter((r) => !r.passed).forEach((r) => console.log(`  ❌ ${r.label}: ${r.detail}`));
  }
  console.log('==========================================');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
