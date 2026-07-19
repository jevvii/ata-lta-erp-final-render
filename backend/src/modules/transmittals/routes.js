/**
 * Transmittals module routes.
 * Mounted at /v1/transmittals by app.js.
 *
 * Phase 6 — Agent B
 */

const express = require('express');
const router = express.Router();
const { transmittalsController } = require('./controller');
const { requirePermission } = require('../../middleware/rbac');
const { audit } = require('../../middleware/audit');
const { resolveEntity } = require('../../middleware/resolveEntity');

// Resolve entity code → UUID for all routes in this module
router.use(resolveEntity());

router.get('/',
  requirePermission('transmittal:view'),
  transmittalsController.listTransmittals,
);

router.post('/',
  requirePermission('transmittal:create'),
  audit('transmittal.create', { table: 'transmittals' }),
  transmittalsController.createTransmittal,
);

router.get('/:id',
  requirePermission('transmittal:view'),
  transmittalsController.getTransmittal,
);

router.put('/:id',
  requirePermission('transmittal:edit'),
  audit('transmittal.update', { table: 'transmittals' }),
  transmittalsController.updateTransmittal,
);

router.post('/:id/send',
  requirePermission('transmittal:mark'),
  audit('transmittal.send', { table: 'transmittals' }),
  transmittalsController.sendTransmittal,
);

router.post('/:id/acknowledge',
  requirePermission('transmittal:mark'),
  audit('transmittal.acknowledge', { table: 'transmittals' }),
  transmittalsController.acknowledgeTransmittal,
);

module.exports = router;
