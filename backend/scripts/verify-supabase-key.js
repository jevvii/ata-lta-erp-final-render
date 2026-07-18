/**
 * Verify the Supabase URL + service key configured for the backend.
 *
 * Usage:
 *   node scripts/verify-supabase-key.js [env]
 *
 * env = local | uat (default: local)
 *
 * Checks:
 *   - URL and key are present
 *   - Key looks like a JWT and its payload claims (ref, role) match the URL
 *   - Supabase Auth responds to a simple admin API call
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envArg = process.argv[2] || 'local';
const envFiles = {
  local: '.env.development',
  uat: '.env.uat',
};

const envPath = path.join(__dirname, '..', envFiles[envArg] || '.env.development');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  });
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

console.log('Env file:', envPath);
console.log('SUPABASE_URL:', url || 'MISSING');
console.log('SUPABASE_SERVICE_KEY present:', key ? 'yes' : 'NO');
console.log('');

if (!url || !key) {
  console.error('Both SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  process.exit(1);
}

// Basic format checks
if (!url.startsWith('https://') || !url.endsWith('.supabase.co')) {
  console.error('❌ SUPABASE_URL does not look like a valid Supabase project URL');
  process.exit(1);
}

const urlRef = url.replace('https://', '').replace('.supabase.co', '');
console.log('Project ref from URL:', urlRef);

const parts = key.split('.');
if (parts.length !== 3) {
  console.error('❌ SUPABASE_SERVICE_KEY is not a valid JWT (should have 3 dot-separated parts)');
  console.log('   A service key normally starts with "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."');
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
} catch (e) {
  console.error('❌ Could not decode the JWT payload from the service key');
  process.exit(1);
}

console.log('JWT payload:', JSON.stringify(payload, null, 2));
console.log('');

if (payload.role !== 'service_role') {
  console.warn(`⚠️  Key role is "${payload.role}" — expected "service_role"`);
  console.log('   You may have copied the ANON key instead of the SERVICE ROLE key.');
} else {
  console.log('✅ Key role is service_role');
}

const jwtRef = payload.ref;
if (jwtRef && jwtRef !== urlRef) {
  console.error(`❌ JWT ref "${jwtRef}" does not match URL ref "${urlRef}"`);
  console.log('   The service key belongs to a different Supabase project than the URL.');
  process.exit(1);
} else if (jwtRef) {
  console.log('✅ JWT ref matches Supabase URL');
}

async function run() {
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log('\nCalling Supabase Auth admin.listUsers()...');
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) {
    console.error('❌ Supabase Auth rejected the key:', error.message);
    console.error('   statusCode:', error.status);
    process.exit(1);
  }

  console.log('✅ Supabase Auth accepted the key');
  console.log(`   Users visible: ${data?.users?.length ?? 0}`);
  if (data?.users?.length) {
    console.log('   Example user:', data.users[0].email);
  }
}

run().catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
