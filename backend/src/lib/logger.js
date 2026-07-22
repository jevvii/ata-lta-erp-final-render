/**
 * Minimal structured JSON logger.
 * Outputs one JSON object per line for easy parsing by log aggregators.
 * Each entry includes a timestamp and the current environment.
 */

const env = require('../config/env');

/**
 * Build a structured log payload.
 * @param {string} level
 * @param {string} msg
 * @param {object} meta
 * @returns {string} JSON string
 */
const format = (level, msg, meta) =>
  JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    env: env.nodeEnv,
    msg,
    ...meta,
  });

const logger = {
  /* eslint-disable no-console */
  info: (msg, meta = {}) => console.log(format('info', msg, meta)),
  warn: (msg, meta = {}) => console.warn(format('warn', msg, meta)),
  error: (msg, meta = {}) => console.error(format('error', msg, meta)),
  /* eslint-enable no-console */
};

module.exports = logger;
