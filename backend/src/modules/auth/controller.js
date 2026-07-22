/**
 * Public authentication controller.
 * Proxies Supabase Auth sign-in for the SPA so the browser never sees the service key.
 */

const { supabaseAdmin } = require('../../services/supabaseClient');
const AppError = require('../../lib/AppError');
const logger = require('../../lib/logger');

/**
 * POST /v1/auth/signin
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const signIn = async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Email and password are required',
      });
    }

    const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });

    if (error || !data?.session) {
      logger.warn('signin failed', { email, error: error?.message, statusCode: error?.status });
      throw new AppError({
        statusCode: 401,
        title: 'Unauthorized',
        detail: error?.message || 'Invalid credentials',
      });
    }

    res.status(200).json({
      data: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /v1/auth/refresh
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Refresh token is required',
      });
    }

    const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token: refreshToken });

    if (error || !data?.session) {
      logger.warn('refresh failed', { error: error?.message, statusCode: error?.status });
      throw new AppError({
        statusCode: 401,
        title: 'Unauthorized',
        detail: error?.message || 'Invalid or expired refresh token',
      });
    }

    res.status(200).json({
      data: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { authController: { signIn, refresh } };
