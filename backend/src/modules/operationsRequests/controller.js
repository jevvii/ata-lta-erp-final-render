/**
 * Operations Requests controller.
 * Route handlers for the Operations Requests module.
 */

const {
  createRequestSchema,
  updateRequestSchema,
  listQuerySchema,
} = require('./schema');
const service = require('./service');
const AppError = require('../../lib/AppError');

/** @param {Error} err @param {import('express').NextFunction} next */
const handleZodError = (err, next) => {
  if (err.name === 'ZodError') {
    return next(new AppError({
      statusCode: 400,
      title: 'Validation Error',
      detail: err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
    }));
  }
  next(err);
};

/** @type {import('express').RequestHandler} */
const listRequests = async (req, res, next) => {
  try {
    const validated = listQuerySchema.parse(req.query);
    const result = await service.listRequests({ entityId: req.activeEntity, filters: validated });
    res.json({ data: result.data, meta: { total: result.count, page: validated.page, limit: validated.limit } });
  } catch (err) {
    handleZodError(err, next);
  }
};

/** @type {import('express').RequestHandler} */
const createRequest = async (req, res, next) => {
  try {
    const validated = createRequestSchema.parse(req.body);
    const data = await service.createRequest({
      entityId: req.activeEntity,
      userId: req.user.id,
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

module.exports = {
  operationsRequestsController: {
    listRequests,
    createRequest,
    getRequest,
    updateRequest,
    deleteRequest,
    getCounts,
  },
};
