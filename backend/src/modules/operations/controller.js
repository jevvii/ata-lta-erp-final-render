/**
 * Operations / Work Requests controller.
 * Route handlers delegate to the service and record audit events.
 */

const operationsService = require('./service');
const { createWorkRequestSchema, updateWorkRequestSchema, createTaskSchema, updateTaskSchema } = require('./schema');
const auditService = require('../../services/auditService');
const AppError = require('../../lib/AppError');

const validate = (schema, data) => {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new AppError({ statusCode: 400, title: 'Validation Error', detail: issues, code: 'VALIDATION_ERROR' });
  }
  return result.data;
};

const resolveEntityId = async (req) => operationsService.resolveEntityId(req.activeEntity);

const list = async (req, res, next) => {
  try {
    const entityId = await resolveEntityId(req);
    const data = await operationsService.listWorkRequests({
      entityId,
      user: req.user,
      search: req.query.search,
    });
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
};

const create = async (req, res, next) => {
  try {
    const payload = validate(createWorkRequestSchema, req.body);
    const entityId = await resolveEntityId(req);

    if (payload.entity && payload.entity !== req.activeEntity) {
      throw new AppError({ statusCode: 400, title: 'Bad Request', detail: 'Work request entity must match active entity' });
    }

    const wr = await operationsService.createWorkRequest({ entityId, data: payload, user: req.user });

    await auditService.log({
      action: 'work_request.created',
      table: 'work_requests',
      recordId: wr.id,
      entity: req.activeEntity,
      userId: req.user.id,
      details: { title: wr.title, status: wr.status },
    });

    res.status(201).json({ data: wr });
  } catch (err) {
    next(err);
  }
};

const getById = async (req, res, next) => {
  try {
    const entityId = await resolveEntityId(req);
    const wr = await operationsService.getWorkRequestById({ id: req.params.id, entityId, user: req.user });
    if (!wr) {
      throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Work request not found' });
    }
    res.status(200).json({ data: wr });
  } catch (err) {
    next(err);
  }
};

const update = async (req, res, next) => {
  try {
    const payload = validate(updateWorkRequestSchema, req.body);
    const entityId = await resolveEntityId(req);

    if (payload.entity && payload.entity !== req.activeEntity) {
      throw new AppError({ statusCode: 400, title: 'Bad Request', detail: 'Work request entity must match active entity' });
    }

    const wr = await operationsService.updateWorkRequest({ id: req.params.id, entityId, data: payload, user: req.user });

    await auditService.log({
      action: 'work_request.updated',
      table: 'work_requests',
      recordId: wr.id,
      entity: req.activeEntity,
      userId: req.user.id,
      details: { title: wr.title, status: wr.status },
    });

    res.status(200).json({ data: wr });
  } catch (err) {
    next(err);
  }
};

const remove = async (req, res, next) => {
  try {
    const entityId = await resolveEntityId(req);
    const removed = await operationsService.deleteWorkRequest({ id: req.params.id, entityId, user: req.user });
    if (!removed) {
      throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Work request not found' });
    }

    await auditService.log({
      action: 'work_request.deleted',
      table: 'work_requests',
      recordId: req.params.id,
      entity: req.activeEntity,
      userId: req.user.id,
      details: {},
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

const listTasks = async (req, res, next) => {
  try {
    const entityId = await resolveEntityId(req);
    const data = await operationsService.listTasks({ workRequestId: req.params.wrId, entityId });
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
};

const createTask = async (req, res, next) => {
  try {
    const payload = validate(createTaskSchema, req.body);
    const entityId = await resolveEntityId(req);
    const task = await operationsService.createTask({
      workRequestId: req.params.wrId,
      entityId,
      data: payload,
      user: req.user,
    });

    await auditService.log({
      action: 'task.created',
      table: 'tasks',
      recordId: task.id,
      entity: req.activeEntity,
      userId: req.user.id,
      details: { title: task.title, workRequestId: task.workRequestId },
    });

    res.status(201).json({ data: task });
  } catch (err) {
    next(err);
  }
};

const updateTask = async (req, res, next) => {
  try {
    const payload = validate(updateTaskSchema, req.body);
    const entityId = await resolveEntityId(req);
    const task = await operationsService.updateTask({
      workRequestId: req.params.wrId,
      taskId: req.params.taskId,
      entityId,
      data: payload,
      user: req.user,
    });

    await auditService.log({
      action: 'task.updated',
      table: 'tasks',
      recordId: task.id,
      entity: req.activeEntity,
      userId: req.user.id,
      details: { title: task.title, status: task.status },
    });

    res.status(200).json({ data: task });
  } catch (err) {
    next(err);
  }
};

const removeTask = async (req, res, next) => {
  try {
    const entityId = await resolveEntityId(req);
    const removed = await operationsService.deleteTask({
      workRequestId: req.params.wrId,
      taskId: req.params.taskId,
      entityId,
    });
    if (!removed) {
      throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Task not found' });
    }

    await auditService.log({
      action: 'task.deleted',
      table: 'tasks',
      recordId: req.params.taskId,
      entity: req.activeEntity,
      userId: req.user.id,
      details: {},
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  operationsController: {
    list,
    create,
    getById,
    update,
    remove,
    listTasks,
    createTask,
    updateTask,
    removeTask,
  },
};
