/**
 * Create the Supabase Storage bucket used by the application.
 *
 * Usage:
 *   node scripts/create-storage-bucket.js [env]
 *
 * env = local | uat | prod (default: local)
 *
 * Reads SUPABASE_URL, SUPABASE_SERVICE_KEY, and SUPABASE_STORAGE_BUCKET from the
 * matching .env.* file. The bucket is created as a private bucket with default
 * RLS policies disabled; configure policies in the Supabase dashboard for
 * production/UAT.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  console.log(`Loaded environment config: ${envFile}`);
} else {
  console.warn(`Environment file not found: ${envFile}. Relying on process environment.`);
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET;

if (!supabaseUrl || !serviceKey || !bucket) {
  console.error('SUPABASE_URL, SUPABASE_SERVICE_KEY, and SUPABASE_STORAGE_BUCKET are required');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function run() {
  console.log(`Ensuring bucket exists: ${bucket}`);

  const { data: existing, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    console.error('Failed to list buckets:', listError.message);
    process.exit(1);
  }

  if (existing?.some((b) => b.name === bucket)) {
    console.log(`Bucket "${bucket}" already exists.`);
    return;
  }

  const { error } = await supabase.storage.createBucket(bucket, {
    public: false,
  });

  if (error) {
    console.error('Failed to create bucket:', error.message);
    process.exit(1);
  }

  console.log(`✅ Created bucket "${bucket}".`);
  console.log('Remember to configure Storage RLS policies in the Supabase dashboard.');
}

run().catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
