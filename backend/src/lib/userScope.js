/**
 * User scoping / visibility utilities.
 */

const { supabaseAdmin } = require('../services/supabaseClient');
const AppError = require('./AppError');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUUID = (id) =>
  typeof id === 'string' &&
  UUID_REGEX.test(id.trim());

const PAGE_SIZE = 1000;

/**
 * Executes a paginated query in pages of PAGE_SIZE to prevent silent default-1000 truncation.
 * Fails closed on any error.
 *
 * @param {Function} queryFactory - Function returning a Supabase query builder
 * @returns {Promise<any[]>}
 */
const fetchInPages = async (queryFactory) => {
  const results = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    let builder = queryFactory();
    if (typeof builder.order === 'function') {
      builder = builder.order('id', { ascending: true });
    }
    const query = builder.range(offset, offset + PAGE_SIZE - 1);
    const { data, error } = await query;
    if (error) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: `Database query pagination error: ${error.message || String(error)}`,
      });
    }
    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }
    results.push(...data);
    if (data.length < PAGE_SIZE) {
      hasMore = false;
      break;
    }
    offset += PAGE_SIZE;
  }
  return results;
};

/**
 * Resolve whether an entity matches the user's allowed entities.
 * Handles 'ALL' inside user.entities explicitly and handles Admin entity restrictions.
 */
const isUserEntitledToEntity = async (entityIdOrCode, user) => {
  if (!user) return false;
  if (!entityIdOrCode) return false;

  const userEntities = (user.entities || []).map((e) => String(e).toUpperCase());
  if (userEntities.includes('ALL')) return true;
  // Admin with empty entities array is unrestricted
  if (userEntities.length === 0 && user.role === 'Admin') return true;

  if (userEntities.includes(String(entityIdOrCode).toUpperCase())) {
    return true;
  }

  // Otherwise resolve entity UUID to code
  const { data: ent, error } = await supabaseAdmin
    .from('entities')
    .select('code')
    .eq('id', entityIdOrCode)
    .maybeSingle();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: `Failed to resolve entity code: ${error.message || String(error)}`,
    });
  }

  if (!ent || !ent.code) return false;
  return userEntities.includes(String(ent.code).toUpperCase());
};

/**
 * Get all work request IDs that a user is a current project member of.
 * Membership includes:
 * 1. work_requests.assigned_to = user.id (lead)
 * 2. work_requests.co_assignees UUID array includes user.id
 * 3. tasks.assignee_id = user.id (primary task assignee) on non-deleted task
 * 4. task_assignees.user_id = user.id (relational task assignee) on non-deleted task
 *
 * Excludes: requested_by, submitted_by, display names, checklists, soft-deleted records.
 * Uses actual schema columns (tasks has NO entity_id and NO co_assignees in schema).
 * Bounded/paginated queries prevent silent truncation.
 * Fails closed on database errors.
 *
 * @param {object} user
 * @param {object} [options]
 * @param {string} [options.entityId]
 * @returns {Promise<string[]>}
 */
const getUserConcernedWorkRequestIds = async (user, options = {}) => {
  if (!user || !user.id || !isValidUUID(user.id)) return [];
  const entityId = options.entityId;

  // 1. Relational task assignees (join table task_assignees)
  const taRows = await fetchInPages(() =>
    supabaseAdmin.from('task_assignees').select('task_id').eq('user_id', user.id)
  );

  const relationalTaskIds = (taRows || []).map((r) => r.task_id).filter(isValidUUID);

  // 2. Primary tasks assigned to user (tasks.assignee_id = user.id)
  // NOTE: tasks table has NO entity_id and NO co_assignees column!
  const primaryTasks = await fetchInPages(() =>
    supabaseAdmin
      .from('tasks')
      .select('id, work_request_id')
      .eq('assignee_id', user.id)
      .is('deleted_at', null)
  );

  // Relational tasks lookup (bounded in chunks, paginated)
  const relTasks = [];
  const CHUNK_SIZE = 100;
  for (let i = 0; i < relationalTaskIds.length; i += CHUNK_SIZE) {
    const chunk = relationalTaskIds.slice(i, i + CHUNK_SIZE);
    const chunkTasks = await fetchInPages(() =>
      supabaseAdmin
        .from('tasks')
        .select('id, work_request_id')
        .in('id', chunk)
        .is('deleted_at', null)
    );
    if (chunkTasks) relTasks.push(...chunkTasks);
  }

  const taskWrIds = [...(primaryTasks || []), ...relTasks]
    .map((t) => t.work_request_id)
    .filter(isValidUUID);

  // 3. Work requests where user is assigned_to (lead) or in co_assignees
  const workRequests = await fetchInPages(() => {
    let q = supabaseAdmin
      .from('work_requests')
      .select('id, assigned_to, co_assignees, entity_id')
      .is('deleted_at', null);

    if (entityId && entityId !== 'ALL') {
      q = q.eq('entity_id', entityId);
    }
    return q;
  });

  const activeWrMap = new Map((workRequests || []).map((w) => [w.id, w]));

  const directWrIds = (workRequests || [])
    .filter((wr) => {
      if (wr.assigned_to === user.id) return true;
      if (Array.isArray(wr.co_assignees)) {
        return wr.co_assignees.some(
          (ca) =>
            typeof ca === 'string' &&
            isValidUUID(ca) &&
            ca.toLowerCase() === user.id.toLowerCase()
        );
      }
      return false;
    })
    .map((wr) => wr.id)
    .filter(isValidUUID);

  // Combine and verify all candidates belong to active WRs in activeWrMap
  const allCandidateIds = Array.from(new Set([...taskWrIds, ...directWrIds]));
  let authorizedWrIds = allCandidateIds.filter((id) => activeWrMap.has(id));

  // If entityId === 'ALL', intersect with user's allowed entities (for all users including Admin with restrictions)
  if (
    entityId === 'ALL' &&
    user.entities &&
    Array.isArray(user.entities) &&
    !user.entities.some((e) => String(e).toUpperCase() === 'ALL')
  ) {
    const entitiesData = await fetchInPages(() =>
      supabaseAdmin.from('entities').select('id, code')
    );

    const entityCodeMap = new Map((entitiesData || []).map((e) => [e.id, e.code.toUpperCase()]));
    const allowedCodes = user.entities.map((c) => String(c).toUpperCase());

    authorizedWrIds = authorizedWrIds.filter((id) => {
      const wr = activeWrMap.get(id);
      if (!wr || !wr.entity_id) return false;
      const code = entityCodeMap.get(wr.entity_id) || wr.entity_id;
      return allowedCodes.includes(String(code).toUpperCase());
    });
  }

  return authorizedWrIds;
};

/**
 * Check whether a user is an authorized member of a work request.
 * Enforces entity entitlement and active non-deleted WR verification for Admin too.
 */
const isUserMemberOfWorkRequest = async (workRequestId, user, options = {}) => {
  if (!user || !user.id || !workRequestId) return false;
  const entityId = options.entityId;

  // Verify the work request actually exists, is not deleted, and matches entity scope
  let wrQuery = supabaseAdmin
    .from('work_requests')
    .select('id, entity_id, deleted_at')
    .eq('id', workRequestId)
    .is('deleted_at', null);

  if (entityId && entityId !== 'ALL') {
    wrQuery = wrQuery.eq('entity_id', entityId);
  }

  const { data: wr, error: wrErr } = await wrQuery.maybeSingle();
  if (wrErr) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: `Failed to check work request: ${wrErr.message || String(wrErr)}`,
    });
  }
  if (!wr) return false;

  // Even Admin must have entity entitlement for the target WR
  const entitled = await isUserEntitledToEntity(wr.entity_id, user);
  if (!entitled) return false;

  if (user.role === 'Admin') return true;

  const concernedIds = await getUserConcernedWorkRequestIds(user, options);
  return concernedIds.includes(workRequestId);
};

/**
 * Get all client IDs associated with the user's authorized work requests.
 */
const getUserAuthorizedClientIds = async (user, entityId) => {
  if (!user || !user.id) return [];
  if (user.role === 'Admin') {
    const data = await fetchInPages(() => {
      let q = supabaseAdmin.from('clients').select('id, entity_id').is('deleted_at', null);
      if (entityId && entityId !== 'ALL') q = q.eq('entity_id', entityId);
      return q;
    });

    // Filter by Admin's entity entitlement
    const allowed = [];
    for (const c of data || []) {
      if (await isUserEntitledToEntity(c.entity_id, user)) {
        allowed.push(c.id);
      }
    }
    return allowed.filter(isValidUUID);
  }

  const wrIds = await getUserConcernedWorkRequestIds(user, { entityId });
  if (wrIds.length === 0) return [];

  // Bounded chunk query for clients
  const allowedClientIds = [];
  const CHUNK_SIZE = 100;
  for (let i = 0; i < wrIds.length; i += CHUNK_SIZE) {
    const chunk = wrIds.slice(i, i + CHUNK_SIZE);
    const wrs = await fetchInPages(() =>
      supabaseAdmin
        .from('work_requests')
        .select('client_id')
        .in('id', chunk)
        .is('deleted_at', null)
    );
    if (wrs) {
      for (const w of wrs) {
        if (w.client_id && isValidUUID(w.client_id)) {
          allowedClientIds.push(w.client_id);
        }
      }
    }
  }

  return Array.from(new Set(allowedClientIds));
};

module.exports = {
  isValidUUID,
  fetchInPages,
  isUserEntitledToEntity,
  getUserConcernedWorkRequestIds,
  isUserMemberOfWorkRequest,
  getUserAuthorizedClientIds,
};
