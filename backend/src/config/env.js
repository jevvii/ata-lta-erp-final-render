/**
 * Environment configuration.
 * Centralizes access to process.env with defaults and validation.
 */

// Only browser-safe keys may cross the unauthenticated public-config boundary.
function publicSupabaseKey(value) {
  const key = (value || '').trim();
  if (key === process.env.SUPABASE_SERVICE_KEY) return '';
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return key;
  try {
    const parts = key.split('.');
    if (parts.length !== 3) return '';
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload.role === 'anon' ? key : '';
  } catch {
    return '';
  }
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isDevelopment: (process.env.NODE_ENV || 'development') === 'development',
  port: Number.isNaN(parseInt(process.env.PORT, 10)) ? 3000 : parseInt(process.env.PORT, 10),

  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceKey: process.env.SUPABASE_SERVICE_KEY || '',
    anonKey: publicSupabaseKey(process.env.SUPABASE_ANON_KEY),
  },

  storage: {
    bucket: process.env.SUPABASE_STORAGE_BUCKET || '',
    avatarBucket: process.env.SUPABASE_AVATARS_BUCKET || 'avatars',
  },

  databaseUrl: process.env.DATABASE_URL || '',
  frontendUrl: (() => {
    const raw = process.env.FRONTEND_URL || 'http://localhost:8080';
    // Render Blueprint fromService gives us a bare hostname; ensure a full https origin.
    if (/^https?:\/\//.test(raw)) return raw;
    return `https://${raw}`;
  })(),
  logLevel: process.env.LOG_LEVEL || 'info',
};

module.exports = env;
