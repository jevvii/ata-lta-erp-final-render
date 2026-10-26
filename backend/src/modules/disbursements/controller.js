/**
 * Disbursements controller.
 * Route handlers for the Disbursements module.
 *
 * Authorized Disbursement Lifecycle Redesign (v2)
 */

const {
  createDisbursementSchema,
  updateDisbursementSchema,
  approveDisbursementSchema,
  fundDisbursementSchema,
  releaseDisbursementSchema,
  rejectSchema,
  resendDraftSchema,
  archiveDisbursementSchema,
  createReceiptUploadSchema,
  updatePaymentDetailsSchema,
  disbursementTemplateSchema,
} = require('./schema');
const service = require('./service');
const AppError = require('../../lib/AppError');
const { injectExpectedVersion } = require('../../lib/concurrency');

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
      queue: req.query.queue,
      status: req.query.status,
      category: req.query.category,
      fundSource: req.query.fundSource,
      taskId: req.query.taskId || req.query.task_id,
      linkedTaskId: req.query.linkedTaskId,
      linkedTransmittalId: req.query.linkedTransmittalId,
      search: req.query.search,
      archived: req.query.archived,
      offset: req.query.offset !== undefined ? parseInt(req.query.offset, 10) : undefined,
      page: parseInt(req.query.page, 10) || 1,
      limit: Math.min(parseInt(req.query.limit, 10) || 50, 100),
    };
    const result = await service.listDisbursements({
      entityId: req.activeEntity,
      filters,
      user: req.user,
    });
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
      user: req.user,
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
    const payload = injectExpectedVersion(req, req.body || {});
    const validated = updateDisbursementSchema.parse(payload);
    const data = await service.updateDisbursement({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      data: validated,
      user: req.user,
    });
    res.json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

/** @type {import('express').RequestHandler} */
const archiveDisbursement = async (req, res, next) => {
  try {
    const payload = injectExpectedVersion(req, req.body || {});
    const validated = archiveDisbursementSchema.parse(payload);
    const data = await service.archiveDisbursement({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      user: req.user,
      expectedVersion: validated.expectedVersion,
    });
    res.json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

/** @type {import('express').RequestHandler} */
const unarchiveDisbursement = async (req, res, next) => {
  try {
    const payload = injectExpectedVersion(req, req.body || {});
    const validated = archiveDisbursementSchema.parse(payload);
    const data = await service.unarchiveDisbursement({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      user: req.user,
      expectedVersion: validated.expectedVersion,
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
      user: req.user,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const forwardDisbursement = async (req, res, next) => {
  try {
    const data = await service.forwardDisbursement({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      user: req.user,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const approveDisbursement = async (req, res, next) => {
  try {
    const payload = injectExpectedVersion(req, req.body || {});
    const validated = approveDisbursementSchema.parse(payload);
    const data = await service.approveDisbursement({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      user: req.user,
      expectedVersion: validated.expectedVersion,
    });
    res.json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

/** @type {import('express').RequestHandler} */
const fundDisbursement = async (req, res, next) => {
  try {
    const payload = injectExpectedVersion(req, req.body || {});
    const validated = fundDisbursementSchema.parse(payload);
    const data = await service.fundDisbursement({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      user: req.user,
      paymentDetails: {
        method: validated.method,
        bank: validated.bank,
        reference: validated.reference,
        date: validated.date,
      },
      expectedVersion: validated.expectedVersion,
    });
    res.json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

/** @type {import('express').RequestHandler} */
const releaseDisbursement = async (req, res, next) => {
  try {
    const payload = injectExpectedVersion(req, req.body || {});
    const validated = releaseDisbursementSchema.parse(payload);
    const data = await service.releaseDisbursement({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      user: req.user,
      expectedVersion: validated.expectedVersion,
    });
    res.json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

/** @type {import('express').RequestHandler} */
const rejectDisbursement = async (req, res, next) => {
  try {
    const payload = injectExpectedVersion(req, req.body || {});
    const validated = rejectSchema.parse(payload);
    const data = await service.rejectDisbursement({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      user: req.user,
      reason: validated.reason,
      expectedVersion: validated.expectedVersion,
    });
    res.json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

/** @type {import('express').RequestHandler} */
const resendDraftDisbursement = async (req, res, next) => {
  try {
    const payload = injectExpectedVersion(req, req.body || {});
    const validated = resendDraftSchema.parse(payload);
    const data = await service.resendDraftDisbursement({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      user: req.user,
      expectedVersion: validated.expectedVersion,
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

/** @type {import('express').RequestHandler} */
const updatePaymentDetails = async (req, res, next) => {
  try {
    const validated = updatePaymentDetailsSchema.parse(req.body);
    const data = await service.updatePaymentDetails({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      user: req.user,
      method: validated.method,
      reference: validated.reference,
      bank: validated.bank,
      date: validated.date,
      expectedVersion: validated.expectedVersion,
    });
    res.json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

/** @type {import('express').RequestHandler} */
const createReceiptUpload = async (req, res, next) => {
  try {
    const validated = createReceiptUploadSchema.parse(req.body);
    const data = await service.createReceiptUpload({
      entityId: req.activeEntity,
      entityCode: req.entityCode || req.activeEntity,
      userId: req.user.id,
      user: req.user,
      filename: validated.filename,
      contentType: validated.contentType,
      size: validated.size,
    });
    res.status(201).json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

/** @type {import('express').RequestHandler} */
const completeReceiptUpload = async (req, res, next) => {
  try {
    const data = await service.completeReceiptUpload({
      entityId: req.activeEntity,
      uploadId: req.params.uploadId,
      userId: req.user.id,
      user: req.user,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const getReceiptUrl = async (req, res, next) => {
  try {
    const data = await service.getReceiptUrl({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      user: req.user,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const getDisbursementPdf = async (req, res, next) => {
  try {
    for (const key of ['noLogo', 'includeCompanyDetails']) {
      if (req.query[key] !== undefined && !['true', 'false'].includes(req.query[key])) {
        throw new AppError({
          statusCode: 400,
          title: 'Validation Error',
          detail: `${key} must be true or false.`,
        });
      }
    }
    const data = await service.generateDisbursementPdf({
      entityId: req.activeEntity,
      id: req.params.id,
      user: req.user,
      noLogo: req.query.noLogo === 'true',
      includeCompanyDetails: req.query.includeCompanyDetails !== 'false',
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const deleteDisbursement = async (req, res, next) => {
  try {
    const payload = injectExpectedVersion(req, req.body || {});
    await service.deleteDisbursement({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      user: req.user,
      expectedVersion: payload.expectedVersion,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  disbursementsController: {
    getDisbursementPdf,
    listDisbursements,
    createDisbursement,
    getDisbursement,
    updateDisbursement,
    archiveDisbursement,
    unarchiveDisbursement,
    submitDisbursement,
    forwardDisbursement,
    approveDisbursement,
    fundDisbursement,
    releaseDisbursement,
    rejectDisbursement,
    resendDraftDisbursement,
    getDisbursementCounts,
    listDisbursementTemplates,
    createDisbursementTemplate,
    updateDisbursementTemplate,
    deleteDisbursementTemplate,
    updatePaymentDetails,
    createReceiptUpload,
    completeReceiptUpload,
    getReceiptUrl,
    deleteDisbursement,
  },
};
