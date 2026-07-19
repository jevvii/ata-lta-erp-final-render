/**
 * ATA & LTA ERP Backend
 *
 * Express application entry point.
 * Global middleware and module route mounting.
 * Module routes are intentionally stubbed; implementation happens per phase.
 */

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { randomUUID } = require('crypto');

const env = require('./config/env');
const logger = require('./lib/logger');
const { supabaseAdmin } = require('./services/supabaseClient');
const errorHandler = require('./middleware/errorHandler');
const { auth } = require('./middleware/auth');
const { entityScope } = require('./middleware/entityScope');

// Module routers (stubs)
const clientsRouter = require('./modules/clients/routes');
const documentsRouter = require('./modules/documents/routes');
const operationsRouter = require('./modules/operations/routes');
const billingRouter = require('./modules/billing/routes');
const disbursementsRouter = require('./modules/disbursements/routes');
const transmittalsRouter = require('./modules/transmittals/routes');
const reportsRouter = require('./modules/reports/routes');
const adminRouter = require('./modules/admin/routes');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: env.isDevelopment ? true : env.frontendUrl,
  credentials: true,
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Active-Entity'],
  exposedHeaders: ['X-Request-Id'],
}));

// Structured request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    logger.info('request', {
      method: req.method,
      originalUrl: req.originalUrl,
      status: res.statusCode,
      durationMs,
      requestId: req.id,
    });
    if (durationMs > 1000) {
      logger.warn('slow request', {
        method: req.method,
        url: req.originalUrl,
        durationMs,
        requestId: req.id,
      });
    }
  });
  next();
});

// Body parsing
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));

// Request ID
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});

// Rate limiting
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.isDevelopment ? 1000 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 429,
    title: 'Too Many Requests',
    detail: 'Rate limit exceeded. Please slow down.',
  },
}));

// Compression for response bodies
app.use(compression());

// Extended health check with dependency verification.
// Cached for 30 s to avoid hammering dependencies under load;
// each probe has a 5 s timeout so partial outages don't stall the endpoint.
const HEALTH_CACHE_TTL_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;
let healthCache = null;
let healthCacheExpiry = 0;

app.get('/health', async (req, res) => {
  const now = Date.now();
  if (healthCache && now < healthCacheExpiry) {
    return res.status(healthCache.ok ? 200 : 503).json(healthCache.body);
  }

  const checks = { supabase: false, storage: false };
  try {
    await Promise.race([
      supabaseAdmin.from('entities').select('id').limit(1),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), HEALTH_CHECK_TIMEOUT_MS)),
    ]);
    checks.supabase = true;
  } catch (e) {
    logger.warn('health check failed: supabase', { error: e.message, requestId: req.id });
  }
  try {
    await Promise.race([
      supabaseAdmin.storage.listBuckets(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), HEALTH_CHECK_TIMEOUT_MS)),
    ]);
    checks.storage = true;
  } catch (e) {
    logger.warn('health check failed: storage', { error: e.message, requestId: req.id });
  }
  const ok = checks.supabase && checks.storage;
  const body = {
    status: ok ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  };

  healthCache = { ok, body };
  healthCacheExpiry = now + HEALTH_CACHE_TTL_MS;

  res.status(ok ? 200 : 503).json(body);
});

// Public routes
app.use('/v1/auth', require('./modules/auth/routes'));

// Authenticated / scoped routes
app.use(auth);
app.use(entityScope);

// API v1 module routes (stubs)
app.use('/v1/me', require('./modules/me/routes'));
app.use('/v1/clients', clientsRouter);
app.use('/v1/documents', documentsRouter);
app.use('/v1/work-requests', operationsRouter);
app.use('/v1/invoices', billingRouter);
app.use('/v1/disbursements', disbursementsRouter);
app.use('/v1/transmittals', transmittalsRouter);
app.use('/v1/reports', reportsRouter);
app.use('/v1/admin', adminRouter);

// 404 handler
app.use((req, res, _next) => {
  res.status(404).json({
    status: 404,
    title: 'Not Found',
    detail: `Cannot ${req.method} ${req.path}`,
  });
});

// Global error handler
app.use(errorHandler);

const server = app.listen(env.port, () => {
  logger.info('server started', { port: env.port, env: env.nodeEnv });
});

module.exports = { app, server };
