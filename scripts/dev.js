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
 *   - frontend dev server pointing at http://localhost:3000/v1
 *
 * "uat" runs:
 *   - backend with .env.uat (values should be exported in shell or set in .env.uat)
 *   - frontend dev server pointing at the Render UAT backend
 */

const { spawn } = require('child_process');
const path = require('path');

const envArg = process.argv[2] || 'local';
const isUat = envArg.toLowerCase() === 'uat';
const isProd = envArg.toLowerCase() === 'prod';

const ROOT = path.join(__dirname, '..');

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
  console.log('Starting full-stack local dev stack...');
  backend = run('backend', 'npm', ['--prefix', 'backend', 'run', 'dev:local'], { env: process.env });
  frontend = run('spa', 'npm', ['--prefix', 'erp_prototype', 'run', 'dev'], { env: process.env });
}
