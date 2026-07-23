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
  disbursementTemplateSchema,
} = require('./schema');
const service = require('./service');
const AppError = require('../../lib/AppError');

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
const listDisbursements = async (req, res, next) => {
  try {
    const filters = {
      status: req.query.status,
      category: req.query.category,
      fundSource: req.query.fundSource,
      linkedTaskId: req.query.linkedTaskId,
      search: req.query.search,
      archived: req.query.archived,
      page: parseInt(req.query.page, 10) || 1,
      limit: Math.min(parseInt(req.query.limit, 10) || 50, 100),
    };
    const result = await service.listDisbursements({ entityId: req.activeEntity, filters, user: req.user });
    res.json({
      data: result.data,
      meta: { total: result.count, page: filters.page, limit: filters.limit },
    });
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
      user: req.user,
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
const archiveDisbursement = async (req, res, next) => {
  try {
    const data = await service.archiveDisbursement({
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
const unarchiveDisbursement = async (req, res, next) => {
  try {
    const data = await service.unarchiveDisbursement({
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
const fundDisbursement = async (req, res, next) => {
  try {
    const data = await service.fundDisbursement({
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

/** @type {import('express').RequestHandler} */
const getDisbursementCounts = async (req, res, next) => {
  try {
    const data = await service.getDisbursementCounts({
      entityId: req.activeEntity,
      user: req.user,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const listDisbursementTemplates = async (req, res, next) => {
  try {
    const data = await service.listDisbursementTemplates({ entityId: req.activeEntity });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const createDisbursementTemplate = async (req, res, next) => {
  try {
    const validated = disbursementTemplateSchema.parse(req.body);
    const data = await service.createDisbursementTemplate({
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
const updateDisbursementTemplate = async (req, res, next) => {
  try {
    const validated = disbursementTemplateSchema.partial().parse(req.body);
    const data = await service.updateDisbursementTemplate({
      entityId: req.activeEntity,
      id: req.params.templateId,
      data: validated,
    });
    res.json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

/** @type {import('express').RequestHandler} */
const deleteDisbursementTemplate = async (req, res, next) => {
  try {
    await service.deleteDisbursementTemplate({
      entityId: req.activeEntity,
      id: req.params.templateId,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  disbursementsController: {
    listDisbursements,
    createDisbursement,
    getDisbursement,
    updateDisbursement,
    archiveDisbursement,
    unarchiveDisbursement,
    submitDisbursement,
    approveDisbursement,
    releaseDisbursement,
    fundDisbursement,
    rejectDisbursement,
    getDisbursementCounts,
    listDisbursementTemplates,
    createDisbursementTemplate,
    updateDisbursementTemplate,
    deleteDisbursementTemplate,
    deleteDisbursement: async (req, res, next) => {
      try {
        await service.deleteDisbursement({
          entityId: req.activeEntity,
          id: req.params.id,
          userId: req.user.id,
        });
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  },
};
