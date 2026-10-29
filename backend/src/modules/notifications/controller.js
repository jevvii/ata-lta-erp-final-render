/**
 * Notifications controller.
 * Route handlers for notifications module endpoints.
 */

const { listQuerySchema, markReadParamsSchema } = require('./schema');
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
 * GET /v1/notifications
 * @type {import('express').RequestHandler}
 */
const list = async (req, res, next) => {
  try {
    const validated = listQuerySchema.parse(req.query);
    const result = await service.listNotifications({
      userId: req.user.id,
      limit: validated.limit,
      cursor: validated.cursor,
    });
    res.status(200).json(result);
  } catch (err) {
    handleZodError(err, next);
  }
};

/**
 * POST /v1/notifications/:id/read
 * @type {import('express').RequestHandler}
 */
const markRead = async (req, res, next) => {
  try {
    const validated = markReadParamsSchema.parse(req.params);
    const data = await service.markAsRead({
      userId: req.user.id,
      id: validated.id,
    });
    res.status(200).json({ data });
  } catch (err) {
    handleZodError(err, next);
  }
};

/**
 * POST /v1/notifications/read-all
 * @type {import('express').RequestHandler}
 */
const markAllRead = async (req, res, next) => {
  try {
    const data = await service.markAllAsRead({
      userId: req.user.id,
    });
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  notificationsController: {
    list,
    markRead,
    markAllRead,
  },
};
