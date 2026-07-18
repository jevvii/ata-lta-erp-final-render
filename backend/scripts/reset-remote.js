/**
 * Remote Supabase database reset helper.
 *
 * Drops all tables, indexes, and migration bookkeeping in the public schema so
 * you can rerun migrations from a clean state.
 *
 * Usage:
 *   node scripts/reset-remote.js [env] [--force]
 *
 * env = local | uat | prod (default: local)
 *
 * Requires --force to actually drop anything. Without --force it only prints the
 * tables it would drop.
 *
 * DANGER: This deletes data. Only use on dev/UAT after backing up.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const envArg = process.argv[2] || 'local';
const force = process.argv.includes('--force');

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

    if (!tables.length) {
      console.log('No tables found in public schema.');
      return;
    }

    console.log(`Tables to drop in public schema (${tables.length}):`);
    tables.forEach((r) => console.log(`  - ${r.table_name}`));

    if (!force) {
      console.log('\nDry run complete. Pass --force to actually drop tables.');
      return;
    }

    console.log('\nDropping tables...');

    // Drop in reverse dependency order is safest, but CASCADE handles most of it.
    for (const { table_name } of tables.slice().reverse()) {
      await client.query(`DROP TABLE IF EXISTS "${table_name}" CASCADE`);
      console.log(`  dropped ${table_name}`);
    }

    console.log('\n✅ Remote database reset complete.');
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error('Reset failed:', err.message);
  process.exit(1);
});
