/**
 * Entity scoping middleware.
 * Reads X-Active-Entity header, validates access, and attaches req.activeEntity.
 */

const AppError = require('../lib/AppError');

const VALID_ENTITIES = ['ATA', 'LTA'];

const entityScope = async (req, res, next) => {
  try {
    const requested = (req.headers['x-active-entity'] || '').toUpperCase();

    if (!requested || !VALID_ENTITIES.includes(requested)) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'X-Active-Entity header must be ATA or LTA',
      });
    }

    const userEntities = (req.user?.entities || []).map((e) => e.toUpperCase());

    if (!userEntities.includes(requested)) {
      throw new AppError({
        statusCode: 403,
        title: 'Forbidden',
        detail: `User does not have access to entity ${requested}`,
      });
    }

    req.activeEntity = requested;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { entityScope };
