/** Read-only migration inventory. This command never applies DDL, seeds, or ledger changes. */
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const dotenv = require('dotenv');

const profiles = {
  local: '.env.development',
  staging: '.env.staging',
  main: '.env.production',
  prod: '.env.production',
};
const profile = process.argv[2] || 'local';
if (!profiles[profile]) throw new Error('Select local, staging, main, or prod.');
dotenv.config({
  path: path.join(__dirname, '..', profiles[profile]),
  override: false,
  quiet: true,
});

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const files = fs
    .readdirSync(path.join(__dirname, '..', 'migrations'))
    .filter((f) => /\.(js|sql)$/.test(f))
    .sort();
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const {
      rows: [tables],
    } = await client.query(
      "SELECT to_regclass('public.remote_migrations') AS remote, to_regclass('public.pgmigrations') AS pgm"
    );
    const applied = tables.remote
      ? (await client.query('SELECT name FROM public.remote_migrations')).rows.map((r) => r.name)
      : [];
    const legacy = tables.pgm
      ? (await client.query('SELECT name FROM public.pgmigrations')).rows.map((r) => r.name)
      : [];
    const pending = files.filter((name) => !applied.includes(name));
    const summary = {
      profile,
      migrationFiles: files.length,
      remoteLedgerPresent: Boolean(tables.remote),
      appliedMigrationFiles: files.length - pending.length,
      pending,
      legacyLedgerEntries: legacy.length,
    };
    console.log(JSON.stringify(summary, null, 2));
    await client.query('ROLLBACK');
    if (pending.length) process.exitCode = 1;
  } finally {
    await client.end();
  }
}
run().catch((err) => {
  console.error('Read-only migration check failed:', err.code || err.name);
  process.exitCode = 1;
});
