/**
 * Reports controller.
 * Route handlers for the Reports module.
 *
 * Phase 7 — Agent B
 */

const {
  dailyQuerySchema,
  weeklyQuerySchema,
  monthlyPendingQuerySchema,
} = require('./schema');
const service = require('./service');
const AppError = require('../../lib/AppError');

/** @type {import('express').RequestHandler} */
const analytics = async (req, res, next) => {
  try {
    const data = await service.getAnalytics({ entityId: req.activeEntity });
    res.set('Cache-Control', 'private, max-age=30');
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const dashboard = async (req, res, next) => {
  try {
    const data = await service.getDashboardSummary({ entityId: req.activeEntity });
    res.set('Cache-Control', 'private, max-age=30');
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const daily = async (req, res, next) => {
  try {
    const validated = dailyQuerySchema.parse(req.query);
    const data = await service.getDailyReport({
      entityId: req.activeEntity,
      date: validated.date,
    });
    res.json({ data });
  } catch (err) {
    if (err.name === 'ZodError') {
      return next(new AppError({
        statusCode: 400,
        title: 'Validation Error',
        detail: err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
      }));
    }
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const weekly = async (req, res, next) => {
  try {
    const validated = weeklyQuerySchema.parse(req.query);
    const data = await service.getWeeklyReport({
      entityId: req.activeEntity,
      date: validated.date,
    });
    res.json({ data });
  } catch (err) {
    if (err.name === 'ZodError') {
      return next(new AppError({
        statusCode: 400,
        title: 'Validation Error',
        detail: err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
      }));
    }
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const monthlyPending = async (req, res, next) => {
  try {
    const validated = monthlyPendingQuerySchema.parse(req.query);
    const data = await service.getMonthlyPending({
      entityId: req.activeEntity,
      month: validated.month,
    });
    res.json({ data });
  } catch (err) {
    if (err.name === 'ZodError') {
      return next(new AppError({
        statusCode: 400,
        title: 'Validation Error',
        detail: err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
      }));
    }
    next(err);
  }
};

/** @type {import('express').RequestHandler} */
const aging = async (req, res, next) => {
  try {
    const data = await service.getAgingReport({ entityId: req.activeEntity });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  reportsController: {
    analytics,
    dashboard,
    daily,
    weekly,
    monthlyPending,
    aging,
  },
};
