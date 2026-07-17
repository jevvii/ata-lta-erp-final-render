/**
 * Operations / Work Requests module routes.
 * Phase 4 implementation by Agent A.
 */

const express = require('express');
const router = express.Router();
const { operationsController } = require('./controller');
const { auth } = require('../../middleware/auth');
const { entityScope } = require('../../middleware/entityScope');
const { requirePermission } = require('../../middleware/rbac');
const { audit } = require('../../middleware/audit');

router.get('/', auth, entityScope, requirePermission('workflow:view'), operationsController.list);
router.post('/', auth, entityScope, requirePermission('workflow:edit'), audit('work_request.created', { table: 'work_requests' }), operationsController.create);
router.get('/:id', auth, entityScope, requirePermission('workflow:view'), operationsController.getById);
router.put('/:id', auth, entityScope, requirePermission('workflow:edit'), audit('work_request.updated', { table: 'work_requests' }), operationsController.update);
router.delete('/:id', auth, entityScope, requirePermission('workflow:edit'), audit('work_request.deleted', { table: 'work_requests' }), operationsController.remove);

// Task sub-resources
router.get('/:wrId/tasks', auth, entityScope, requirePermission('workflow:view'), operationsController.listTasks);
router.post('/:wrId/tasks', auth, entityScope, requirePermission('workflow:task_add'), audit('task.created', { table: 'tasks' }), operationsController.createTask);
router.put('/:wrId/tasks/:taskId', auth, entityScope, requirePermission('workflow:edit'), audit('task.updated', { table: 'tasks' }), operationsController.updateTask);
router.delete('/:wrId/tasks/:taskId', auth, entityScope, requirePermission('workflow:edit'), audit('task.deleted', { table: 'tasks' }), operationsController.removeTask);

module.exports = router;
