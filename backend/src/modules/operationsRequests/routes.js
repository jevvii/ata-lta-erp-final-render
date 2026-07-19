/**
 * Operations Requests module routes.
 * Mounted at /v1/operations-requests by app.js.
 */

const express = require('express');
const router = express.Router();
const { operationsRequestsController } = require('./controller');
const { auth } = require('../../middleware/auth');
const { entityScope } = require('../../middleware/entityScope');
const { resolveEntity } = require('../../middleware/resolveEntity');
const { requirePermission } = require('../../middleware/rbac');
const { audit } = require('../../middleware/audit');

router.use(auth, entityScope, resolveEntity());

router.get('/counts',
  requirePermission('workflow:view'),
  operationsRequestsController.getCounts,
);

router.get('/',
  requirePermission('workflow:view'),
  operationsRequestsController.listRequests,
);

router.post('/',
  requirePermission('workflow:edit'),
  audit('operations_request.create', { table: 'operations_requests' }),
  operationsRequestsController.createRequest,
);

router.get('/:id',
  requirePermission('workflow:view'),
  operationsRequestsController.getRequest,
);

router.put('/:id',
  requirePermission('workflow:edit'),
  audit('operations_request.update', { table: 'operations_requests' }),
  operationsRequestsController.updateRequest,
);

router.delete('/:id',
  requirePermission('workflow:edit'),
  audit('operations_request.delete', { table: 'operations_requests' }),
  operationsRequestsController.deleteRequest,
);

module.exports = router;
