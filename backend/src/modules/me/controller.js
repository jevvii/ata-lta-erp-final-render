/**
 * Current user controller.
 * Returns the authenticated user's profile and effective permissions.
 */

const { computePermissions } = require('../../middleware/rbac');
const meService = require('./service');
const AppError = require('../../lib/AppError');

/**
 * GET /v1/me
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getMe = async (req, res, next) => {
  try {
    const permissions = Array.from(computePermissions(req.user));
    const profile = await meService.getProfile(req.user.id);

    res.status(200).json({
      data: {
        ...profile,
        activeEntity: req.activeEntity,
        permissions,
      },
    });
  } catch (err) {
    next(err);
  }
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

/**
 * PATCH /v1/me
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const updateMe = async (req, res, next) => {
  try {
    const allowed = ['name', 'avatarUrl', 'preferences'];
    const payload = {};
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) payload[key] = req.body[key];
    });

    if (Object.keys(payload).length === 0) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'No updatable fields provided',
      });
    }

    const profile = await meService.updateProfile({ userId: req.user.id, data: payload });
    const permissions = Array.from(computePermissions(req.user));

    res.status(200).json({
      data: {
        ...profile,
        activeEntity: req.activeEntity,
        permissions,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /v1/me/password
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    await meService.changePassword({
      userId: req.user.id,
      authUserId: req.user.authUserId,
      currentPassword,
      newPassword,
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

/**
 * POST /v1/me/avatar-upload-url
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getAvatarUploadUrl = async (req, res, next) => {
  try {
    const result = await meService.getAvatarUploadUrl({ userId: req.user.id });
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /v1/me/team
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getTeam = async (req, res, next) => {
  try {
    const team = await meService.listTeam({ currentUser: req.user });
    res.status(200).json({ data: team });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  meController: { getMe, getPermissions, updateMe, changePassword, getAvatarUploadUrl, getTeam },
};
