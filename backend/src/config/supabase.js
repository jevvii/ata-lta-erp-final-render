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
  // Enable HTTP Keep-Alive so the Supabase PostgREST HTTP client reuses
  // TCP/TLS connections instead of opening a new one for every query.
  const https = require('https');
  const http = require('http');
  const keepAliveHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 25 });
  const keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 25 });

  supabaseAdmin = createClient(
    env.supabase.url,
    env.supabase.serviceKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        fetch: (url, options = {}) => {
          const parsedUrl = typeof url === 'string' ? new URL(url) : url;
          const agent = parsedUrl.protocol === 'https:' ? keepAliveHttpsAgent : keepAliveHttpAgent;
          return fetch(url, { ...options, agent });
        },
      },
    }
  );
}

module.exports = { supabaseAdmin };
