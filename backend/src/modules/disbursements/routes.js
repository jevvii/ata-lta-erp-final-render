/**
 * Disbursements module routes.
 * Mounted at /v1/disbursements by app.js.
 *
 * Phase 6 — Agent B
 */

const express = require('express');
const router = express.Router();
const { disbursementsController } = require('./controller');
const { requirePermission } = require('../../middleware/rbac');
const { audit } = require('../../middleware/audit');
const { resolveEntity } = require('../../middleware/resolveEntity');

// --- Badge Counts (before resolveEntity so ALL can be summed) ---
router.get('/counts',
  resolveEntity({ allowAll: true }),
  requirePermission('disbursement:view'),
  disbursementsController.getDisbursementCounts,
);

// Resolve entity code → UUID for all remaining routes in this module
router.use(resolveEntity());

router.get('/',
  requirePermission('disbursement:view'),
  disbursementsController.listDisbursements,
);

router.post('/',
  requirePermission('disbursement:create'),
  audit('disbursement.create', { table: 'disbursements' }),
  disbursementsController.createDisbursement,
);

router.get('/:id',
  requirePermission('disbursement:view'),
  disbursementsController.getDisbursement,
);

router.put('/:id',
  requirePermission('disbursement:edit'),
  audit('disbursement.update', { table: 'disbursements' }),
  disbursementsController.updateDisbursement,
);

router.post('/:id/submit',
  requirePermission('disbursement:create'),
  audit('disbursement.submit', { table: 'disbursements' }),
  disbursementsController.submitDisbursement,
);

router.post('/:id/approve',
  requirePermission('disbursement:mark_released'),
  audit('disbursement.approve', { table: 'disbursements' }),
  disbursementsController.approveDisbursement,
);

router.post('/:id/release',
  requirePermission('disbursement:mark_released'),
  audit('disbursement.release', { table: 'disbursements' }),
  disbursementsController.releaseDisbursement,
);

router.post('/:id/reject',
  requirePermission('disbursement:mark_released'),
  audit('disbursement.reject', { table: 'disbursements' }),
  disbursementsController.rejectDisbursement,
);

module.exports = router;
