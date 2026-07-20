/**
 * Documents module controller.
 * Route handlers for the Documents / DMS module.
 *
 * Phase 3 — Agent B
 */

const { createDocumentSchema, updateDocumentSchema, lifecycleSchema } = require('./schema');
const service = require('./service');
const AppError = require('../../lib/AppError');

/**
 * List documents for the active entity.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const listDocuments = async (req, res, next) => {
  try {
    const entityId = req.activeEntity;
    const filters = {
      category: req.query.category,
      status: req.query.status,
      lifecycle: req.query.lifecycle,
      clientId: req.query.clientId,
      workRequestId: req.query.workRequestId,
      linkedTaskId: req.query.linkedTaskId,
      search: req.query.search,
      archived:
        req.query.archived === 'true' ? true : req.query.archived === 'false' ? false : undefined,
      page: parseInt(req.query.page, 10) || 1,
      limit: Math.min(parseInt(req.query.limit, 10) || 50, 100),
    };
    const result = await service.listDocuments({ entityId, filters });
    res.json({
      data: result.data,
      meta: { total: result.count, page: filters.page, limit: filters.limit },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Create document metadata and return upload URL.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const createDocument = async (req, res, next) => {
  try {
    const validated = createDocumentSchema.parse(req.body);
    const result = await service.createDocument({
      entityId: req.activeEntity,
      entityCode: req.entityCode,
      userId: req.user.id,
      data: validated,
    });
    res.status(201).json({ data: result });
  } catch (err) {
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
  }
};

/**
 * Get a single document by ID.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const getDocument = async (req, res, next) => {
  try {
    const data = await service.getDocumentById({
      entityId: req.activeEntity,
      id: req.params.id,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/**
 * Update document metadata.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const updateDocument = async (req, res, next) => {
  try {
    const validated = updateDocumentSchema.parse(req.body);
    const data = await service.updateDocument({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      data: validated,
    });
    res.json({ data });
  } catch (err) {
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
  }
};

/**
 * Soft-delete a document.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const deleteDocument = async (req, res, next) => {
  try {
    await service.deleteDocument({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

/**
 * Confirm that a storage upload has completed.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const confirmUpload = async (req, res, next) => {
  try {
    const data = await service.confirmUpload({
      entityId: req.activeEntity,
      id: req.params.id,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/**
 * Get a signed download URL for a document.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const getDownloadUrl = async (req, res, next) => {
  try {
    const result = await service.getDownloadUrl({
      entityId: req.activeEntity,
      id: req.params.id,
    });
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
};

/**
 * Transition a document's lifecycle state.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const updateLifecycle = async (req, res, next) => {
  try {
    const validated = lifecycleSchema.parse(req.body);
    const data = await service.updateLifecycle({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user.id,
      lifecycle: validated.lifecycle,
    });
    res.json({ data });
  } catch (err) {
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
  }
};

module.exports = {
  documentsController: {
    listDocuments,
    createDocument,
    getDocument,
    updateDocument,
    deleteDocument,
    confirmUpload,
    getDownloadUrl,
    updateLifecycle,
  },
};
