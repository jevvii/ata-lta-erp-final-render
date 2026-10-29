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

      const recordId =
        auditMeta.recordId || req.params?.id || resData?.id || resData?.recordId || null;

      const details = { ...(auditMeta.details || {}) };
      if (resData && typeof resData === 'object') {
        const wrNum = resData.workRequestNumber || resData.work_request_number || resData.workRequestNo;
        if (wrNum) {
          if (!details.workRequestNumber) details.workRequestNumber = wrNum;
          if (!details.workRequestNo) details.workRequestNo = wrNum;
          if (!details.work_request_number) details.work_request_number = wrNum;
        }

        const clientNum = resData.clientNumber || resData.client_number;
        if (clientNum) {
          if (!details.clientNumber) details.clientNumber = clientNum;
          if (!details.client_number) details.client_number = clientNum;
        }

        const userNum = resData.userNumber || resData.user_number;
        if (userNum) {
          if (!details.userNumber) details.userNumber = userNum;
          if (!details.user_number) details.user_number = userNum;
        }

        const invNum = resData.invoiceNumber || resData.invoice_number;
        if (invNum) {
          if (!details.invoiceNumber) details.invoiceNumber = invNum;
          if (!details.invoice_number) details.invoice_number = invNum;
        }

        const disbNum = resData.disbursementNumber || resData.disbursement_number;
        if (disbNum) {
          if (!details.disbursementNumber) details.disbursementNumber = disbNum;
          if (!details.disbursement_number) details.disbursement_number = disbNum;
        }

        const trkNum =
          resData.trackingNumber ||
          resData.tracking_number ||
          resData.transmittalNumber ||
          resData.transmittal_number;
        if (trkNum) {
          if (!details.trackingNumber) details.trackingNumber = trkNum;
          if (!details.tracking_number) details.tracking_number = trkNum;
        }

        const itemNum =
          resData.disbursementNumber ||
          resData.disbursement_number ||
          resData.trackingNumber ||
          resData.tracking_number ||
          resData.invoiceNumber ||
          resData.invoice_number ||
          resData.voucherNumber ||
          resData.voucher_number ||
          resData.workRequestTitle ||
          resData.title ||
          resData.name ||
          resData.email;
        if (
          itemNum &&
          !details.disbursementNumber &&
          !details.trackingNumber &&
          !details.invoiceNumber &&
          !details.name &&
          !details.title
        ) {
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
