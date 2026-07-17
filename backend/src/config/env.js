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
    jwtSecret: process.env.SUPABASE_JWT_SECRET || '',
  },

  aws: {
    region: process.env.AWS_REGION || 'ap-southeast-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    endpoint: process.env.AWS_ENDPOINT_URL || '',
  },

  s3: {
    documentBucket: process.env.S3_DOCUMENT_BUCKET || '',
    spaBucket: process.env.S3_SPA_BUCKET || '',
  },

  cloudfront: {
    keyId: process.env.CLOUDFRONT_KEY_ID || '',
    privateKey: (process.env.CLOUDFRONT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    documentDomain: process.env.CLOUDFRONT_DOCUMENT_DOMAIN || '',
  },

  databaseUrl: process.env.DATABASE_URL || '',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:8080',
  logLevel: process.env.LOG_LEVEL || 'info',
};

module.exports = env;
