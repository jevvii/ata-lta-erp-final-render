/**
 * Clients module routes.
 * Phase 2 implementation by Agent A.
 */

const express = require('express');
const router = express.Router();
const { clientsController } = require('./controller');
const { auth } = require('../../middleware/auth');
const { entityScope } = require('../../middleware/entityScope');
const { requirePermission } = require('../../middleware/rbac');
const { audit } = require('../../middleware/audit');

router.get('/', auth, entityScope, requirePermission('clients:view'), clientsController.list);
router.post('/', auth, entityScope, requirePermission('clients:edit'), audit('client.created', { table: 'clients' }), clientsController.create);
router.get('/:id', auth, entityScope, requirePermission('clients:view'), clientsController.getById);
router.put('/:id', auth, entityScope, requirePermission('clients:edit'), audit('client.updated', { table: 'clients' }), clientsController.update);
router.delete('/:id', auth, entityScope, requirePermission('clients:edit'), audit('client.archived', { table: 'clients' }), clientsController.remove);

module.exports = router;
