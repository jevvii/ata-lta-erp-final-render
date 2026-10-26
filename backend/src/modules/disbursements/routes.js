/**
 * Disbursements module routes.
 * Mounted at /v1/disbursements by app.js.
 *
 * Authorized Disbursement Lifecycle Redesign (v2)
 */

const express = require('express');
const router = express.Router();
const { disbursementsController } = require('./controller');
const { requirePermission, computePermissions } = require('../../middleware/rbac');
const { hasPermission } = require('../../lib/permissions');
const { audit } = require('../../middleware/audit');
const { resolveEntity } = require('../../middleware/resolveEntity');
const { receiptEntityGuard } = require('../../middleware/receiptEntityGuard');
const AppError = require('../../lib/AppError');

/**
 * Guard for Admin-only disbursement actions:
 * - approve (v2 Draft -> Approved)
 * - release (v2 Funded -> Released)
 * - reject (v2 Draft/Funded -> Rejected)
 * - resend_draft (v2 Rejected -> Draft)
 * - archive / unarchive (v2 Released)
 */
const requireAdmin = (req, res, next) => {
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
  req.userPermissions = permissions;

  const isAdmin =
    req.user.role === 'Admin' ||
    hasPermission(permissions, 'disbursement:approve') ||
    hasPermission(permissions, 'disbursement:*');

  if (!isAdmin) {
    return next(
      new AppError({
        statusCode: 403,
        title: 'Forbidden',
        detail: 'Administrator permission is required for this action',
        code: 'FORBIDDEN',
      })
    );
  }

  next();
};

/**
 * Guard for payment preparation (funding):
 * Accounting or Admin can prepare payment details for Approved vouchers.
 */
const requireFundingPermission = (req, res, next) => {
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
  req.userPermissions = permissions;

  const isAccounting =
    String(req.user.role || '').toLowerCase() === 'accounting' ||
    (req.user.departments || []).some((d) => String(d).toLowerCase() === 'accounting');
  const isAdmin = req.user.role === 'Admin';
  const hasFundingPerm = isAdmin || isAccounting;

  if (!hasFundingPerm) {
    return next(
      new AppError({
        statusCode: 403,
        title: 'Forbidden',
        detail: 'Accounting or Administrator permission is required to prepare payment details',
        code: 'FORBIDDEN',
      })
    );
  }

  next();
};

// --- Badge Counts (before resolveEntity so ALL can be summed) ---
router.get(
  '/counts',
  resolveEntity({ allowAll: true }),
  requirePermission('disbursement:view'),
  disbursementsController.getDisbursementCounts
);

// --- Listing and Read Endpoints (allowAll: true) ---
router.get(
  '/templates',
  resolveEntity({ allowAll: true }),
  requirePermission('disbursement:view'),
  disbursementsController.listDisbursementTemplates
);
router.get(
  '/',
  resolveEntity({ allowAll: true }),
  requirePermission('disbursement:view'),
  disbursementsController.listDisbursements
);
router.get(
  '/:id/receipt-url',
  resolveEntity({ allowAll: true }),
  requirePermission('disbursement:view'),
  disbursementsController.getReceiptUrl
);
router.get(
  '/:id',
  resolveEntity({ allowAll: true }),
  requirePermission('disbursement:view'),
  disbursementsController.getDisbursement
);

router.get(
  '/:id/pdf',
  resolveEntity({ allowAll: true }),
  requirePermission('disbursement:view'),
  disbursementsController.getDisbursementPdf
);

// --- Receipt Upload Reservations (C2 / RECEIPT-ENTITY-20261021) ---
// Mounted before module-wide resolveEntity() to enforce explicit, authorized entity context
// without double resolution or impact on other disbursement routes.
router.post(
  '/receipt-uploads',
  requirePermission('disbursement:create'),
  receiptEntityGuard,
  resolveEntity(),
  disbursementsController.createReceiptUpload
);
router.post(
  '/receipt-uploads/:uploadId/complete',
  requirePermission('disbursement:create'),
  receiptEntityGuard,
  resolveEntity(),
  disbursementsController.completeReceiptUpload
);

// Resolve entity code → UUID for all remaining mutation routes in this module
router.use(resolveEntity());

// --- Disbursement Templates Mutations ---
router.post(
  '/templates',
  requirePermission('disbursement:create'),
  audit('disbursement-template.create', { table: 'disbursement_templates' }),
  disbursementsController.createDisbursementTemplate
);
router.put(
  '/templates/:templateId',
  requirePermission('disbursement:edit'),
  audit('disbursement-template.update', { table: 'disbursement_templates' }),
  disbursementsController.updateDisbursementTemplate
);
router.delete(
  '/templates/:templateId',
  requirePermission('disbursement:edit'),
  audit('disbursement-template.delete', { table: 'disbursement_templates' }),
  disbursementsController.deleteDisbursementTemplate
);

// --- Disbursement Mutations ---
router.post(
  '/',
  requirePermission('disbursement:create'),
  audit('disbursement.create', { table: 'disbursements' }),
  disbursementsController.createDisbursement
);

router.put(
  '/:id',
  requirePermission(['disbursement:create', 'disbursement:edit']),
  audit('disbursement.update', { table: 'disbursements' }),
  disbursementsController.updateDisbursement
);

// Admin-only archive / unarchive (Released v2 records)
router.post(
  '/:id/archive',
  requireAdmin,
  audit('disbursement.archive', { table: 'disbursements' }),
  disbursementsController.archiveDisbursement
);

router.post(
  '/:id/unarchive',
  requireAdmin,
  audit('disbursement.unarchive', { table: 'disbursements' }),
  disbursementsController.unarchiveDisbursement
);

// Deprecated workflow routes on v2 (return 409 CONFLICT_CURRENT_STATUS)
router.post(
  '/:id/submit',
  requirePermission('disbursement:create'),
  audit('disbursement.submit', { table: 'disbursements' }),
  disbursementsController.submitDisbursement
);

router.post(
  '/:id/forward',
  requirePermission('disbursement:edit'),
  audit('disbursement.forward', { table: 'disbursements' }),
  disbursementsController.forwardDisbursement
);

router.post(
  '/:id/forward_admin',
  requirePermission('disbursement:edit'),
  audit('disbursement.forward_admin', { table: 'disbursements' }),
  disbursementsController.forwardDisbursement
);

// Stage 1 approval: Admin, Draft -> Approved (no payment details required)
router.post(
  '/:id/approve',
  requireAdmin,
  audit('disbursement.approve', { table: 'disbursements' }),
  disbursementsController.approveDisbursement
);

// Stage 2 funding: Accounting/Admin, Approved -> Funded (4 payment fields required)
router.post(
  '/:id/fund',
  requireFundingPermission,
  audit('disbursement.fund', { table: 'disbursements' }),
  disbursementsController.fundDisbursement
);

// Stage 3 release: Admin, including the preparer, Funded -> Released
router.post(
  '/:id/release',
  requireAdmin,
  audit('disbursement.release', { table: 'disbursements' }),
  disbursementsController.releaseDisbursement
);

// Rejection: Admin, Draft or Funded -> Rejected (reason required)
router.post(
  '/:id/reject',
  requireAdmin,
  audit('disbursement.reject', { table: 'disbursements' }),
  disbursementsController.rejectDisbursement
);

// Return rejected to draft: Admin, Rejected -> Draft (review_ready = false)
router.post(
  '/:id/resend_draft',
  requireAdmin,
  audit('disbursement.resend_draft', { table: 'disbursements' }),
  disbursementsController.resendDraftDisbursement
);

// Payment details correction (blocked on v2 Funded/Released)
router.patch(
  '/:id/payment-details',
  requirePermission(['disbursement:mark_released', 'disbursement:edit']),
  audit('disbursement.payment_details_update', { table: 'disbursements' }),
  disbursementsController.updatePaymentDetails
);

router.delete(
  '/:id',
  requirePermission(['disbursement:create', 'disbursement:edit']),
  audit('disbursement.delete', { table: 'disbursements' }),
  disbursementsController.deleteDisbursement
);

module.exports = router;
