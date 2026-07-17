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

const resolveEntity = async (req, res, next) => {
  try {
    const code = req.activeEntity; // 'ATA' or 'LTA' from entityScope
    const uuid = await resolveEntityId(code);

    req.entityCode = code;     // preserve original string
    req.entityUUID = uuid;     // add UUID
    req.activeEntity = uuid;   // override for Agent B services

    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { resolveEntity };
