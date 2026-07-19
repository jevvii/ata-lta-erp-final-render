/**
 * Billing / Invoices controller.
 * Route handlers for invoices, payments, aging, and billing templates.
 *
 * Phase 5 — Agent B
 */

const {
  createInvoiceSchema,
  updateInvoiceSchema,
  recordPaymentSchema,
  billingTemplateSchema,
} = require('./schema');
const service = require('./service');
const AppError = require('../../lib/AppError');

/**
 * Handle Zod validation errors consistently.
 * @param {Error} err
 * @param {import('express').NextFunction} next
 */
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

// ============================================================
// Invoice Handlers
// ============================================================

/** @type {import('express').RequestHandler} */
const listInvoices = async (req, res, next) => {
  try {
    const filters = {
      status: req.query.status,
      clientId: req.query.clientId,
      linkedTaskId: req.query.linkedTaskId,
      search: req.query.search,
      archived: req.query.archived,
      page: parseInt(req.query.page, 10) || 1,
      limit: Math.min(parseInt(req.query.limit, 10) || 50, 100),
    };
    const result = await service.listInvoices({ entityId: req.activeEntity, filters });
    res.json({ data: result.data, meta: { total: result.count, page: filters.page, limit: filters.limit } });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const createInvoice = async (req, res, next) => {
  try {
    const validated = createInvoiceSchema.parse(req.body);
    const data = await service.createInvoice({
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
const getInvoice = async (req, res, next) => {
  try {
    const data = await service.getInvoiceById({
      entityId: req.activeEntity,
      id: req.params.id,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const updateInvoice = async (req, res, next) => {
  try {
    const validated = updateInvoiceSchema.parse(req.body);
    const data = await service.updateInvoice({
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
const deleteInvoice = async (req, res, next) => {
  try {
    await service.deleteInvoice({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const recordPayment = async (req, res, next) => {
  try {
    const validated = recordPaymentSchema.parse(req.body);
    const data = await service.recordPayment({
      entityId: req.activeEntity,
      invoiceId: req.params.id,
      userId: req.user.id,
      data: validated,
    });
    res.status(201).json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

/** @type {import('express').RequestHandler} */
const getInvoicePdf = async (req, res, next) => {
  try {
    const result = await service.generateInvoicePdf({
      entityId: req.activeEntity,
      entityCode: req.entityCode,
      id: req.params.id,
    });
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const getVoucherPdf = async (req, res, next) => {
  try {
    const result = await service.generateVoucherPdf({
      entityId: req.activeEntity,
      entityCode: req.entityCode,
      id: req.params.id,
    });
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const getAgingReport = async (req, res, next) => {
  try {
    const data = await service.getAgingReport({ entityId: req.activeEntity });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const getInvoiceCounts = async (req, res, next) => {
  try {
    const data = await service.getInvoiceCounts({ entityId: req.activeEntity, user: req.user });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

// ============================================================
// Template Handlers
// ============================================================

/** @type {import('express').RequestHandler} */
const listTemplates = async (req, res, next) => {
  try {
    const data = await service.listTemplates({ entityId: req.activeEntity });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const createTemplate = async (req, res, next) => {
  try {
    const validated = billingTemplateSchema.parse(req.body);
    const data = await service.createTemplate({
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
const updateTemplate = async (req, res, next) => {
  try {
    const validated = billingTemplateSchema.partial().parse(req.body);
    const data = await service.updateTemplate({
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
const deleteTemplate = async (req, res, next) => {
  try {
    await service.deleteTemplate({
      entityId: req.activeEntity,
      id: req.params.templateId,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  billingController: {
    listInvoices,
    createInvoice,
    getInvoice,
    updateInvoice,
    deleteInvoice,
    recordPayment,
    getInvoicePdf,
    getVoucherPdf,
    getAgingReport,
    getInvoiceCounts,
    listTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  },
};
