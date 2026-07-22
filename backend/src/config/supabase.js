/**
 * Supabase client configuration.
 */

const { createClient } = require('@supabase/supabase-js');
const env = require('./env');

let supabaseAdmin;

if (!env.supabase.url || !env.supabase.serviceKey) {
  // Defer the error to runtime so the module graph can load in test/migration
  // environments that immediately mock this client.
  supabaseAdmin = {
    auth: {
      getUser: () => {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
      },
    },
    from: () => {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
    },
    rpc: () => {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
    },
  };
} else {
  supabaseAdmin = createClient(env.supabase.url, env.supabase.serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

module.exports = { supabaseAdmin };
