/**
 * Audit logging middleware.
 * Records mutating requests to the audit_logs table after the response finishes.
 *
 * Controllers should set res.locals.audit = { action, table, recordId, details }
 * for this middleware to persist an audit row.
 */

const auditService = require('../services/auditService');

/**
 * Middleware factory for audit logging.
 * @param {string} action
 * @param {Object} [options]
 * @param {string} [options.table]
 * @returns {Function}
 */
const audit = (action, options = {}) => {
  return async (req, res, next) => {
    const finishHandler = () => {
      res.removeListener('finish', finishHandler);

      const auditMeta = res.locals.audit || {};
      if (res.statusCode >= 400) return;

      auditService.log({
        action: auditMeta.action || action,
        table: auditMeta.table || options.table,
        recordId: auditMeta.recordId || null,
        // resolveEntity() overrides req.activeEntity to the entity UUID (36 chars),
        // which exceeds audit_logs.entity varchar(10). Use the preserved short code.
        entity: req.entityCode || req.activeEntity || null,
        userId: req.user?.id || null,
        details: auditMeta.details || {},
      }).catch(() => {
        // Swallow; auditService already logs errors.
      });
    };

    res.on('finish', finishHandler);
    next();
  };
};

module.exports = { audit };
