/**
 * Reports module routes.
 * Mounted at /v1/reports by app.js.
 * All endpoints are read-only.
 *
 * Phase 7 — Agent B
 */

const express = require('express');
const router = express.Router();
const { reportsController } = require('./controller');
const { requirePermission } = require('../../middleware/rbac');
const { resolveEntity } = require('../../middleware/resolveEntity');

// Resolve entity code → UUID for all routes in this module
router.use(resolveEntity({ allowAll: true }));

router.get('/analytics',
  requirePermission('reports:view'),
  reportsController.analytics,
);

router.get('/dashboard',
  requirePermission('workflow:view'),
  reportsController.dashboard,
);

router.get('/daily',
  requirePermission('reports:view'),
  reportsController.daily,
);

router.get('/weekly',
  requirePermission('reports:view'),
  reportsController.weekly,
);

router.get('/monthly-pending',
  requirePermission('reports:view'),
  reportsController.monthlyPending,
);

router.get('/aging',
  requirePermission('billing:view'),
  reportsController.aging,
);

module.exports = router;
