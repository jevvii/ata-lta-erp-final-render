/**
 * Operations Requests controller.
 * Route handlers for the Operations Requests module.
 */

const { createRequestSchema, updateRequestSchema, listQuerySchema } = require('./schema');
const service = require('./service');
const AppError = require('../../lib/AppError');
const { hasPermission } = require('../../lib/permissions');

/** @param {Error} err @param {import('express').NextFunction} next */
const handleZodError = (err, next) => {
  if (err.name === 'ZodError') {
    return next(
      new AppError({
        statusCode: 400,
        title: 'Validation Error',
        detail: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
      })
    );
  }
  next(err);
};

/** @type {import('express').RequestHandler} */
const listRequests = async (req, res, next) => {
  try {
    const validated = listQuerySchema.parse(req.query);
    const result = await service.listRequests({
      entityId: req.activeEntity,
      filters: validated,
      user: req.user,
    });
    res.json({
      data: result.data,
      meta: { total: result.count, page: validated.page, limit: validated.limit },
    });
  } catch (err) {
    handleZodError(err, next);
  }
};

const REQUEST_TYPE_PERMISSION = {
  billing: 'billing:request',
  disbursement: 'disbursement:request',
  transmittal: 'transmittal:request',
  wr_phase_transition: 'workflow:transition_request',
};

const FULFILL_TYPE_PERMISSION = {
  billing: 'billing:edit',
  disbursement: 'disbursement:edit',
  transmittal: 'transmittal:create',
  wr_phase_transition: 'workflow:phase_transition',
};

/** @type {import('express').RequestHandler} */
const createRequest = async (req, res, next) => {
  try {
    const validated = createRequestSchema.parse(req.body);
    const effectiveType =
      validated.type === 'wr_phase_transition' || validated.request_type === 'wr_phase_transition'
        ? 'wr_phase_transition'
        : (validated.type || validated.request_type);

    if (effectiveType === 'billing' && req.user?.role !== 'Admin') {
      const isDocumentation =
        req.user?.role?.toLowerCase() === 'documentation' ||
        (req.user?.departments || []).some(
          (d) => String(d).toLowerCase() === 'documentation'
        );
      if (isDocumentation) {
        return next(
          new AppError({
            statusCode: 403,
            title: 'Forbidden',
            detail: 'Documentation users cannot request invoice billing',
          })
        );
      }
    }

    const perms = req.userPermissions;
    if (effectiveType === 'wr_phase_transition') {
      if (!hasPermission(perms, 'workflow:transition_request') && req.user.role !== 'Admin') {
        return next(
          new AppError({
            statusCode: 403,
            title: 'Forbidden',
            detail: "You do not have permission 'workflow:transition_request' to request phase transitions",
          })
        );
      }
    } else {
      const canEdit = hasPermission(perms, 'workflow:edit');
      if (!canEdit) {
        const required = REQUEST_TYPE_PERMISSION[effectiveType];
        if (!required || !hasPermission(perms, required)) {
          return next(
            new AppError({
              statusCode: 403,
              title: 'Forbidden',
              detail: `You do not have permission to request type '${effectiveType}'`,
            })
          );
        }
      }
    }
    const data = await service.createRequest({
      entityId: req.activeEntity,
      userId: req.user.id,
      user: req.user,
      data: validated,
    });
    res.status(201).json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

/** @type {import('express').RequestHandler} */
const getRequest = async (req, res, next) => {
  try {
    const data = await service.getRequestById({
      entityId: req.activeEntity,
      id: req.params.id,
      user: req.user,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const updateRequest = async (req, res, next) => {
  try {
    const validated = updateRequestSchema.parse(req.body);
    const perms = req.userPermissions;
    const existing = await service.getRequestById({
      entityId: req.activeEntity,
      id: req.params.id,
      user: req.user,
    });

    if (existing.type === 'wr_phase_transition') {
      const isResolving = ['fulfilled', 'rejected'].includes(validated.status);
      const canResolve =
        hasPermission(perms, 'workflow:phase_transition') || req.user.role === 'Admin';
      const isOwner = existing.requested_by === req.user.id;
      if (isResolving && !canResolve) {
        return next(
          new AppError({
            statusCode: 403,
            title: 'Forbidden',
            detail: 'Only administrators with workflow:phase_transition can fulfill or reject phase transition requests',
          })
        );
      }
      if (!isResolving && !isOwner && !canResolve) {
        return next(
          new AppError({
            statusCode: 403,
            title: 'Forbidden',
            detail: 'You do not have permission to update this request',
          })
        );
      }
    } else {
      const canEdit = hasPermission(perms, 'workflow:edit');
      if (!canEdit) {
        const isOwner = existing.requested_by === req.user.id;
        const fulfillPerm = FULFILL_TYPE_PERMISSION[existing.type];
        const canFulfill = fulfillPerm && hasPermission(perms, fulfillPerm);
        if (!isOwner && !canFulfill) {
          return next(
            new AppError({
              statusCode: 403,
              title: 'Forbidden',
              detail: 'You do not have permission to update this request',
            })
          );
        }
      }
    }
    const data = await service.updateRequest({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      data: validated,
    });
    res.json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

/** @type {import('express').RequestHandler} */
const deleteRequest = async (req, res, next) => {
  try {
    const perms = req.userPermissions;
    const canEdit = hasPermission(perms, 'workflow:edit');
    if (!canEdit) {
      const existing = await service.getRequestById({
        entityId: req.activeEntity,
        id: req.params.id,
        user: req.user,
      });
      if (existing.requested_by !== req.user.id) {
        return next(
          new AppError({
            statusCode: 403,
            title: 'Forbidden',
            detail: 'You can only cancel your own requests',
          })
        );
      }
    }
    await service.deleteRequest({
      entityId: req.activeEntity,
      id: req.params.id,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const getCounts = async (req, res, next) => {
  try {
    const data = await service.getCounts({ entityId: req.activeEntity, user: req.user });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const approveRequest = async (req, res, next) => {
  req.body = {
    ...(req.body || {}),
    status: 'fulfilled',
    fulfilledBy: req.user?.id,
  };
  return updateRequest(req, res, next);
};

/** @type {import('express').RequestHandler} */
const rejectRequest = async (req, res, next) => {
  const reason =
    req.body?.rejectionReason ||
    req.body?.rejection_reason ||
    req.body?.reason ||
    'Rejected by approver';
  req.body = {
    ...(req.body || {}),
    status: 'rejected',
    rejectionReason: reason,
  };
  return updateRequest(req, res, next);
};

module.exports = {
  operationsRequestsController: {
    listRequests,
    createRequest,
    getRequest,
    updateRequest,
    deleteRequest,
    getCounts,
    approveRequest,
    rejectRequest,
  },
};
