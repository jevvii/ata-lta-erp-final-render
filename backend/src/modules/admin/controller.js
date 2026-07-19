/**
 * Admin / Users controller.
 */

const adminService = require('./service');
const { createUserSchema, updateUserSchema, rejectPendingSchema } = require('./schema');
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

const resolveEntityId = async (req) => adminService.resolveEntityId(req.activeEntity);

const listUsers = async (req, res, next) => {
  try {
    const users = await adminService.listUsers({ entityId: req.activeEntity });
    res.status(200).json({ data: users });
  } catch (err) {
    next(err);
  }
};

const createUser = async (req, res, next) => {
  try {
    const payload = validate(createUserSchema, req.body);
    const user = await adminService.createUser({ data: payload, createdBy: req.user.id });

    await auditService.log({
      action: 'user.created',
      table: 'users',
      recordId: user.id,
      entity: req.activeEntity,
      userId: req.user.id,
      details: { email: user.email, role: user.role },
    });

    res.status(201).json({ data: user });
  } catch (err) {
    next(err);
  }
};

const getUserById = async (req, res, next) => {
  try {
    const user = await adminService.getUserById(req.params.id);
    if (!user) {
      throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'User not found' });
    }
    res.status(200).json({ data: user });
  } catch (err) {
    next(err);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const payload = validate(updateUserSchema, req.body);
    const user = await adminService.updateUser({ id: req.params.id, data: payload, updatedBy: req.user.id });

    await auditService.log({
      action: 'user.updated',
      table: 'users',
      recordId: user.id,
      entity: req.activeEntity,
      userId: req.user.id,
      details: { email: user.email, role: user.role },
    });

    res.status(200).json({ data: user });
  } catch (err) {
    next(err);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const removed = await adminService.deleteUser({ id: req.params.id, deletedBy: req.user.id });
    if (!removed) {
      throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'User not found' });
    }

    await auditService.log({
      action: 'user.disabled',
      table: 'users',
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

const listPendingApprovals = async (req, res, next) => {
  try {
    const entityId = await resolveEntityId(req);
    const items = await adminService.listPendingApprovals({ entityId, user: req.user });
    res.status(200).json({ data: items });
  } catch (err) {
    next(err);
  }
};

const approvePending = async (req, res, next) => {
  try {
    const result = await adminService.approvePending({ id: req.params.id, user: req.user });

    await auditService.log({
      action: 'pending.approved',
      table: 'pending_changes',
      recordId: req.params.id,
      entity: req.activeEntity,
      userId: req.user.id,
      details: {},
    });

    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
};

const rejectPending = async (req, res, next) => {
  try {
    const payload = validate(rejectPendingSchema, req.body);
    const result = await adminService.rejectPending({ id: req.params.id, user: req.user, reason: payload.reason });

    await auditService.log({
      action: 'pending.rejected',
      table: 'pending_changes',
      recordId: req.params.id,
      entity: req.activeEntity,
      userId: req.user.id,
      details: { reason: payload.reason },
    });

    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
};

const getAuditLogCount = async (req, res, next) => {
  try {
    const total = await adminService.getAuditLogCount({ entityCode: req.activeEntity });
    res.status(200).json({ data: { total } });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  adminController: {
    listUsers,
    createUser,
    getUserById,
    updateUser,
    deleteUser,
    listPendingApprovals,
    approvePending,
    rejectPending,
    getAuditLogCount,
  },
};
