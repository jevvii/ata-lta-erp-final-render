/**
 * Transmittals controller.
 * Route handlers for the Transmittals module.
 *
 * Phase 6 — Agent B
 */

const { createTransmittalSchema, updateTransmittalSchema } = require('./schema');
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
        detail: (err.issues || err.errors).map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
      })
    );
  }
  next(err);
};

/** @type {import('express').RequestHandler} */
const listTransmittals = async (req, res, next) => {
  try {
    const isAll =
      String(req.query.limit).toLowerCase() === 'all' ||
      req.query.limit === '0' ||
      req.query.limit === 0;
    const filters = {
      status: req.query.status,
      clientId: req.query.clientId,
      workRequestId: req.query.workRequestId,
      work_request_id: req.query.work_request_id,
      linkedWorkRequestId: req.query.linkedWorkRequestId,
      linked_work_request_id: req.query.linked_work_request_id,
      search: req.query.search,
      archived: req.query.archived,
      includeDeleted: req.query.includeDeleted,
      page: isAll ? 1 : (parseInt(req.query.page, 10) || 1),
      limit: isAll ? 'all' : Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 10000),
    };
    const result = await service.listTransmittals({
      entityId: req.activeEntity,
      filters,
      user: req.user,
    });
    res.json({
      data: result.data,
      meta: {
        total: result.count,
        page: isAll ? 1 : filters.page,
        limit: isAll ? result.count : filters.limit,
        totalPages: isAll ? 1 : (Math.ceil(result.count / filters.limit) || 1),
      },
    });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const getTransmittalCounts = async (req, res, next) => {
  try {
    const result = await service.countTransmittals({ entityId: req.activeEntity, user: req.user });
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
      entityCode: req.entityCode || req.headers['x-active-entity'],
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
const getTransmittal = async (req, res, next) => {
  try {
    const data = await service.getTransmittalById({
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
const updateTransmittal = async (req, res, next) => {
  try {
    const validated = injectExpectedVersion(req, updateTransmittalSchema.parse(req.body));
    const data = await service.updateTransmittal({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      user: req.user,
      data: validated,
    });
    res.json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

/** @type {import('express').RequestHandler} */
const approveTransmittal = async (req, res, next) => {
  try {
    const data = await service.approveTransmittal({
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
const sendTransmittal = async (req, res, next) => {
  try {
    const data = await service.sendTransmittal({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      user: req.user,
      boardOrder: req.body?.boardOrder,
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
      user: req.user,
      boardOrder: req.body?.boardOrder,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const archiveTransmittal = async (req, res, next) => {
  try {
    const data = await service.archiveTransmittal({
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
const unarchiveTransmittal = async (req, res, next) => {
  try {
    const data = await service.unarchiveTransmittal({
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
const deleteTransmittal = async (req, res, next) => {
  try {
    await service.deleteTransmittal({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      user: req.user,
    });
    res.status(204).send();
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
    approveTransmittal,
    sendTransmittal,
    acknowledgeTransmittal,
    archiveTransmittal,
    unarchiveTransmittal,
    deleteTransmittal,
  },
};
