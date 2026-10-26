/**
 * In-app notification dispatcher service.
 * Dispatches bulk notifications for the 4 frozen event types.
 *
 * Ensures DB errors never fail the triggering business operation.
 */

const { supabaseAdmin } = require('./supabaseClient');
const AppError = require('../lib/AppError');
const logger = require('../lib/logger');

const FROZEN_NOTIFICATION_TYPES = [
  'pending_request.resolved',
  'wr.transition_request.received',
  'wr.transition_request.resolved',
  'wr.qa_reroute',
  'disbursement.lifecycle',
];

/**
 * Dispatch an in-app notification to one or more users.
 *
 * @param {string[]|string} userIds Array of recipient user UUIDs
 * @param {string} type One of the 4 frozen notification types
 * @param {object} payload Notification payload
 * @returns {Promise<void>}
 */
const notify = async (userIds, type, payload) => {
  if (!FROZEN_NOTIFICATION_TYPES.includes(type)) {
    throw new AppError({
      statusCode: 400,
      title: 'Invalid Notification Type',
      detail: `Notification type '${type}' is invalid. Allowed types: ${FROZEN_NOTIFICATION_TYPES.join(', ')}`,
      code: 'INVALID_NOTIFICATION_TYPE',
    });
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppError({
      statusCode: 400,
      title: 'Invalid Notification Payload',
      detail: 'Notification payload must be a non-null object',
      code: 'INVALID_NOTIFICATION_PAYLOAD',
    });
  }

  const ids = Array.isArray(userIds) ? userIds : userIds ? [userIds] : [];
  const uniqueUserIds = Array.from(new Set(ids.filter(Boolean)));

  if (uniqueUserIds.length === 0) {
    return;
  }

  const rows = uniqueUserIds.map((userId) => ({
    user_id: userId,
    type,
    payload,
    read_at: null,
    created_at: new Date().toISOString(),
  }));

  try {
    const { error } = await supabaseAdmin.from('notifications').insert(rows);
    if (error) {
      logger.error('[NOTIFY] Failed to write notifications', {
        error: error.message || error,
        type,
        userIds: uniqueUserIds,
      });
    }
  } catch (err) {
    logger.error('[NOTIFY] Failed to write notifications', {
      error: err.message || err,
      type,
      userIds: uniqueUserIds,
    });
  }
};

module.exports = {
  notify,
  FROZEN_NOTIFICATION_TYPES,
};
