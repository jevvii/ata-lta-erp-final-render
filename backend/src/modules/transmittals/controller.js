/**
 * Transmittals controller.
 * Route handlers for the Transmittals module.
 *
 * Phase 6 — Agent B
 */

const {
  createTransmittalSchema,
  updateTransmittalSchema,
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
const listTransmittals = async (req, res, next) => {
  try {
    const filters = {
      status: req.query.status,
      clientId: req.query.clientId,
      search: req.query.search,
      page: parseInt(req.query.page, 10) || 1,
      limit: Math.min(parseInt(req.query.limit, 10) || 50, 100),
    };
    const result = await service.listTransmittals({ entityId: req.activeEntity, filters });
    res.json({ data: result.data, meta: { total: result.count, page: filters.page, limit: filters.limit } });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const getTransmittalCounts = async (req, res, next) => {
  try {
    const result = await service.countTransmittals({ entityId: req.activeEntity });
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const createTransmittal = async (req, res, next) => {
  try {
    const validated = createTransmittalSchema.parse(req.body);
    const data = await service.createTransmittal({
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
const getTransmittal = async (req, res, next) => {
  try {
    const data = await service.getTransmittalById({
      entityId: req.activeEntity,
      id: req.params.id,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const updateTransmittal = async (req, res, next) => {
  try {
    const validated = updateTransmittalSchema.parse(req.body);
    const data = await service.updateTransmittal({
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
const sendTransmittal = async (req, res, next) => {
  try {
    const data = await service.sendTransmittal({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const acknowledgeTransmittal = async (req, res, next) => {
  try {
    const data = await service.acknowledgeTransmittal({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  transmittalsController: {
    listTransmittals,
    getTransmittalCounts,
    createTransmittal,
    getTransmittal,
    updateTransmittal,
    sendTransmittal,
    acknowledgeTransmittal,
  },
};
