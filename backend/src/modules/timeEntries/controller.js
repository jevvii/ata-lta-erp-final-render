/**
 * Time Entries controller.
 * Route handlers for time entries module endpoints.
 */

const {
  createTimeEntrySchema,
  updateTimeEntrySchema,
  listQuerySchema,
  summaryQuerySchema,
  entryParamsSchema,
} = require('./schema');
const service = require('./service');
const AppError = require('../../lib/AppError');

/**
 * Handle Zod validation errors and forward as AppError.
 * @param {Error} err
 * @param {import('express').NextFunction} next
 */
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

/**
 * POST /v1/time-entries
 * Guard: timelog:create
 * @type {import('express').RequestHandler}
 */
const create = async (req, res, next) => {
  try {
    const validated = createTimeEntrySchema.parse(req.body);
    // Rule R1: Creator forced to req.user.id; client-supplied user_id ignored
    const data = await service.createTimeEntry({
      userId: req.user.id,
      entityId: req.entityUUID,
      taskId: validated.task_id,
      entryDate: validated.entry_date,
      durationMinutes: validated.duration_minutes,
      note: validated.note,
    });
    res.status(201).json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

/**
 * GET /v1/time-entries
 * Guard: timelog:view
 * @type {import('express').RequestHandler}
 */
const list = async (req, res, next) => {
  try {
    const filters = listQuerySchema.parse(req.query);
    const data = await service.listTimeEntries({
      user: req.user,
      entityId: req.entityUUID,
      userPermissions: req.userPermissions,
      filters,
    });
    res.status(200).json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

/**
 * PATCH /v1/time-entries/:id
 * Guard: timelog:edit_own (or timelog:edit_all)
 * @type {import('express').RequestHandler}
 */
const update = async (req, res, next) => {
  try {
    const { id } = entryParamsSchema.parse(req.params);
    const updates = updateTimeEntrySchema.parse(req.body);
    const data = await service.updateTimeEntry({
      id,
      user: req.user,
      entityId: req.entityUUID,
      userPermissions: req.userPermissions,
      updates,
    });
    res.status(200).json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

/**
 * DELETE /v1/time-entries/:id
 * Guard: timelog:edit_own (or timelog:edit_all)
 * @type {import('express').RequestHandler}
 */
const deleteEntry = async (req, res, next) => {
  try {
    const { id } = entryParamsSchema.parse(req.params);
    await service.deleteTimeEntry({
      id,
      user: req.user,
      entityId: req.entityUUID,
      userPermissions: req.userPermissions,
    });
    res.status(204).send();
  } catch (err) {
    handleZodError(err, next);
  }
};

/**
 * GET /v1/time-entries/summary?date=
 * Guard: timelog:view
 * @type {import('express').RequestHandler}
 */
const summary = async (req, res, next) => {
  try {
    const { date, user_id } = summaryQuerySchema.parse(req.query);
    const result = await service.getSummary({
      user: req.user,
      entityId: req.entityUUID,
      userPermissions: req.userPermissions,
      date,
      targetUserId: user_id,
    });
    res.status(200).json({ data: result, ...result });
  } catch (err) {
    handleZodError(err, next);
  }
};

module.exports = {
  timeEntriesController: {
    create,
    list,
    update,
    deleteEntry,
    summary,
  },
};
