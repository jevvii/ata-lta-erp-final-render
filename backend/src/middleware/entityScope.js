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

    const hasBoth =
      userEntities.includes('ALL') ||
      VALID_ENTITIES.filter((e) => e !== 'ALL').every((e) =>
        userEntities.includes(e)
      );

    // During login/restore the SPA may not know the active entity yet, or omits header for 'ALL'.
    // When omitted, default to 'ALL' if user is authorized for both entities; otherwise default to first available entity.
    if (!requested || !VALID_ENTITIES.includes(requested)) {
      if (!requested && hasBoth) {
        requested = 'ALL';
      } else {
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
    }

    // ALL requires the user to have access to both real entities.
    if (requested === 'ALL') {
      if (!hasBoth) {
        throw new AppError({
          statusCode: 403,
          title: 'Forbidden',
          detail: 'Consolidated view requires access to both ATA and LTA entities',
        });
      }
    } else if (!userEntities.includes(requested) && !userEntities.includes('ALL')) {
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
