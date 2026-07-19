/**
 * Operations / Work Requests module routes.
 * Phase 4 implementation by Agent A.
 */

const express = require('express');
const router = express.Router();
const { operationsController } = require('./controller');
const { auth } = require('../../middleware/auth');
const { entityScope } = require('../../middleware/entityScope');
const { resolveEntity } = require('../../middleware/resolveEntity');
const { requirePermission } = require('../../middleware/rbac');
const { audit } = require('../../middleware/audit');

router.use(auth, entityScope, resolveEntity());

router.get('/', requirePermission('workflow:view'), operationsController.list);
router.post('/', requirePermission('workflow:edit'), audit('work_request.created', { table: 'work_requests' }), operationsController.create);
router.get('/:id', requirePermission('workflow:view'), operationsController.getById);
router.put('/:id', requirePermission('workflow:edit'), audit('work_request.updated', { table: 'work_requests' }), operationsController.update);
router.delete('/:id', requirePermission('workflow:edit'), audit('work_request.deleted', { table: 'work_requests' }), operationsController.remove);

// Task sub-resources
router.get('/:wrId/tasks', requirePermission('workflow:view'), operationsController.listTasks);
router.post('/:wrId/tasks', requirePermission('workflow:task_add'), audit('task.created', { table: 'tasks' }), operationsController.createTask);
router.put('/:wrId/tasks/:taskId', requirePermission('workflow:edit'), audit('task.updated', { table: 'tasks' }), operationsController.updateTask);
router.delete('/:wrId/tasks/:taskId', requirePermission('workflow:edit'), audit('task.deleted', { table: 'tasks' }), operationsController.removeTask);

module.exports = router;
