/**
 * RBAC middleware.
 * Builds the effective permission set for the authenticated user and
 * enforces required actions on routes.
 */

const { buildPermissionSet, hasPermission } = require('../lib/permissions');
const AppError = require('../lib/AppError');

/**
 * Compute the effective permission set from the user profile.
 * @param {object} user
 * @returns {Set<string>}
 */
const computePermissions = (user) => {
  return buildPermissionSet({ role: user.role || '', departments: user.departments || [] });
};

/**
 * Middleware factory that requires a permission.
 * @param {string} action
 * @returns {Function}
 */
const requirePermission = (actionOrActions) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        throw new AppError({
          statusCode: 401,
          title: 'Unauthorized',
          detail: 'Authentication required',
        });
      }

      const permissions = computePermissions(req.user);
      req.userPermissions = permissions;

      const actions = Array.isArray(actionOrActions) ? actionOrActions : [actionOrActions];
      const hasAny = actions.some((action) => hasPermission(permissions, action));

      if (!hasAny) {
        throw new AppError({
          statusCode: 403,
          title: 'Forbidden',
          detail: `One of permissions [${actions.join(', ')}] is required`,
        });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

module.exports = { requirePermission, computePermissions };
