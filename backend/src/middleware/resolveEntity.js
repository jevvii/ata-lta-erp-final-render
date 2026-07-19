/**
 * Entity resolver middleware.
 * Converts the req.activeEntity string code ('ATA'/'LTA') set by entityScope
 * to the UUID from the entities table and attaches it as req.entityUUID.
 *
 * Also overrides req.activeEntity to the UUID for Agent B modules that pass
 * it directly to service queries. The original code is preserved as req.entityCode.
 *
 * Usage: Add to route files after auth + entityScope:
 *   const { resolveEntity } = require('../../middleware/resolveEntity');
 *   router.use(resolveEntity);
 */

const { resolveEntityId } = require('../lib/entityResolver');
const AppError = require('../lib/AppError');

const VALID_ENTITIES = ['ATA', 'LTA'];

function resolveEntity(options = {}) {
  return async (req, res, next) => {
    try {
      const code = req.activeEntity; // 'ATA', 'LTA', or 'ALL' from entityScope

      if (code === 'ALL') {
        if (options.allowAll) {
          req.entityCode = code;
          req.entityUUID = null;
          // Leave req.activeEntity as 'ALL' so services can handle consolidation.
          next();
          return;
        }

        // For non-consolidation endpoints, default to the user's first real entity.
        const fallback = (req.user?.entities || [])
          .map((e) => e.toUpperCase())
          .find((e) => VALID_ENTITIES.includes(e));
        if (!fallback) {
          throw new AppError({
            statusCode: 400,
            title: 'Bad Request',
            detail: 'No valid entity available for fallback',
          });
        }
        const uuid = await resolveEntityId(fallback);
        req.entityCode = code;
        req.entityUUID = uuid;
        req.activeEntity = uuid;
        next();
        return;
      }

      const uuid = await resolveEntityId(code);

      req.entityCode = code;     // preserve original string
      req.entityUUID = uuid;     // add UUID
      req.activeEntity = uuid;   // override for Agent B services

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { resolveEntity };
