/**
 * Centralized error handler.
 * Returns RFC 7807 Problem Details responses.
 * Never leaks stack traces or database internals to clients.
 */

const AppError = require('../lib/AppError');
const env = require('../config/env');
const logger = require('../lib/logger');

const errorHandler = (err, req, res, _next) => {
  const isOperational = err instanceof AppError;

  const status = err.statusCode || err.status || 500;
  const title = isOperational ? err.title : 'Internal Server Error';
  const detail = isOperational
    ? err.detail
    : env.isDevelopment
      ? err.message
      : 'An unexpected error occurred.';

  const response = {
    status,
    title,
    detail,
    ...(err.code && { code: err.code }),
  };

  logger.error('unhandled error', {
    status,
    title,
    detail,
    stack: env.isDevelopment ? err.stack : undefined,
    requestId: req.id,
  });

  res.status(status).json(response);
};

module.exports = errorHandler;
