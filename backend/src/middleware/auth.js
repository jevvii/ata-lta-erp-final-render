/**
 * Authentication middleware.
 * Verifies the Supabase JWT and loads the internal user profile.
 */

const { supabaseAdmin } = require('../services/supabaseClient');
const AppError = require('../lib/AppError');

/**
 * Load a user profile plus department names from PostgreSQL.
 * @param {string} authUserId
 * @returns {Promise<object|null>}
 */
const loadUserProfile = async (authUserId) => {
  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, auth_user_id, email, name, role, entities, is_active')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (userError || !user) return null;

  const { data: deptRows, error: deptError } = await supabaseAdmin
    .from('user_departments')
    .select('departments(name)')
    .eq('user_id', user.id);

  if (deptError) return null;

  const departments = (deptRows || [])
    .map((row) => row.departments?.name)
    .filter(Boolean);

  return {
    id: user.id,
    authUserId: user.auth_user_id,
    email: user.email,
    name: user.name,
    role: user.role,
    entities: user.entities || [],
    departments,
    isActive: user.is_active,
  };
};

const auth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      throw new AppError({
        statusCode: 401,
        title: 'Unauthorized',
        detail: 'Missing or invalid Authorization header',
      });
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data?.user) {
      throw new AppError({
        statusCode: 401,
        title: 'Unauthorized',
        detail: error?.message || 'Invalid token',
      });
    }

    const profile = await loadUserProfile(data.user.id);

    if (!profile) {
      throw new AppError({
        statusCode: 401,
        title: 'Unauthorized',
        detail: 'No matching ERP user profile found',
      });
    }

    if (profile.isActive === false) {
      throw new AppError({
        statusCode: 403,
        title: 'Forbidden',
        detail: 'User account is disabled',
      });
    }

    req.user = profile;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { auth };
