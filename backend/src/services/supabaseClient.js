/**
 * Supabase service client.
 * Exports the admin client and helper to verify JWTs.
 */

const { supabaseAdmin } = require('../config/supabase');

/**
 * Verify a Supabase JWT and return the user.
 * @param {string} token
 * @returns {Promise<{data: {user: object}|null, error: Error|null}>}
 */
const verifyToken = async (token) => {
  return supabaseAdmin.auth.getUser(token);
};

module.exports = { supabaseAdmin, verifyToken };
