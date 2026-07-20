/**
 * Authentication middleware.
 * Verifies the Supabase JWT and loads the internal user profile.
 *
 * Performance: user profiles are cached in memory (5-min TTL, 500-entry cap)
 * to avoid repeated DB queries on every authenticated request.
 */

const { supabaseAdmin } = require('../services/supabaseClient');
const AppError = require('../lib/AppError');
const logger = require('../lib/logger');

/* ── In-memory profile cache ────────────────────────────────────────── */
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PROFILE_CACHE_MAX = 500;
const profileCache = new Map(); // authUserId → { profile, expiresAt }

/**
 * Evict expired entries and enforce the size cap.
 */
const pruneCache = () => {
  const now = Date.now();
  for (const [key, entry] of profileCache) {
    if (now >= entry.expiresAt) profileCache.delete(key);
  }
  // If still over cap, remove oldest entries
  if (profileCache.size > PROFILE_CACHE_MAX) {
    const excess = profileCache.size - PROFILE_CACHE_MAX;
    const keys = profileCache.keys();
    for (let i = 0; i < excess; i++) {
      profileCache.delete(keys.next().value);
    }
  }
};

/**
 * Load a user profile plus department names from PostgreSQL.
 * Uses a single combined query with nested select to reduce round-trips.
 * @param {string} authUserId
 * @returns {Promise<object|null>}
 */
const loadUserProfile = async (authUserId) => {
  // Check cache first
  const cached = profileCache.get(authUserId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.profile;
  }

  // Combined query: users + departments in one round-trip
  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select(
      'id, auth_user_id, email, name, role, entities, is_active, user_departments(departments(name))'
    )
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (userError || !user) return null;

  const departments = (user.user_departments || [])
    .map((row) => row.departments?.name)
    .filter(Boolean);

  const profile = {
    id: user.id,
    authUserId: user.auth_user_id,
    email: user.email,
    name: user.name,
    role: user.role,
    entities: user.entities || [],
    departments,
    isActive: user.is_active,
  };

  // Store in cache
  pruneCache();
  profileCache.set(authUserId, {
    profile,
    expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
  });

  return profile;
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
      logger.warn('token verification failed', {
        error: error?.message,
        statusCode: error?.status,
      });
      throw new AppError({
        statusCode: 401,
        title: 'Unauthorized',
        detail: error?.message || 'Invalid token',
      });
    }

    const profile = await loadUserProfile(data.user.id);
    if (!profile) {
      logger.warn('no matching ERP profile for authenticated user', { authUserId: data.user.id });
    }

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

/**
 * Clear the in-memory profile cache. Used by test fixtures to prevent
 * stale cached profiles from leaking between test cases.
 */
const clearProfileCache = () => profileCache.clear();

module.exports = { auth, clearProfileCache };
