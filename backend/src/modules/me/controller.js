/**
 * Current user controller.
 * Returns the authenticated user's profile and effective permissions.
 */

const { computePermissions } = require('../../middleware/rbac');

/**
 * GET /v1/me
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getMe = async (req, res) => {
  const permissions = Array.from(computePermissions(req.user));

  res.status(200).json({
    data: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      departments: req.user.departments,
      entities: req.user.entities,
      activeEntity: req.activeEntity,
      permissions,
    },
  });
};

/**
 * GET /v1/me/permissions
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getPermissions = async (req, res) => {
  const permissions = Array.from(computePermissions(req.user));
  res.status(200).json({ data: permissions });
};

module.exports = { meController: { getMe, getPermissions } };
