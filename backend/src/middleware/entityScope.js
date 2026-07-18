/**
 * Entity scoping middleware.
 * Reads X-Active-Entity header, validates access, and attaches req.activeEntity.
 */

const AppError = require('../lib/AppError');

const VALID_ENTITIES = ['ATA', 'LTA'];

const entityScope = async (req, res, next) => {
  try {
    const userEntities = (req.user?.entities || []).map((e) => e.toUpperCase());
    let requested = (req.headers['x-active-entity'] || '').toUpperCase();

    // During login/restore the SPA may not know the active entity yet.
    // Default to the user's first available entity when no valid header is sent.
    if (!requested || !VALID_ENTITIES.includes(requested)) {
      const defaultEntity = userEntities.find((e) => VALID_ENTITIES.includes(e));
      if (defaultEntity) {
        requested = defaultEntity;
      } else {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail: 'X-Active-Entity header must be ATA or LTA',
        });
      }
    }

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
