/**
 * Entity resolution utility.
 * Converts entity code ('ATA'/'LTA') to the UUID stored in the entities table.
 * Agent A established this pattern; Agent B modules must follow it for FK consistency.
 */

const { supabaseAdmin } = require('../services/supabaseClient');
const AppError = require('./AppError');

// In-memory cache — entities are static, so we cache indefinitely.
const cache = new Map();

/**
 * Resolve an entity code to its UUID.
 * @param {string} code — 'ATA' or 'LTA'
 * @returns {Promise<string>} — UUID
 */
const resolveEntityId = async (code) => {
  if (cache.has(code)) return cache.get(code);

  const { data, error } = await supabaseAdmin
    .from('entities')
    .select('id')
    .eq('code', code)
    .maybeSingle();

  if (error || !data) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: `Unknown entity ${code}`,
    });
  }

  cache.set(code, data.id);
  return data.id;
};

module.exports = { resolveEntityId };
