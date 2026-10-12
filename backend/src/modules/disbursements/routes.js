/**
 * Disbursements module routes.
 * Mounted at /v1/disbursements by app.js.
 *
 * Phase 6 — Agent B
 */

const express = require('express');
const router = express.Router();
const { disbursementsController } = require('./controller');
const { requirePermission, computePermissions } = require('../../middleware/rbac');
const { hasPermission } = require('../../lib/permissions');
const { audit } = require('../../middleware/audit');
const { resolveEntity } = require('../../middleware/resolveEntity');
const AppError = require('../../lib/AppError');

/**
 * Guard POST /v1/disbursements/:id/approve and /reject with disbursement:approve (Admin only).
 * Per R3: disbursement:approve cannot be held by any non-Admin role.
 */
const requireDisbursementApprove = (req, res, next) => {
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
  // disbursement:approve resolves from the P0-A manifest (Admin-only grant).
  req.userPermissions = permissions;

  if (!hasPermission(permissions, 'disbursement:approve')) {
    return next(
      new AppError({
        statusCode: 403,
        title: 'Forbidden',
        detail: 'Permission disbursement:approve is required',
      })
    );
  }

  next();
};

/**
 * Guard POST /v1/disbursements/:id/reject.
 * Allows Admin, users with approve_change:disbursements, disbursement:edit, or disbursement:approve.
 */
const requireDisbursementReject = (req, res, next) => {
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

  const isAdmin = req.user.role === 'Admin';
  const canReject =
    isAdmin ||
    hasPermission(permissions, 'disbursement:approve') ||
    hasPermission(permissions, 'approve_change:disbursements') ||
    hasPermission(permissions, 'disbursement:edit') ||
    hasPermission(permissions, 'disbursement:*');

  if (!canReject) {
    return next(
      new AppError({
        statusCode: 403,
        title: 'Forbidden',
        detail: 'Permission to reject disbursements is required',
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
  '/:id',
  resolveEntity({ allowAll: true }),
  requirePermission('disbursement:view'),
  disbursementsController.getDisbursement
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
  requirePermission('disbursement:edit'),
  audit('disbursement.update', { table: 'disbursements' }),
  disbursementsController.updateDisbursement
);

router.post(
  '/:id/archive',
  requirePermission('disbursement:edit'),
  audit('disbursement.archive', { table: 'disbursements' }),
  disbursementsController.archiveDisbursement
);

router.post(
  '/:id/unarchive',
  requirePermission('disbursement:edit'),
  audit('disbursement.unarchive', { table: 'disbursements' }),
  disbursementsController.unarchiveDisbursement
);

router.post(
  '/:id/submit',
  requirePermission('disbursement:create'),
  audit('disbursement.submit', { table: 'disbursements' }),
  disbursementsController.submitDisbursement
);

router.post(
  '/:id/approve',
  requireDisbursementApprove,
  audit('disbursement.approve', { table: 'disbursements' }),
  disbursementsController.approveDisbursement
);

router.post(
  '/:id/release',
  requirePermission('disbursement:mark_released'),
  audit('disbursement.release', { table: 'disbursements' }),
  disbursementsController.releaseDisbursement
);

router.post(
  '/:id/fund',
  requirePermission('disbursement:mark_released'),
  audit('disbursement.fund', { table: 'disbursements' }),
  disbursementsController.fundDisbursement
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

router.post(
  '/:id/reject',
  requireDisbursementReject,
  audit('disbursement.reject', { table: 'disbursements' }),
  disbursementsController.rejectDisbursement
);

router.delete(
  '/:id',
  requirePermission('disbursement:edit'),
  audit('disbursement.delete', { table: 'disbursements' }),
  disbursementsController.deleteDisbursement
);

module.exports = router;
