/**
 * Billing / Invoices module routes.
 * Mounted at /v1/invoices by app.js.
 *
 * Phase 5 — Agent B
 */

const express = require('express');
const router = express.Router();
const { billingController } = require('./controller');
const { requirePermission } = require('../../middleware/rbac');
const { audit } = require('../../middleware/audit');
const { resolveEntity } = require('../../middleware/resolveEntity');

// --- Badge Counts (before resolveEntity so ALL can be summed) ---
router.get(
  '/counts',
  resolveEntity({ allowAll: true }),
  requirePermission('billing:view'),
  billingController.getInvoiceCounts
);

// Resolve entity code → UUID for all remaining routes in this module
router.use(resolveEntity());

// --- Billing Templates (must come before /:id routes) ---
router.get('/templates', requirePermission('billing:view'), billingController.listTemplates);
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

// --- Aging Report ---
router.get('/aging', requirePermission('billing:view'), billingController.getAgingReport);

// --- Invoice CRUD ---
router.get('/', requirePermission('billing:view'), billingController.listInvoices);
router.post(
  '/',
  requirePermission('billing:edit'),
  audit('invoice.create', { table: 'invoices' }),
  billingController.createInvoice
);
router.get('/:id', requirePermission('billing:view'), billingController.getInvoice);
router.put(
  '/:id',
  requirePermission('billing:edit'),
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

// --- PDF Generation ---
router.get('/:id/pdf', requirePermission('billing:view'), billingController.getInvoicePdf);
router.get('/:id/voucher', requirePermission('billing:view'), billingController.getVoucherPdf);

module.exports = router;
