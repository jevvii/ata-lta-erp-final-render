/**
 * Environment configuration.
 * Centralizes access to process.env with defaults and validation.
 */

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isDevelopment: (process.env.NODE_ENV || 'development') === 'development',
  port: Number.isNaN(parseInt(process.env.PORT, 10)) ? 3000 : parseInt(process.env.PORT, 10),

  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceKey: process.env.SUPABASE_SERVICE_KEY || '',
  },

  storage: {
    bucket: process.env.SUPABASE_STORAGE_BUCKET || '',
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
