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
const { idempotencyMiddleware } = require('./middleware/idempotency');

// Module routers (stubs)
const clientsRouter = require('./modules/clients/routes');
const documentsRouter = require('./modules/documents/routes');
const operationsRouter = require('./modules/operations/routes');
const { tasksRouter } = require('./modules/operations/routes');
const billingRouter = require('./modules/billing/routes');
const disbursementsRouter = require('./modules/disbursements/routes');
const transmittalsRouter = require('./modules/transmittals/routes');
const reportsRouter = require('./modules/reports/routes');
const adminRouter = require('./modules/admin/routes');
const operationsRequestsRouter = require('./modules/operationsRequests/routes');

const app = express();
app.set('trust proxy', 1); // Trust Render/reverse proxy headers (X-Forwarded-For)

// Explicit CORS whitelist. A wildcard regex for *.onrender.com previously let
// ANY site hosted on Render (including malicious third-party accounts) make
// credentialed cross-origin requests to this API. Only our own SPA origins
// are permitted (Spec 1.2).
const ALLOWED_ORIGINS = new Set([
  'https://ata-lta-erp-spa-main.onrender.com',
  'https://ata-lta-erp-spa-staging.onrender.com',
  'https://ata-lta-erp-spa-uat.onrender.com',
]);

const isAllowedOrigin = (origin) => {
  if (!origin) return true; // Non-browser agents (curl, server-to-server)
  if (env.isDevelopment) return true;
  if (origin === env.frontendUrl) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return ALLOWED_ORIGINS.has(origin);
};

// Security middleware
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  cors({
    origin: (origin, callback) => {
      callback(null, isAllowedOrigin(origin));
    },
    credentials: true,
    // Idempotency-Key / If-Match / X-Request-Id support the concurrency and
    // idempotency controls rolled out in Phase 2.
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Active-Entity',
      'Idempotency-Key',
      'If-Match',
      'X-Request-Id',
    ],
    exposedHeaders: ['X-Request-Id', 'ETag', 'Idempotent-Replay'],
  })
);

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
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Allow 1000 requests per 15 minutes per client IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      status: 429,
      title: 'Too Many Requests',
      detail: 'Rate limit exceeded. Please slow down.',
    },
  })
);

// Compression for response bodies
app.use(compression());

// Cache-Control headers for API responses.
// GET /v1/* responses are cacheable for 30s to reduce redundant round-trips
// during rapid SPA navigation. Mutations always get no-store.
app.use((req, res, next) => {
  if (!req.path.startsWith('/v1/')) return next();
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    // The active entity is sent in a header, not the URL, so vary the cache by it.
    // Without this, switching between ATA/LTA/ALL serves the previous entity's data.
    res.setHeader('Vary', 'X-Active-Entity');
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

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
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), HEALTH_CHECK_TIMEOUT_MS)
      ),
    ]);
    checks.supabase = true;
  } catch (e) {
    logger.warn('health check failed: supabase', { error: e.message, requestId: req.id });
  }
  try {
    await Promise.race([
      supabaseAdmin.storage.listBuckets(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), HEALTH_CHECK_TIMEOUT_MS)
      ),
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

// Decoupled probes (Spec 3.2). Mounted BEFORE the auth middleware so load
// balancers and the read-only smoke test can reach them without credentials.
// Liveness: instant 200 as long as the event loop is responsive.
app.get('/livez', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Readiness: un-cached live check of PostgreSQL and Supabase Storage with a
// 3-second timeout per dependency. Traffic should only be routed here when
// this returns 200.
const READINESS_TIMEOUT_MS = 3_000;
const withTimeout = (promise) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Probe timeout')), READINESS_TIMEOUT_MS)
    ),
  ]);

app.get('/readyz', async (req, res) => {
  try {
    await Promise.all([
      withTimeout(supabaseAdmin.from('entities').select('id').limit(1)),
      withTimeout(supabaseAdmin.storage.listBuckets()),
    ]);
    res.status(200).json({ status: 'ready', timestamp: new Date().toISOString() });
  } catch (err) {
    logger.warn('readiness probe failed', { error: err.message, requestId: req.id });
    res.status(503).json({
      status: 'not_ready',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

const isStrictRateLimit = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test';
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isStrictRateLimit ? 10 : 500, // Max 10 attempts per IP in prod/test, 500 in dev/staging/QA
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 429,
    title: 'Too Many Requests',
    detail: 'Too many authentication attempts. Please try again in 15 minutes.',
  },
});
app.use('/v1/auth/signin', authLimiter);
app.use('/v1/auth', require('./modules/auth/routes'));

// Authenticated / scoped routes
app.use(auth);
app.use(entityScope);

// Idempotency-Key replay protection for mutating requests (Spec 2.1 / R-08).
// Mounted after auth + entityScope so records can be scoped to
// `${userId}:${entityCode}`. Requests without the header pass through
// unchanged, keeping older SPA builds fully functional during rollout.
app.use('/v1', idempotencyMiddleware);

// API v1 module routes (stubs)
app.use('/v1/me', require('./modules/me/routes'));
app.use('/v1/clients', clientsRouter);
app.use('/v1/documents', documentsRouter);
app.use('/v1/work-requests', operationsRouter);
app.use('/v1/tasks', tasksRouter);
app.use('/v1/invoices', billingRouter);
app.use('/v1/disbursements', disbursementsRouter);
app.use('/v1/transmittals', transmittalsRouter);
// Reports endpoints set their own Cache-Control in the controller.
// Re-assert Vary: X-Active-Entity so entity-scoped responses are not cached
// across ATA / LTA / ALL switches.
app.use('/v1/reports', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.setHeader('Vary', 'X-Active-Entity');
  }
  next();
});
app.use('/v1/reports', reportsRouter);
app.use('/v1/admin', adminRouter);
app.use('/v1/operations-requests', operationsRequestsRouter);

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
