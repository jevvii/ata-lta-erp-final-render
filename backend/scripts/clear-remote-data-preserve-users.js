/**
 * Remote Supabase data reset script (Preserving All Users).
 *
 * Clears/truncates all operational data tables in the public schema while preserving:
 * - ALL user accounts (`users`, `user_departments`)
 * - Core lookup/reference tables (`departments`, `entities`)
 * - Migration history tables (`remote_migrations`, `pgmigrations`)
 *
 * Usage:
 *   node scripts/clear-remote-data-preserve-users.js [env] [--force]
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
  staging: '.env.staging',
  prod: '.env.production',
  production: '.env.production',
  main: '.env.production',
};

if (envArg.toLowerCase() === 'uat') {
  console.error('❌ The UAT environment connection has been disabled because it was converted to the Main Render deployment.');
  console.error('   Aborting data clear to prevent accidental production data loss.');
  process.exit(1);
}

const envFile = envFiles[envArg.toLowerCase()];
if (!envFile) {
  console.error(`Unknown environment "${envArg}". Use one of: local, staging, prod, main`);
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

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET;

if (!supabaseUrl || !supabaseServiceKey || !storageBucket) {
  console.error('❌ Missing storage configuration: SUPABASE_URL, SUPABASE_SERVICE_KEY, and SUPABASE_STORAGE_BUCKET are required for remote data cleanup.');
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

async function listAllStorageFiles(supabase, bucket, folder = '') {
  const limit = 100;
  let offset = 0;
  let files = [];

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(folder, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });

    if (error) {
      throw new Error(`Failed to list storage objects in bucket "${bucket}" at path "${folder || '/'}" (offset ${offset}): ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    for (const item of data) {
      const itemPath = folder ? `${folder}/${item.name}` : item.name;
      if (item.id === null) {
        const nested = await listAllStorageFiles(supabase, bucket, itemPath);
        files.push(...nested);
      } else {
        files.push(itemPath);
      }
    }

    if (data.length < limit) {
      break;
    }

    offset += limit;
  }

  return files;
}

async function run() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

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

    const { rows: preservedUsers } = await client.query(`
      SELECT id, email, name, role
      FROM users
      ORDER BY role ASC, email ASC;
    `);
    console.log(`\n👤 Preserved user accounts (${preservedUsers.length}):`);
    preservedUsers.forEach((u) => console.log(`   - ${u.name} <${u.email}> (${u.role})`));

    console.log(`\n🧹 Tables to truncate (${tablesToClear.length}):`);
    tablesToClear.forEach((t) => console.log(`   - ${t}`));

    const storageFiles = await listAllStorageFiles(supabase, storageBucket);
    console.log(`\n📦 Supabase Storage files in "${storageBucket}" to remove (${storageFiles.length}):`);
    if (storageFiles.length <= 10) {
      storageFiles.forEach((f) => console.log(`   - ${f}`));
    } else {
      storageFiles.slice(0, 5).forEach((f) => console.log(`   - ${f}`));
      console.log(`   ... and ${storageFiles.length - 5} more files`);
    }

    if (!tablesToClear.length && !storageFiles.length) {
      console.log('\nNo operational data or storage files found to clear.');
      return;
    }

    if (!force) {
      console.log('\n⚠️ DRY RUN COMPLETE. Pass --force to execute truncation and storage cleanup.');
      return;
    }

    if (tablesToClear.length > 0) {
      console.log('\nTruncating data tables...');
      const quotedTables = tablesToClear.map((t) => `"${t}"`).join(', ');
      await client.query(`TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE;`);
      console.log('   ✅ Tables truncated.');
    }

    if (storageFiles.length > 0) {
      console.log(`\nDeleting ${storageFiles.length} file(s) from storage bucket "${storageBucket}"...`);
      const { error: storageErr } = await supabase.storage.from(storageBucket).remove(storageFiles);
      if (storageErr) {
        throw new Error(`Failed to delete storage files from bucket "${storageBucket}": ${storageErr.message}`);
      }
      console.log('   ✅ Storage files deleted.');
    }

    console.log(`\n✅ ${envArg.toUpperCase()} environment operational data successfully cleared (schemas, tables, and ALL user accounts preserved).`);
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error('Data clear failed:', err.message);
  process.exit(1);
});
