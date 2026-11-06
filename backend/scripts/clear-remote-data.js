/**
 * Remote Supabase data reset script.
 *
 * Clears/truncates all operational data tables in the public schema while preserving:
 * - System administrator account (`users`, `user_departments`)
 * - Core lookup/reference tables (`departments`, `entities`)
 * - Migration history tables (`remote_migrations`, `pgmigrations`)
 *
 * It also cleans up non-admin users from Supabase Auth and removes orphaned
 * documents from the Supabase storage bucket.
 *
 * Usage:
 *   node scripts/clear-remote-data.js [env] [--force]
 *
 * env = local | staging | uat | prod (default: local)
 *
 * Requires --force to actually execute truncation and deletion.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { truncateOperationalTables } = require('./truncate-operational-tables');
const { createClient } = require('@supabase/supabase-js');

const args = process.argv.slice(2);
const force =
  args.includes('--force') ||
  process.argv.includes('--force') ||
  process.env.npm_config_force === 'true' ||
  process.env.npm_config_force === '1';
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
  console.error(`Unknown environment "${envArg}". Use one of: local, staging, prod`);
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

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET;

// Tables to preserve (reference tables, migration logs, and tables handled via selective delete)
const PRESERVED_TABLES = new Set([
  'users',
  'user_departments',
  'departments',
  'entities',
  'remote_migrations',
  'pgmigrations',
]);

async function listAllStorageFiles(supabase, bucket, folder = '') {
  const { data, error } = await supabase.storage.from(bucket).list(folder);
  if (error || !data) return [];
  let files = [];
  for (const item of data) {
    const itemPath = folder ? `${folder}/${item.name}` : item.name;
    if (item.id === null) {
      const nested = await listAllStorageFiles(supabase, bucket, itemPath);
      files.push(...nested);
    } else {
      files.push(itemPath);
    }
  }
  return files;
}

async function run() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  let supabase = null;
  if (supabaseUrl && supabaseServiceKey) {
    supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

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

    console.log(`\n🔒 Preserved database tables (${preservedFound.length}):`);
    preservedFound.forEach((t) => console.log(`   - ${t}`));

    console.log(`\n🧹 Operational tables to truncate (${tablesToClear.length}):`);
    tablesToClear.forEach((t) => console.log(`   - ${t}`));

    // Check users in database
    const { rows: allDbUsers } = await client.query(`
      SELECT id, auth_user_id, email, name, role
      FROM users
      ORDER BY role ASC, email ASC;
    `);

    const preservedUsers = allDbUsers.filter((u) => u.role === 'Admin');
    const dbUsersToDelete = allDbUsers.filter((u) => u.role !== 'Admin');

    console.log(`\n👤 Preserved System Administrator account(s) (${preservedUsers.length}):`);
    preservedUsers.forEach((u) => console.log(`   - ${u.name} <${u.email}> (${u.role})`));

    console.log(`\n👥 Database user accounts to delete (${dbUsersToDelete.length}):`);
    dbUsersToDelete.forEach((u) => console.log(`   - ${u.name} <${u.email}> (${u.role})`));

    // Supabase Auth users
    let authUsersToDelete = [];
    if (supabase) {
      const { data: authData, error: authErr } = await supabase.auth.admin.listUsers();
      if (!authErr && authData?.users) {
        const adminEmails = new Set(preservedUsers.map((u) => u.email.toLowerCase()));
        authUsersToDelete = authData.users.filter((u) => !adminEmails.has((u.email || '').toLowerCase()));
        console.log(`\n🔑 Supabase Auth accounts to remove (${authUsersToDelete.length}):`);
        authUsersToDelete.forEach((u) => console.log(`   - ${u.email} (Auth ID: ${u.id})`));
      }
    }

    // Storage files
    let storageFiles = [];
    if (supabase && storageBucket) {
      storageFiles = await listAllStorageFiles(supabase, storageBucket);
      console.log(`\n📦 Supabase Storage files in "${storageBucket}" to remove (${storageFiles.length}):`);
      if (storageFiles.length <= 10) {
        storageFiles.forEach((f) => console.log(`   - ${f}`));
      } else {
        storageFiles.slice(0, 5).forEach((f) => console.log(`   - ${f}`));
        console.log(`   ... and ${storageFiles.length - 5} more files`);
      }
    }

    if (!force) {
      console.log('\n⚠️  DRY RUN COMPLETE. Pass --force to execute cleanup.');
      return;
    }

    console.log('\n🚀 Executing clean-up with --force...\n');

    if (tablesToClear.length > 0) {
      console.log('1️⃣ Truncating operational tables with CASCADE...');
      await truncateOperationalTables(client, tablesToClear);
      console.log('   ✅ Tables truncated and review history protection restored.');
    }

    console.log('2️⃣ Cleaning up users table (retaining only System Administrator)...');
    const deleteResult = await client.query(`DELETE FROM users WHERE role != 'Admin';`);
    console.log(`   ✅ Deleted ${deleteResult.rowCount} non-admin user(s) from database.`);

    if (supabase && authUsersToDelete.length > 0) {
      console.log(`3️⃣ Removing ${authUsersToDelete.length} user(s) from Supabase Auth...`);
      for (const u of authUsersToDelete) {
        const { error: delErr } = await supabase.auth.admin.deleteUser(u.id);
        if (delErr) {
          console.error(`   ⚠️ Failed to delete Auth user ${u.email}: ${delErr.message}`);
        } else {
          console.log(`   Deleted Auth user ${u.email}`);
        }
      }
      console.log('   ✅ Supabase Auth users removed.');
    }

    if (supabase && storageBucket && storageFiles.length > 0) {
      console.log(`4️⃣ Deleting ${storageFiles.length} file(s) from storage bucket "${storageBucket}"...`);
      const { error: storageErr } = await supabase.storage.from(storageBucket).remove(storageFiles);
      if (storageErr) {
        console.error(`   ⚠️ Failed to delete storage files: ${storageErr.message}`);
      } else {
        console.log('   ✅ Storage files deleted.');
      }
    }

    console.log('\n✅ UAT environment successfully cleaned!');
    console.log('   - Operational tables truncated.');
    console.log('   - Non-admin users removed from database and Supabase Auth.');
    console.log('   - Storage files cleared.');
    console.log('   - System Administrator account preserved.');
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error('Data clear failed:', err.message);
  process.exit(1);
});
