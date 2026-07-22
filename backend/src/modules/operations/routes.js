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

router.use(auth, entityScope);

// --- Retainer Templates (must come before /:id routes) ---
router.get(
  '/templates',
  resolveEntity(),
  requirePermission('workflow:view'),
  operationsController.listRetainerTemplates
);
router.post(
  '/templates',
  resolveEntity(),
  requirePermission('workflow:edit'),
  audit('retainer-template.created', { table: 'retainer_templates' }),
  operationsController.createRetainerTemplate
);
router.put(
  '/templates/:templateId',
  resolveEntity(),
  requirePermission('workflow:edit'),
  audit('retainer-template.updated', { table: 'retainer_templates' }),
  operationsController.updateRetainerTemplate
);
router.delete(
  '/templates/:templateId',
  resolveEntity(),
  requirePermission('workflow:edit'),
  audit('retainer-template.deleted', { table: 'retainer_templates' }),
  operationsController.deleteRetainerTemplate
);

// --- Ground Workers ---
router.get(
  '/ground-workers',
  resolveEntity(),
  requirePermission('workflow:view'),
  operationsController.listGroundWorkers
);
router.post(
  '/ground-workers',
  resolveEntity(),
  requirePermission('workflow:edit'),
  audit('ground-worker.created', { table: 'ground_workers' }),
  operationsController.createGroundWorker
);

router.get(
  '/counts',
  resolveEntity({ allowAll: true }),
  requirePermission('workflow:view'),
  operationsController.counts
);

router.get(
  '/',
  resolveEntity({ allowAll: true }),
  requirePermission('workflow:view'),
  operationsController.list
);
router.post(
  '/',
  resolveEntity(),
  requirePermission('workflow:edit'),
  audit('work_request.created', { table: 'work_requests' }),
  operationsController.create
);
router.get(
  '/:id',
  resolveEntity(),
  requirePermission('workflow:view'),
  operationsController.getById
);
router.get(
  '/:id/related',
  resolveEntity({ allowAll: true }),
  requirePermission('workflow:view'),
  operationsController.getRelated
);
router.put(
  '/:id',
  resolveEntity(),
  requirePermission('workflow:edit'),
  audit('work_request.updated', { table: 'work_requests' }),
  operationsController.update
);
router.post(
  '/:id/archive',
  resolveEntity(),
  requirePermission('workflow:edit'),
  audit('work_request.archived', { table: 'work_requests' }),
  operationsController.archive
);
router.post(
  '/:id/unarchive',
  resolveEntity(),
  requirePermission('workflow:edit'),
  audit('work_request.unarchived', { table: 'work_requests' }),
  operationsController.unarchive
);
router.delete(
  '/:id',
  resolveEntity(),
  requirePermission('workflow:edit'),
  audit('work_request.deleted', { table: 'work_requests' }),
  operationsController.remove
);

// Task sub-resources
router.get(
  '/:wrId/tasks',
  resolveEntity(),
  requirePermission('workflow:view'),
  operationsController.listTasks
);
router.get(
  '/:wrId/tasks/:taskId',
  resolveEntity(),
  requirePermission('workflow:view'),
  operationsController.getTask
);
router.post(
  '/:wrId/tasks',
  resolveEntity(),
  requirePermission('workflow:task_add'),
  audit('task.created', { table: 'tasks' }),
  operationsController.createTask
);
router.put(
  '/:wrId/tasks/:taskId',
  resolveEntity(),
  requirePermission('workflow:edit'),
  audit('task.updated', { table: 'tasks' }),
  operationsController.updateTask
);
router.post(
  '/:wrId/tasks/:taskId/time-logs',
  resolveEntity(),
  requirePermission(['workflow:edit', 'workflow:task_add', 'workflow:task_upload']),
  audit('task.time_log_added', { table: 'task_time_logs' }),
  operationsController.addTimeLogs
);
router.delete(
  '/:wrId/tasks/:taskId',
  resolveEntity(),
  requirePermission('workflow:edit'),
  audit('task.deleted', { table: 'tasks' }),
  operationsController.removeTask
);

const tasksRouter = express.Router();
tasksRouter.use(auth, entityScope, resolveEntity());
tasksRouter.get(
  '/:id/related',
  requirePermission('workflow:view'),
  operationsController.getTaskRelated
);

module.exports = router;
module.exports.tasksRouter = tasksRouter;
