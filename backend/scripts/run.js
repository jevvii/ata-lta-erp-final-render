/**
 * Backend runner with explicit environment file selection.
 *
 * Usage:
 *   node scripts/run.js [local|uat|prod]
 *
 * Loads the matching .env.* file (if present) without touching process env
 * variables that are already set, then starts the Express application.
 */

const fs = require('fs');
const path = require('path');

const envArg = process.argv[2] || 'local';
const envName = envArg.toLowerCase();

const envFiles = {
  local: '.env.development',
  dev: '.env.development',
  development: '.env.development',
  uat: '.env.uat',
  prod: '.env.production',
  production: '.env.production',
};

const envFile = envFiles[envName];
if (!envFile) {
  console.error(`Unknown environment "${envArg}". Use one of: local, uat, prod`);
  process.exit(1);
}

const envPath = path.join(__dirname, '..', envFile);
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Do not override values already present in the environment
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  console.log(`Loaded environment config: ${envFile}`);
} else {
  console.warn(`Environment file not found: ${envFile}. Relying on process environment.`);
}

// Ensure NODE_ENV reflects the selected profile unless explicitly overridden.
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = envName === 'uat' ? 'production' : 'development';
}

require('../src/app.js');
