/**
 * Clients module routes.
 * Phase 2 implementation by Agent A.
 */

const express = require('express');
const router = express.Router();
const { clientsController } = require('./controller');
const { auth } = require('../../middleware/auth');
const { entityScope } = require('../../middleware/entityScope');
const { resolveEntity } = require('../../middleware/resolveEntity');
const { requirePermission } = require('../../middleware/rbac');
const { audit } = require('../../middleware/audit');

router.use(auth, entityScope, resolveEntity());

router.get('/', requirePermission('clients:view'), clientsController.list);
router.post('/', requirePermission('clients:edit'), audit('client.created', { table: 'clients' }), clientsController.create);
router.get('/:id', requirePermission('clients:view'), clientsController.getById);
router.put('/:id', requirePermission('clients:edit'), audit('client.updated', { table: 'clients' }), clientsController.update);
router.delete('/:id', requirePermission('clients:edit'), audit('client.archived', { table: 'clients' }), clientsController.remove);

module.exports = router;
