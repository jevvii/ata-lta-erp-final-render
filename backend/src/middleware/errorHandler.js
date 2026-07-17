/**
 * Centralized error handler.
 * Returns RFC 7807 Problem Details responses.
 * Never leaks stack traces or database internals to clients.
 */

const AppError = require('../lib/AppError');
const env = require('../config/env');

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

  // eslint-disable-next-line no-console
  console.error('[ERROR]', err);

  res.status(status).json(response);
};

module.exports = errorHandler;
