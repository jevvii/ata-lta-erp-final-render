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

router.get(
  '/counts',
  auth,
  entityScope,
  resolveEntity({ allowAll: true }),
  requirePermission('clients:view'),
  clientsController.counts
);

router.get(
  '/',
  auth,
  entityScope,
  resolveEntity({ allowAll: true }),
  requirePermission('clients:view'),
  clientsController.list
);
router.get(
  '/:id',
  auth,
  entityScope,
  resolveEntity({ allowAll: true }),
  requirePermission('clients:view'),
  clientsController.getById
);

router.use(auth, entityScope, resolveEntity());

router.post(
  '/',
  requirePermission('clients:edit'),
  audit('client.created', { table: 'clients' }),
  clientsController.create
);
router.put(
  '/:id',
  requirePermission('clients:edit'),
  audit('client.updated', { table: 'clients' }),
  clientsController.update
);
router.post(
  '/:id/archive',
  requirePermission('clients:edit'),
  audit('client.archived', { table: 'clients' }),
  clientsController.archive
);
router.post(
  '/:id/unarchive',
  requirePermission('clients:edit'),
  audit('client.unarchived', { table: 'clients' }),
  clientsController.unarchive
);
router.delete(
  '/:id',
  requirePermission('clients:edit'),
  audit('client.archived', { table: 'clients' }),
  clientsController.remove
);

module.exports = router;
