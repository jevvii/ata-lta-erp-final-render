/**
 * Custom operational error class.
 */

class AppError extends Error {
  /**
   * @param {Object} params
   * @param {number} params.statusCode HTTP status code
   * @param {string} params.title Short title
   * @param {string} params.detail Human-readable detail
   * @param {string} [params.code] Machine-readable error code
   */
  constructor({ statusCode, title, detail, code }) {
    super(detail);
    this.statusCode = statusCode;
    this.title = title;
    this.detail = detail;
    this.code = code || null;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
