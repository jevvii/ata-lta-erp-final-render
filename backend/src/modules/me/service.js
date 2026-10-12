/**
 * Current user service.
 * Profile updates, password changes, and avatar upload URLs.
 */

const { supabaseAdmin } = require('../../services/supabaseClient');
const env = require('../../config/env');
const AppError = require('../../lib/AppError');
const storageService = require('../../services/storageService');
const { evictUserProfile } = require('../../middleware/auth');

const MAX_AVATAR_SIZE_MB = 5;

const toApiUser = (row, departments = []) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  departments,
  entities: row.entities || [],
  isActive: row.is_active,
  avatarUrl: row.avatar_url || null,
  preferences: row.preferences || {},
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const loadUserDepartments = async (userId) => {
  const { data: udRows, error } = await supabaseAdmin
    .from('user_departments')
    .select('department_id')
    .eq('user_id', userId);

  if (error) return [];

  const deptIds = (udRows || []).map((row) => row.department_id).filter(Boolean);
  if (!deptIds.length) return [];

  const { data: deptRows } = await supabaseAdmin
    .from('departments')
    .select('id, name')
    .in('id', deptIds);

  const nameById = new Map((deptRows || []).map((d) => [d.id, d.name]));
  return deptIds.map((id) => nameById.get(id)).filter(Boolean);
};

const getProfile = async (userId) => {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to load profile',
    });
  }
  if (!data) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'User profile not found' });
  }
  const departments = await loadUserDepartments(userId);
  return toApiUser(data, departments);
};

const updateProfile = async ({ userId, data }) => {
  const existing = await getProfile(userId);

  const updates = {
    name: data.name ?? existing.name,
    preferences: {
      ...(existing.preferences || {}),
      ...(data.preferences || {}),
    },
    updated_at: new Date().toISOString(),
  };

  if (data.avatarUrl !== undefined) {
    updates.avatar_url = data.avatarUrl || null;
  }

  const { error } = await supabaseAdmin.from('users').update(updates).eq('id', userId);
  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to update profile',
    });
  }

  evictUserProfile(userId);

  return getProfile(userId);
};

const changePassword = async ({ userId, authUserId, email, currentPassword, newPassword }) => {
  if (!currentPassword || !newPassword) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Current password and new password are required',
    });
  }

  if (newPassword.length < 8) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'New password must be at least 8 characters',
    });
  }

  // Resolve user email if not directly provided
  let userEmail = email;
  if (!userEmail) {
    const { data: userRecord } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('id', userId)
      .maybeSingle();
    userEmail = userRecord?.email;
  }

  if (!userEmail) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Unable to verify user account',
    });
  }

  // Verify current password via Supabase Auth sign-in
  const { data: signInData, error: verifyError } = await supabaseAdmin.auth.signInWithPassword({
    email: userEmail,
    password: currentPassword,
  });

  if (verifyError || !signInData?.user) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Current password is incorrect',
    });
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
    password: newPassword,
  });

  if (updateError) {
    throw new AppError({
      statusCode: 500,
      title: 'Auth Error',
      detail: updateError.message || 'Unable to change password',
    });
  }

  const { error: profileError } = await supabaseAdmin
    .from('users')
    .update({ password_updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (profileError) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Password changed but unable to update profile timestamp',
    });
  }
};

const getAvatarUploadUrl = async ({ userId, contentType = 'image/png' }) => {
  const avatarBucket = env.storage.avatarBucket || 'avatars';
  const extMap = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
  };
  const normalizedType = typeof contentType === 'string' ? contentType.toLowerCase() : 'image/png';
  const ext = extMap[normalizedType] || 'png';
  const path = `${userId}/${Date.now()}.${ext}`;

  const signedUrl = await storageService.getSignedUploadUrl({
    bucket: avatarBucket,
    path,
    contentType,
    expiresInSeconds: 300,
  });

  const publicUrl = `${env.supabase.url}/storage/v1/object/public/${avatarBucket}/${path}`;

  return {
    signedUrl,
    publicUrl,
    path,
    maxSizeMb: MAX_AVATAR_SIZE_MB,
  };
};

/**
 * List users visible to the requesting user for name/avatar resolution.
 * Admins see everyone; other users see users sharing at least one entity.
 * @param {Object} params
 * @param {object} params.currentUser
 * @returns {Promise<Array>}
 */
const listTeam = async ({ currentUser }) => {
  const { data, error } = await supabaseAdmin.from('users').select('*').eq('is_active', true);
  if (error) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to load team' });
  }

  const isAdmin = currentUser.role === 'Admin';
  const userEntities = (currentUser.entities || []).map((e) => e.toUpperCase());

  const rows = (data || []).filter((row) => {
    if (isAdmin) return true;
    const rowEntities = (row.entities || []).map((e) => e.toUpperCase());
    return rowEntities.some((e) => userEntities.includes(e));
  });

  const profiles = await Promise.all(
    rows.map(async (row) => {
      const departments = await loadUserDepartments(row.id);
      return toApiUser(row, departments);
    })
  );

  return profiles;
};

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  getAvatarUploadUrl,
  listTeam,
  toApiUser,
};
