/**
 * Local development orchestrator.
 *
 * Starts the backend and SPA frontend as sibling processes, routes their
 * stdout/stderr through prefixed lines, and cleanly shuts both down on Ctrl+C.
 *
 * Usage:
 *   node scripts/dev.js [local|uat|prod]
 *
 * Defaults to "local", which runs:
 *   - backend with .env.development
 *   - frontend dev server pointing at the backend's actual port
 *
 * The backend port is read from backend/.env.development (or the PORT env var),
 * and the SPA dev server is automatically configured to call that port via
 * ERP_API_BASE_URL. This avoids the common mismatch where the backend starts on
 * 3001 while the SPA still points at 3000.
 *
 * "uat" runs:
 *   - backend with .env.uat (values should be exported in shell or set in .env.uat)
 *   - frontend dev server pointing at the Render UAT backend
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const envArg = process.argv[2] || 'local';
const isUat = envArg.toLowerCase() === 'uat';
const isProd = envArg.toLowerCase() === 'prod';

const ROOT = path.join(__dirname, '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (env[key] === undefined) env[key] = value;
  }
  return env;
}

function resolveBackendPort() {
  if (process.env.PORT) return Number(process.env.PORT);

  if (isUat || isProd) {
    const envFile = isUat ? 'backend/.env.uat' : 'backend/.env.production';
    const env = loadEnvFile(path.join(ROOT, envFile));
    if (env.PORT) return Number(env.PORT);
  }

  const localEnv = loadEnvFile(path.join(ROOT, 'backend', '.env.development'));
  return localEnv.PORT ? Number(localEnv.PORT) : 3000;
}

function run(label, cmd, args, options) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    stdio: 'pipe',
    shell: process.platform === 'win32',
    ...options,
  });

  const prefix = `[${label}]`;
  child.stdout.on('data', (data) => {
    data.toString().split(/\r?\n/).forEach((line) => {
      if (line.trim()) console.log(`${prefix} ${line}`);
    });
  });
  child.stderr.on('data', (data) => {
    data.toString().split(/\r?\n/).forEach((line) => {
      if (line.trim()) console.error(`${prefix} ${line}`);
    });
  });

  child.on('exit', (code) => {
    console.log(`${prefix} exited with code ${code}`);
  });

  return child;
}

let backend;
let frontend;

function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down dev stack...`);
  if (backend) backend.kill('SIGTERM');
  if (frontend) frontend.kill('SIGTERM');
  setTimeout(() => {
    if (backend && !backend.killed) backend.kill('SIGKILL');
    if (frontend && !frontend.killed) frontend.kill('SIGKILL');
  }, 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (isUat || isProd) {
  console.log(`Starting full-stack dev against ${envArg.toUpperCase()} backend...`);
  const apiUrl = isUat
    ? 'https://ata-lta-erp-api-uat.onrender.com'
    : 'https://ata-lta-erp-api.onrender.com';
  backend = run('backend', 'npm', ['--prefix', 'backend', 'run', `start:${envArg}`], { env: process.env });
  frontend = run('spa', 'npm', ['--prefix', 'erp_prototype', 'run', 'dev'], {
    env: { ...process.env, ERP_API_BASE_URL: apiUrl },
  });
} else {
  const backendPort = resolveBackendPort();
  const apiBaseUrl = `http://localhost:${backendPort}/v1`;
  console.log('Starting full-stack local dev stack...');
  console.log(`Backend will be available at http://localhost:${backendPort}`);
  console.log(`SPA will call API at ${apiBaseUrl}`);

  backend = run('backend', 'npm', ['--prefix', 'backend', 'run', 'dev:local'], { env: process.env });
  frontend = run('spa', 'npm', ['--prefix', 'erp_prototype', 'run', 'dev'], {
    env: { ...process.env, ERP_API_BASE_URL: apiBaseUrl },
  });
}
