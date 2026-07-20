/**
 * Entity scoping middleware.
 * Reads X-Active-Entity header, validates access, and attaches req.activeEntity.
 */

const AppError = require('../lib/AppError');

const VALID_ENTITIES = ['ATA', 'LTA', 'ALL'];

const entityScope = async (req, res, next) => {
  try {
    const userEntities = (req.user?.entities || []).map((e) => e.toUpperCase());
    let requested = (req.headers['x-active-entity'] || '').toUpperCase();

    // During login/restore the SPA may not know the active entity yet.
    // Default to the user's first available entity when no valid header is sent.
    if (!requested || !VALID_ENTITIES.includes(requested)) {
      const defaultEntity = userEntities.find((e) => VALID_ENTITIES.includes(e) && e !== 'ALL');
      if (defaultEntity) {
        requested = defaultEntity;
      } else {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail: 'X-Active-Entity header must be ATA, LTA, or ALL',
        });
      }
    }

    // ALL is only allowed for managerial users who can access both entities.
    if (requested === 'ALL') {
      const canSeeAll =
        req.user?.role === 'Admin' ||
        req.user?.role === 'Manager' ||
        (req.user?.departments || []).includes('Management');
      if (!canSeeAll) {
        throw new AppError({
          statusCode: 403,
          title: 'Forbidden',
          detail: 'Consolidated view requires a managerial role',
        });
      }
    }

    // ALL requires the user to have access to both real entities.
    if (requested === 'ALL') {
      const hasBoth = VALID_ENTITIES.filter((e) => e !== 'ALL').every((e) =>
        userEntities.includes(e)
      );
      if (!hasBoth) {
        throw new AppError({
          statusCode: 403,
          title: 'Forbidden',
          detail: 'Consolidated view requires access to both ATA and LTA entities',
        });
      }
    } else if (!userEntities.includes(requested)) {
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
