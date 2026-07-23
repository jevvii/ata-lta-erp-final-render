/**
 * Admin / Users controller.
 */

const adminService = require('./service');
const {
  createUserSchema,
  updateUserSchema,
  rejectPendingSchema,
  createPendingSchema,
  listAuditQuerySchema,
} = require('./schema');
const auditService = require('../../services/auditService');
const AppError = require('../../lib/AppError');
const { computePermissions } = require('../../middleware/rbac');
const { hasPermission } = require('../../lib/permissions');

const validate = (schema, data) => {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      detail: issues,
      code: 'VALIDATION_ERROR',
    });
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
    const user = await adminService.updateUser({
      id: req.params.id,
      data: payload,
      updatedBy: req.user.id,
    });

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

const getNormalTableName = (tableName) => {
  const TABLE_NAME_MAP = {
    workRequests: 'work_requests',
    work_requests: 'work_requests',
    clients: 'clients',
    tasks: 'tasks',
    workRequestPhaseRouting: 'work_request_phase_routing',
    work_request_phase_routing: 'work_request_phase_routing',
    invoices: 'invoices',
    disbursements: 'disbursements',
    transmittals: 'transmittals',
  };
  return TABLE_NAME_MAP[tableName] || tableName;
};

const hasApprovePermission = (permissions, tableName) => {
  const norm = getNormalTableName(tableName);
  return hasPermission(permissions, `approve_change:${norm}`) ||
         hasPermission(permissions, `approve_change:${tableName}`);
};

const listPendingApprovals = async (req, res, next) => {
  try {
    const entityId = await resolveEntityId(req);
    const permissions = computePermissions(req.user);
    const canApproveAll = hasPermission(permissions, 'approve_change:*');
    const hasAnyApprove = Array.from(permissions).some(p => p.startsWith('approve_change:'));

    let submittedBy = req.query.submittedBy;
    if (!canApproveAll && !hasAnyApprove) {
      submittedBy = req.user.id;
    }

    const items = await adminService.listPendingApprovals({
      entityId,
      user: req.user,
      status: req.query.status,
      tableName: req.query.tableName,
      parentRecordId: req.query.parentRecordId,
      submittedBy,
    });

    let filteredItems = items;
    if (!canApproveAll) {
      filteredItems = items.filter(item => {
        if (item.submittedBy === req.user.id) return true;
        return hasApprovePermission(permissions, item.tableName);
      });
    }

    res.status(200).json({ data: filteredItems });
  } catch (err) {
    next(err);
  }
};

const createPending = async (req, res, next) => {
  try {
    const payload = validate(createPendingSchema, req.body);
    const entityId = await resolveEntityId(req);
    const item = await adminService.createPendingChange({
      entityId,
      userId: req.user.id,
      data: payload,
    });

    await auditService.log({
      action: 'pending.created',
      table: 'pending_changes',
      recordId: item.id,
      entity: req.activeEntity,
      userId: req.user.id,
      details: { tableName: item.tableName, parentRecordId: item.parentRecordId },
    });

    res.status(201).json({ data: item });
  } catch (err) {
    next(err);
  }
};

const getPendingById = async (req, res, next) => {
  try {
    const entityId = await resolveEntityId(req);
    const item = await adminService.getPendingChangeById({ entityId, id: req.params.id });

    const permissions = computePermissions(req.user);
    const canApprove = hasPermission(permissions, 'approve_change:*') ||
                       hasApprovePermission(permissions, item.tableName);
    if (!canApprove && item.submittedBy !== req.user.id) {
      throw new AppError({
        statusCode: 403,
        title: 'Forbidden',
        detail: 'You are not authorized to view this pending change',
      });
    }

    res.status(200).json({ data: item });
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
    const result = await adminService.rejectPending({
      id: req.params.id,
      user: req.user,
      reason: payload.reason,
    });

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

const listAudit = async (req, res, next) => {
  try {
    const filters = validate(listAuditQuerySchema, req.query);
    const result = await adminService.getAuditLogs({ entityCode: req.activeEntity, filters });
    res.status(200).json(result);
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
    createPending,
    getPendingById,
    approvePending,
    rejectPending,
    getAuditLogCount,
    listAudit,
  },
};
