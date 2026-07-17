/**
 * Audit logging service.
 * Appends immutable records to the audit_logs table.
 */

const { supabaseAdmin } = require('../services/supabaseClient');
const AppError = require('../lib/AppError');

/**
 * Log an audit event.
 * @param {Object} params
 * @param {string} params.action
 * @param {string} [params.table]
 * @param {string} [params.recordId]
 * @param {string} [params.entity]
 * @param {string} [params.userId]
 * @param {object} [params.details]
 */
const log = async (params) => {
  const { action, table, recordId, entity, userId, details = {} } = params;

  const { error } = await supabaseAdmin.from('audit_logs').insert({
    action,
    table_name: table || null,
    record_id: recordId || null,
    entity: entity || null,
    user_id: userId || null,
    details,
  });

  if (error) {
    // Audit failures must not break user requests, but they are critical.
    // eslint-disable-next-line no-console
    console.error('[AUDIT] Failed to write audit log:', error);
  }
};

/**
 * Assert that audit logging succeeded for a given record.
 * Used by tests and sensitive flows.
 * @param {Object} params
 * @throws {AppError}
 */
const logOrFail = async (params) => {
  const { action, table, recordId, entity, userId, details = {} } = params;

  const { error } = await supabaseAdmin.from('audit_logs').insert({
    action,
    table_name: table || null,
    record_id: recordId || null,
    entity: entity || null,
    user_id: userId || null,
    details,
  });

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Audit Log Failure',
      detail: 'Unable to record audit event',
    });
  }
};

module.exports = { log, logOrFail };
