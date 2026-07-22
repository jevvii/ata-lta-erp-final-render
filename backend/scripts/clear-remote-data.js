/**
 * Remote Supabase data reset script.
 *
 * Clears/truncates all operational data tables in the public schema while preserving:
 * - User accounts (`users`, `user_departments`)
 * - Core lookup/reference tables (`departments`, `entities`)
 * - Migration history tables (`remote_migrations`, `pgmigrations`)
 *
 * Usage:
 *   node scripts/clear-remote-data.js [env] [--force]
 *
 * env = local | uat | prod (default: local)
 *
 * Requires --force to actually truncate table data.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const args = process.argv.slice(2);
const force = args.includes('--force');
const envArg = args.find((a) => !a.startsWith('--')) || 'local';

const envFiles = {
  local: '.env.development',
  dev: '.env.development',
  development: '.env.development',
  uat: '.env.uat',
  prod: '.env.production',
  production: '.env.production',
};

const envFile = envFiles[envArg.toLowerCase()];
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

// Tables to preserve (users, user department relations, reference tables, migration logs)
const PRESERVED_TABLES = new Set([
  'users',
  'user_departments',
  'departments',
  'entities',
  'remote_migrations',
  'pgmigrations',
]);

async function run() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const { rows: tables } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    const tablesToClear = tables
      .map((r) => r.table_name)
      .filter((name) => !PRESERVED_TABLES.has(name));

    const preservedFound = tables
      .map((r) => r.table_name)
      .filter((name) => PRESERVED_TABLES.has(name));

    console.log(`🔒 Preserved tables (${preservedFound.length}):`);
    preservedFound.forEach((t) => console.log(`   - ${t}`));

    console.log(`\n🧹 Tables to truncate (${tablesToClear.length}):`);
    tablesToClear.forEach((t) => console.log(`   - ${t}`));

    if (!tablesToClear.length) {
      console.log('\nNo operational tables found to clear.');
      return;
    }

    if (!force) {
      console.log('\n⚠️ DRY RUN COMPLETE. Pass --force to execute truncation.');
      return;
    }

    console.log('\nTruncating data tables...');
    const quotedTables = tablesToClear.map((t) => `"${t}"`).join(', ');
    await client.query(`TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE;`);

    console.log('Cleaning up users table (retaining only Admin users)...');
    await client.query(`DELETE FROM users WHERE role != 'Admin';`);

    console.log('\n✅ Remote database data successfully cleared (schemas and Admin users preserved).');
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error('Data clear failed:', err.message);
  process.exit(1);
});
