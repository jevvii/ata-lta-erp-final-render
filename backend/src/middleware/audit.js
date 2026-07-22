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
    const originalJson = res.json;
    let responseBody = null;
    res.json = function (body) {
      responseBody = body;
      return originalJson.apply(this, arguments);
    };

    const finishHandler = () => {
      res.removeListener('finish', finishHandler);

      if (res.statusCode >= 400) return;
      if (res.locals.auditLogged) return;

      const auditMeta = res.locals.audit || {};
      const resData = responseBody?.data || responseBody;

      const recordId = auditMeta.recordId || req.params?.id || resData?.id || resData?.recordId || null;

      const details = { ...(auditMeta.details || {}) };
      if (resData && typeof resData === 'object') {
        const itemNum = resData.disbursementNumber || resData.disbursement_number ||
                        resData.trackingNumber || resData.tracking_number ||
                        resData.invoiceNumber || resData.invoice_number ||
                        resData.voucherNumber || resData.voucher_number ||
                        resData.workRequestTitle || resData.title || resData.name || resData.email;
        if (itemNum && !details.disbursementNumber && !details.trackingNumber && !details.invoiceNumber && !details.name && !details.title) {
          details.name = String(itemNum);
        }
      }

      auditService
        .log({
          action: auditMeta.action || action,
          table: auditMeta.table || options.table,
          recordId,
          entity: req.entityCode || req.activeEntity || null,
          userId: req.user?.id || null,
          details,
        })
        .catch(() => {
          // Swallow; auditService already logs errors.
        });
    };

    res.on('finish', finishHandler);
    next();
  };
};

module.exports = { audit };
