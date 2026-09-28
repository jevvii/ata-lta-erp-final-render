/**
 * User scoping / visibility utilities.
 */

const { supabaseAdmin } = require('../services/supabaseClient');

/**
 * Get all work request IDs that a user is concerned with (added to).
 * A user is added to a work request if:
 * 1. They are assigned to any task in that work request (assignee_id = user.id or assignee_name = user.name).
 * 2. They are the assigned_to of the work request.
 * 3. They are the requested_by of the work request.
 * @param {object} user
 * @returns {Promise<string[]>}
 */
const getUserConcernedWorkRequestIds = async (user) => {
  if (!user) return [];

  // Query 1: Get work_request_ids from tasks assigned to the user
  let taskWrIds = [];
  const { data: tasks, error: tasksError } = await supabaseAdmin
    .from('tasks')
    .select('work_request_id')
    .is('deleted_at', null)
    .or(`assignee_id.eq.${user.id},assignee_name.eq.${user.name || ''}`);

  if (!tasksError && tasks) {
    taskWrIds = tasks.map((t) => t.work_request_id).filter(Boolean);
  }

  // Query 2: Get work_request ids where user is requested_by, assigned_to, submitted_by, or in co_assignees
  let wrIds = [];
  const { data: workRequests, error: wrError } = await supabaseAdmin
    .from('work_requests')
    .select('id, requested_by, assigned_to, submitted_by, co_assignees')
    .is('deleted_at', null);

  if (!wrError && workRequests) {
    wrIds = workRequests
      .filter((wr) => {
        if (wr.requested_by === user.id || wr.assigned_to === user.id || wr.submitted_by === user.id) return true;
        if (Array.isArray(wr.co_assignees) && wr.co_assignees.some((ca) => ca === user.id || ca === user.name)) return true;
        return false;
      })
      .map((wr) => wr.id)
      .filter(Boolean);
  }

  // Combine and deduplicate
  const allIds = Array.from(new Set([...taskWrIds, ...wrIds]));
  return allIds;
};

module.exports = { getUserConcernedWorkRequestIds };
