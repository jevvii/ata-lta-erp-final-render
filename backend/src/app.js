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
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { randomUUID } = require('crypto');

const env = require('./config/env');
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

// Request logging
app.use(morgan(env.isDevelopment ? 'dev' : 'combined'));

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

// Public health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
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
  // eslint-disable-next-line no-console
  console.log(`ERP API listening on port ${env.port} in ${env.nodeEnv} mode`);
});

module.exports = { app, server };
