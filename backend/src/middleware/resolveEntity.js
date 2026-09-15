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

const { resolveEntityId, resolveEntityCode } = require('../lib/entityResolver');
const { supabaseAdmin } = require('../services/supabaseClient');
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

        let resolvedCode = null;
        let resolvedUUID = null;

        // 1. Explicit valid entity in body
        if (req.body?.entity && typeof req.body.entity === 'string' && VALID_ENTITIES.includes(req.body.entity.toUpperCase())) {
          resolvedCode = req.body.entity.toUpperCase();
        }

        // 2. Detect from clientId
        const clientId = req.body?.clientId || req.body?.client_id;
        if (!resolvedCode && clientId) {
          const { data: client } = await supabaseAdmin
            .from('clients')
            .select('entity_id')
            .eq('id', clientId)
            .maybeSingle();
          if (client?.entity_id) {
            resolvedUUID = client.entity_id;
            resolvedCode = await resolveEntityCode(client.entity_id);
          }
        }

        // 3. Detect from workRequestId
        const wrId = req.body?.workRequestId || req.body?.work_request_id || req.body?.linkedWorkRequestId || req.body?.linked_work_request_id || req.params?.wrId;
        if (!resolvedCode && wrId) {
          const { data: wr } = await supabaseAdmin
            .from('work_requests')
            .select('entity_id')
            .eq('id', wrId)
            .maybeSingle();
          if (wr?.entity_id) {
            resolvedUUID = wr.entity_id;
            resolvedCode = await resolveEntityCode(wr.entity_id);
          }
        }

        // 4. Detect from route param id (e.g. /operations/:id)
        if (!resolvedCode && req.params?.id) {
          const { data: wr } = await supabaseAdmin
            .from('work_requests')
            .select('entity_id')
            .eq('id', req.params.id)
            .maybeSingle();
          if (wr?.entity_id) {
            resolvedUUID = wr.entity_id;
            resolvedCode = await resolveEntityCode(wr.entity_id);
          }
        }

        // 5. Fallback to user's first real entity
        if (!resolvedCode) {
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
          resolvedCode = fallback;
        }

        if (!resolvedUUID && resolvedCode) {
          resolvedUUID = await resolveEntityId(resolvedCode);
        }

        req.entityCode = resolvedCode;
        req.entityUUID = resolvedUUID;
        req.activeEntity = resolvedUUID;

        if (req.body && req.body.entity === 'ALL') {
          req.body.entity = resolvedCode;
        }

        next();
        return;
      }

      const uuid = await resolveEntityId(code);

      req.entityCode = code; // preserve original string
      req.entityUUID = uuid; // add UUID
      req.activeEntity = uuid; // override for Agent B services

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { resolveEntity };
