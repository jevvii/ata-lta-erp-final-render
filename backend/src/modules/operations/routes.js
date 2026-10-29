/**
 * Operations / Work Requests module routes.
 * Phase 4 implementation by Agent A.
 */

const express = require('express');
const router = express.Router();
const { operationsController } = require('./controller');
const operationsService = require('./service');
const { auth } = require('../../middleware/auth');
const { entityScope } = require('../../middleware/entityScope');
const { resolveEntity } = require('../../middleware/resolveEntity');
const { requirePermission, requireAdmin, computePermissions } = require('../../middleware/rbac');
const { hasPermission } = require('../../lib/permissions');
const AppError = require('../../lib/AppError');
const { audit } = require('../../middleware/audit');

const requireWorkflowEditOrTaskAssignee = async (req, res, next) => {
  try {
    if (!req.user) {
      throw new AppError({
        statusCode: 401,
        title: 'Unauthorized',
        detail: 'Authentication required',
      });
    }

    const permissions = computePermissions(req.user);
    req.userPermissions = permissions;

    // 1. If user has workflow:edit -> allow full edit
    if (hasPermission(permissions, 'workflow:edit')) {
      return next();
    }

    // 2. If user does NOT have workflow:edit -> must be assigned to task
    const taskId = req.params.taskId || req.params.id;
    if (!taskId) {
      throw new AppError({
        statusCode: 403,
        title: 'Forbidden',
        detail: 'One of permissions [workflow:edit] is required',
      });
    }

    const isAssigned = await operationsService.isUserAssignedToTask(taskId, req.user.id);
    if (!isAssigned) {
      throw new AppError({
        statusCode: 403,
        title: 'Forbidden',
        detail: 'One of permissions [workflow:edit] is required',
      });
    }

    // Completion updates carry only item IDs and booleans, never checklist content.
    const completionKeys = new Set(['checklistCompletions', 'expectedVersion']);
    if (req.body?.checklistCompletions !== undefined &&
        Object.keys(req.body).every((key) => completionKeys.has(key))) {
      return next();
    }

    // 3. User IS assigned to task:
    // May ONLY update status (and optional expectedVersion / version).
    // If other fields are in req.body -> 403 Forbidden ("Assignees may only update task status")
    const allowedKeys = new Set(['status', 'expectedVersion', 'expected_version', 'version']);
    const bodyKeys = Object.keys(req.body || {});
    const disallowedKeys = bodyKeys.filter((key) => !allowedKeys.has(key));

    if (disallowedKeys.length > 0 || !req.body || req.body.status === undefined) {
      throw new AppError({
        statusCode: 403,
        title: 'Forbidden',
        detail: 'Assignees may only update task status',
      });
    }

    // Normalize 'Complete' -> 'Completed'
    if (req.body.status === 'Complete') {
      req.body.status = 'Completed';
    }

    // Target status restricted to 'In Progress' or 'Completed'. Other statuses -> 400 Bad Request
    const allowedStatuses = ['In Progress', 'Completed'];
    if (!allowedStatuses.includes(req.body.status)) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Assignees may only update task status to "In Progress" or "Completed"',
      });
    }

    next();
  } catch (err) {
    next(err);
  }
};

router.use(auth, entityScope);

// --- Standard Task Templates (Admin CRUD, workflow:view to read) ---
router.get(
  '/task-templates',
  requirePermission('workflow:view'),
  operationsController.listStandardTaskTemplates
);
router.post(
  '/task-templates/reset-defaults',
  requireAdmin,
  audit('task-template.reset', { table: 'standard_task_templates' }),
  operationsController.resetStandardTaskTemplates
);
router.post(
  '/task-templates',
  requireAdmin,
  audit('task-template.created', { table: 'standard_task_templates' }),
  operationsController.createStandardTaskTemplate
);
router.put(
  '/task-templates/:templateId',
  requireAdmin,
  audit('task-template.updated', { table: 'standard_task_templates' }),
  operationsController.updateStandardTaskTemplate
);
router.delete(
  '/task-templates/:templateId',
  requireAdmin,
  audit('task-template.deleted', { table: 'standard_task_templates' }),
  operationsController.deleteStandardTaskTemplate
);

// --- Retainer Templates (must come before /:id routes) ---
router.get(
  ['/templates', '/retainer-templates'],
  resolveEntity({ allowAll: true }),
  requirePermission('retainers:use'),
  operationsController.listRetainerTemplates
);
router.post(
  ['/templates', '/retainer-templates'],
  resolveEntity(),
  requirePermission('retainers:edit'),
  audit('retainer-template.created', { table: 'retainer_templates' }),
  operationsController.createRetainerTemplate
);
router.post(
  ['/templates/:templateId/generate', '/retainer-templates/:templateId/generate'],
  resolveEntity(),
  requirePermission('retainers:use'),
  audit('retainer-template.generated', { table: 'retainer_template_generations' }),
  operationsController.generateRetainerTemplate
);
router.put(
  ['/templates/:templateId', '/retainer-templates/:templateId'],
  resolveEntity(),
  requirePermission('retainers:edit'),
  audit('retainer-template.updated', { table: 'retainer_templates' }),
  operationsController.updateRetainerTemplate
);
router.delete(
  ['/templates/:templateId', '/retainer-templates/:templateId'],
  resolveEntity(),
  requirePermission('retainers:edit'),
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
  ['/work-requests/counts', '/counts'],
  resolveEntity({ allowAll: true }),
  requirePermission('workflow:view'),
  operationsController.counts
);

router.get(
  ['/work-requests', '/'],
  resolveEntity({ allowAll: true }),
  requirePermission('workflow:view'),
  operationsController.list
);
router.post(
  ['/work-requests', '/'],
  resolveEntity(),
  requirePermission('workflow:edit'),
  audit('work_request.created', { table: 'work_requests' }),
  operationsController.create
);
router.get(
  ['/work-requests/creation-approvals', '/creation-approvals'],
  resolveEntity({ allowAll: true }),
  operationsController.listCreationApprovals
);
router.post(
  ['/work-requests/:id/creation-approval', '/:id/creation-approval'],
  resolveEntity(),
  operationsController.decideCreationApproval
);
router.post(
  ['/work-requests/:id/resubmit-creation', '/:id/resubmit-creation'],
  resolveEntity(),
  operationsController.resubmitCreation
);
router.get(
  ['/work-requests/:id', '/:id'],
  resolveEntity({ allowAll: true }),
  requirePermission('workflow:view'),
  operationsController.getById
);
router.get(
  ['/work-requests/:id/related', '/:id/related'],
  resolveEntity({ allowAll: true }),
  requirePermission('workflow:view'),
  operationsController.getRelated
);
router.put(
  ['/work-requests/:id', '/:id'],
  resolveEntity(),
  requirePermission('workflow:edit'),
  audit('work_request.updated', { table: 'work_requests' }),
  operationsController.update
);
router.post(
  ['/work-requests/:id/archive', '/:id/archive'],
  resolveEntity(),
  requirePermission('workflow:edit'),
  audit('work_request.archived', { table: 'work_requests' }),
  operationsController.archive
);
router.post(
  ['/work-requests/:id/unarchive', '/:id/unarchive'],
  resolveEntity(),
  requirePermission('workflow:edit'),
  audit('work_request.unarchived', { table: 'work_requests' }),
  operationsController.unarchive
);
router.post(
  ['/work-requests/:id/advance', '/:id/advance'],
  resolveEntity(),
  requirePermission('workflow:phase_transition'),
  audit('work_request.advance', { table: 'work_requests' }),
  operationsController.advanceWorkRequest
);
router.post(
  ['/work-requests/:id/qa-review', '/:id/qa-review'],
  resolveEntity(),
  requirePermission('workflow:qa_review'),
  audit('work_request.qa_review', { table: 'work_requests' }),
  operationsController.qaReviewWorkRequest
);
router.post(
  ['/work-requests/:id/reroute', '/:id/reroute'],
  resolveEntity(),
  requirePermission('workflow:qa_review'),
  audit('work_request.reroute', { table: 'work_requests' }),
  operationsController.rerouteWorkRequest
);
router.delete(
  ['/work-requests/:id', '/:id'],
  resolveEntity(),
  requirePermission('workflow:edit'),
  audit('work_request.deleted', { table: 'work_requests' }),
  operationsController.remove
);

// Task sub-resources
router.get(
  ['/work-requests/:wrId/tasks', '/:wrId/tasks'],
  resolveEntity(),
  requirePermission('workflow:view'),
  operationsController.listTasks
);
router.get(
  ['/tasks/:id/related', '/work-requests/:wrId/tasks/:id/related'],
  resolveEntity({ allowAll: true }),
  requirePermission('workflow:view'),
  operationsController.getTaskRelated
);
router.get(
  ['/work-requests/:wrId/tasks/:taskId', '/:wrId/tasks/:taskId', '/tasks/:taskId'],
  resolveEntity(),
  requirePermission('workflow:view'),
  operationsController.getTask
);
router.post(
  ['/work-requests/:wrId/tasks', '/:wrId/tasks'],
  resolveEntity(),
  requirePermission('workflow:task_add'),
  audit('task.created', { table: 'tasks' }),
  operationsController.createTask
);
router.put(
  ['/work-requests/:wrId/tasks/:taskId', '/:wrId/tasks/:taskId', '/tasks/:taskId'],
  resolveEntity(),
  requireWorkflowEditOrTaskAssignee,
  audit('task.updated', { table: 'tasks' }),
  operationsController.updateTask
);
router.patch(
  ['/work-requests/:wrId/tasks/:taskId', '/:wrId/tasks/:taskId', '/tasks/:taskId'],
  resolveEntity(),
  requireWorkflowEditOrTaskAssignee,
  audit('task.updated', { table: 'tasks' }),
  operationsController.updateTask
);
router.post(
  ['/work-requests/:wrId/tasks/:taskId/creation-approval', '/:wrId/tasks/:taskId/creation-approval'],
  resolveEntity(),
  operationsController.decideTaskCreationApproval
);
router.post(
  ['/work-requests/:wrId/tasks/:taskId/resubmit-creation', '/:wrId/tasks/:taskId/resubmit-creation'],
  resolveEntity(),
  operationsController.resubmitTaskCreation
);
router.post(
  ['/work-requests/:wrId/tasks/:taskId/time-logs', '/:wrId/tasks/:taskId/time-logs', '/tasks/:taskId/time-logs'],
  resolveEntity(),
  requirePermission('timelog:create'),
  audit('task.time_log_added', { table: 'task_time_logs' }),
  operationsController.addTimeLogs
);
router.delete(
  ['/work-requests/:wrId/tasks/:taskId', '/:wrId/tasks/:taskId', '/tasks/:taskId'],
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
tasksRouter.get(
  '/:taskId',
  requirePermission('workflow:view'),
  operationsController.getTask
);
tasksRouter.put(
  '/:taskId',
  requireWorkflowEditOrTaskAssignee,
  audit('task.updated', { table: 'tasks' }),
  operationsController.updateTask
);
tasksRouter.patch(
  '/:taskId',
  requireWorkflowEditOrTaskAssignee,
  audit('task.updated', { table: 'tasks' }),
  operationsController.updateTask
);
tasksRouter.post(
  '/:taskId/creation-approval',
  operationsController.decideTaskCreationApproval
);
tasksRouter.post(
  '/:taskId/resubmit-creation',
  operationsController.resubmitTaskCreation
);
tasksRouter.delete(
  '/:taskId',
  requirePermission('workflow:edit'),
  audit('task.deleted', { table: 'tasks' }),
  operationsController.removeTask
);

module.exports = router;
module.exports.tasksRouter = tasksRouter;
