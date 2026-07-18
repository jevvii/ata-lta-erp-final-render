/**
 * Verify that the backend can connect to Supabase Auth and that a given user
 * exists / can sign in.
 *
 * Usage:
 *   node scripts/verify-supabase-auth.js <email> [password]
 *
 * If password is omitted, the script only checks that the user exists in
 * Supabase Auth and in the local users table.
 *
 * The script reads credentials from backend/.env.development by default.
 * Pass "uat" as the last argument to read .env.uat instead.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');

const emailArg = process.argv[2];
const passwordArg = process.argv[3];
const envArg = process.argv[process.argv.length - 1] === 'uat' ? 'uat' : 'local';

if (!emailArg) {
  console.error('Usage: node scripts/verify-supabase-auth.js <email> [password] [uat]');
  process.exit(1);
}

const envFiles = {
  local: '.env.development',
  uat: '.env.uat',
};

const envPath = path.join(__dirname, '..', envFiles[envArg]);
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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const databaseUrl = process.env.DATABASE_URL;

if (!supabaseUrl || !serviceKey || !databaseUrl) {
  console.error('SUPABASE_URL, SUPABASE_SERVICE_KEY, and DATABASE_URL are required');
  process.exit(1);
}

async function run() {
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Using Supabase URL: ${supabaseUrl}`);
  console.log(`Checking user: ${emailArg}\n`);

  // 1. Check Supabase Auth user
  const { data: listData, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    console.error('❌ Failed to list Supabase Auth users:', listError.message);
    process.exit(1);
  }

  const authUser = (listData?.users || []).find((u) => u.email === emailArg);
  if (!authUser) {
    console.error(`❌ No Supabase Auth user found with email ${emailArg}`);
    console.log('\nAvailable Auth users:');
    (listData?.users || []).forEach((u) => console.log(`  - ${u.email} (${u.id})`));
    process.exit(1);
  }

  console.log('✅ Supabase Auth user exists');
  console.log(`   id:       ${authUser.id}`);
  console.log(`   email:    ${authUser.email}`);
  console.log(`   confirmed: ${authUser.email_confirmed_at ? 'yes' : 'no'}`);
  console.log(`   created:  ${authUser.created_at}`);

  // 2. Check local users table mapping
  const pg = new Client({ connectionString: databaseUrl });
  await pg.connect();
  try {
    const { rows } = await pg.query(
      'SELECT id, auth_user_id, email, name, role, entities, is_active FROM users WHERE email = $1',
      [emailArg]
    );
    if (!rows.length) {
      console.error(`\n❌ No row in the users table for ${emailArg}`);
      console.log('Run the migration/seed or manually insert a row with auth_user_id =', authUser.id);
      process.exit(1);
    }

    const row = rows[0];
    console.log('\n✅ Row found in users table');
    console.log(`   id:            ${row.id}`);
    console.log(`   auth_user_id:  ${row.auth_user_id}`);
    console.log(`   role:          ${row.role}`);
    console.log(`   entities:      ${JSON.stringify(row.entities)}`);
    console.log(`   is_active:     ${row.is_active}`);

    if (row.auth_user_id !== authUser.id) {
      console.error('\n⚠️  auth_user_id mismatch!');
      console.error(`   Supabase Auth id: ${authUser.id}`);
      console.error(`   users.auth_user_id: ${row.auth_user_id}`);
      console.log(`\nFix with:`);
      console.log(`UPDATE users SET auth_user_id = '${authUser.id}' WHERE email = '${emailArg}';`);
      process.exit(1);
    }

    if (!row.is_active) {
      console.error('\n⚠️  User is disabled (is_active = false). Login will be rejected.');
      process.exit(1);
    }
  } finally {
    await pg.end();
  }

  // 3. Try password sign in if password provided
  if (passwordArg) {
    console.log('\n🔐 Attempting sign-in with provided password...');
    const { data, error } = await supabase.auth.signInWithPassword({ email: emailArg, password: passwordArg });
    if (error) {
      console.error('❌ Sign-in failed:', error.message);
      console.error('   statusCode:', error.status);
      process.exit(1);
    }
    console.log('✅ Sign-in succeeded');
    console.log(`   access token length: ${data.session.access_token.length}`);
  }

  console.log('\n✅ All checks passed. If the SPA still fails, check the browser console and backend logs.');
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
