/**
 * Disbursements controller.
 * Route handlers for the Disbursements module.
 *
 * Phase 6 — Agent B
 */

const {
  createDisbursementSchema,
  updateDisbursementSchema,
  rejectSchema,
  releasePaymentSchema,
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
const listDisbursements = async (req, res, next) => {
  try {
    const filters = {
      status: req.query.status,
      category: req.query.category,
      fundSource: req.query.fundSource,
      search: req.query.search,
      page: parseInt(req.query.page, 10) || 1,
      limit: Math.min(parseInt(req.query.limit, 10) || 50, 100),
    };
    const result = await service.listDisbursements({ entityId: req.activeEntity, filters });
    res.json({ data: result.data, meta: { total: result.count, page: filters.page, limit: filters.limit } });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const createDisbursement = async (req, res, next) => {
  try {
    const validated = createDisbursementSchema.parse(req.body);
    const data = await service.createDisbursement({
      entityId: req.activeEntity,
      entityCode: req.entityCode,
      userId: req.user.id,
      data: validated,
    });
    res.status(201).json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

/** @type {import('express').RequestHandler} */
const getDisbursement = async (req, res, next) => {
  try {
    const data = await service.getDisbursementById({
      entityId: req.activeEntity,
      id: req.params.id,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const updateDisbursement = async (req, res, next) => {
  try {
    const validated = updateDisbursementSchema.parse(req.body);
    const data = await service.updateDisbursement({
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
const submitDisbursement = async (req, res, next) => {
  try {
    const data = await service.submitDisbursement({
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
const approveDisbursement = async (req, res, next) => {
  try {
    const data = await service.approveDisbursement({
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
const releaseDisbursement = async (req, res, next) => {
  try {
    const paymentDetails = releasePaymentSchema.parse(req.body || {});
    const data = await service.releaseDisbursement({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      paymentDetails,
    });
    res.json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

/** @type {import('express').RequestHandler} */
const rejectDisbursement = async (req, res, next) => {
  try {
    const validated = rejectSchema.parse(req.body);
    const data = await service.rejectDisbursement({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      reason: validated.reason,
    });
    res.json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

module.exports = {
  disbursementsController: {
    listDisbursements,
    createDisbursement,
    getDisbursement,
    updateDisbursement,
    submitDisbursement,
    approveDisbursement,
    releaseDisbursement,
    rejectDisbursement,
  },
};
