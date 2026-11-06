/**
 * Billing / Invoices module routes.
 * Mounted at /v1/invoices by app.js.
 *
 * Phase 5 — Agent B
 */

const express = require('express');
const router = express.Router();
const { billingController } = require('./controller');
const { requirePermission, computePermissions } = require('../../middleware/rbac');
const { hasPermission } = require('../../lib/permissions');
const { audit } = require('../../middleware/audit');
const { resolveEntity } = require('../../middleware/resolveEntity');
const AppError = require('../../lib/AppError');

/**
 * Field-Level Security middleware for invoice updates (AC-4, R4).
 * If payload touches client address ('address' or 'clientAddress'), requires 'billing:edit_client_address'
 * (held by Accounting, Management, Admin).
 * If payload does NOT touch address, requires standard billing update permissions ('billing:edit' or 'billing:request').
 */
const fieldLevelSecurity = (req, res, next) => {
  if (!req.user) {
    return next(
      new AppError({
        statusCode: 401,
        title: 'Unauthorized',
        detail: 'Authentication required',
      })
    );
  }

  const permissions = computePermissions(req.user);

  // billing:edit_client_address resolves from the P0-A manifest
  // (Management, Accounting, Admin) — no inline grants.
  req.userPermissions = permissions;

  const hasAddressField = req.body && ('address' in req.body || 'clientAddress' in req.body);

  if (hasAddressField) {
    if (!hasPermission(permissions, 'billing:edit_client_address')) {
      return next(
        new AppError({
          statusCode: 403,
          title: 'Forbidden',
          detail: 'Permission billing:edit_client_address is required to modify client address',
        })
      );
    }
  } else {
    const allowed =
      hasPermission(permissions, 'billing:edit') || hasPermission(permissions, 'billing:request');
    if (!allowed) {
      return next(
        new AppError({
          statusCode: 403,
          title: 'Forbidden',
          detail: 'One of permissions [billing:edit, billing:request] is required',
        })
      );
    }
  }

  next();
};

// --- Badge Counts (before resolveEntity so ALL can be summed) ---
router.get(
  '/counts',
  resolveEntity({ allowAll: true }),
  requirePermission('billing:view'),
  billingController.getInvoiceCounts
);

// --- Listing and Read Endpoints (allowAll: true) ---
router.get(
  '/templates',
  resolveEntity({ allowAll: true }),
  requirePermission('billing:view'),
  billingController.listTemplates
);
router.get(
  '/aging',
  resolveEntity({ allowAll: true }),
  requirePermission('billing:view'),
  billingController.getAgingReport
);
router.get(
  '/',
  resolveEntity({ allowAll: true }),
  requirePermission('billing:view'),
  billingController.listInvoices
);
router.get(
  '/:id/pdf',
  resolveEntity({ allowAll: true }),
  requirePermission('billing:view'),
  billingController.getInvoicePdf
);
router.get(
  '/:id/voucher',
  resolveEntity({ allowAll: true }),
  requirePermission('billing:view'),
  billingController.getVoucherPdf
);
router.get(
  '/:id',
  resolveEntity({ allowAll: true }),
  requirePermission('billing:view'),
  billingController.getInvoice
);

// Resolve entity code → UUID for all remaining mutation routes in this module
router.use(resolveEntity());

// --- Billing Templates Mutations ---
router.post(
  '/templates',
  requirePermission('billing:templates'),
  audit('billing-template.create', { table: 'billing_templates' }),
  billingController.createTemplate
);
router.put(
  '/templates/:templateId',
  requirePermission('billing:templates'),
  audit('billing-template.update', { table: 'billing_templates' }),
  billingController.updateTemplate
);
router.delete(
  '/templates/:templateId',
  requirePermission('billing:templates'),
  audit('billing-template.delete', { table: 'billing_templates' }),
  billingController.deleteTemplate
);

// --- Invoice Mutations ---
router.post(
  '/',
  requirePermission('billing:edit'),
  audit('invoice.create', { table: 'invoices' }),
  billingController.createInvoice
);
router.put(
  '/:id',
  fieldLevelSecurity,
  audit('invoice.update', { table: 'invoices' }),
  billingController.updateInvoice
);
router.patch(
  '/:id',
  fieldLevelSecurity,
  audit('invoice.update', { table: 'invoices' }),
  billingController.updateInvoice
);
router.post(
  '/:id/archive',
  requirePermission('billing:edit'),
  audit('invoice.archive', { table: 'invoices' }),
  billingController.archiveInvoice
);
router.post(
  '/:id/unarchive',
  requirePermission('billing:edit'),
  audit('invoice.unarchive', { table: 'invoices' }),
  billingController.unarchiveInvoice
);
router.delete(
  '/:id',
  requirePermission('billing:delete'),
  audit('invoice.delete', { table: 'invoices' }),
  billingController.deleteInvoice
);

// --- Payments ---
router.post(
  '/:id/payments',
  requirePermission('billing:payments'),
  audit('invoice.payment', { table: 'invoice_payments' }),
  billingController.recordPayment
);

module.exports = router;
