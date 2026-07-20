/**
 * Supabase Storage service.
 * Provides signed upload/download URLs and object deletion
 * for documents and generated PDFs.
 *
 * Replaces the previous AWS S3 + CloudFront flow.
 */

const { supabaseAdmin } = require('./supabaseClient');
const env = require('../config/env');
const AppError = require('../lib/AppError');

const bucket = env.storage.bucket;

const assertBucket = () => {
  if (!bucket) {
    throw new AppError({
      statusCode: 500,
      title: 'Configuration Error',
      detail: 'SUPABASE_STORAGE_BUCKET is not configured',
    });
  }
};

/**
 * Generate a pre-signed upload URL for the browser.
 * @param {Object} params
 * @param {string} params.path - Storage path (e.g. entities/ATA/...)
 * @param {string} [params.contentType] - Optional content type
 * @param {number} [params.expiresInSeconds=300]
 * @returns {Promise<string>}
 */
const getSignedUploadUrl = async ({
  path,
  contentType: _contentType,
  expiresInSeconds: _expiresInSeconds = 300,
}) => {
  assertBucket();
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(path);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Storage Error',
      detail: `Failed to create signed upload URL: ${error.message}`,
    });
  }

  return data.signedUrl;
};

/**
 * Generate a pre-signed download URL.
 * @param {Object} params
 * @param {string} params.path - Storage path
 * @param {number} [params.expiresInSeconds=300]
 * @returns {Promise<string>}
 */
const getSignedDownloadUrl = async ({ path, expiresInSeconds = 300 }) => {
  assertBucket();
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Storage Error',
      detail: `Failed to create signed download URL: ${error.message}`,
    });
  }

  return data.signedUrl;
};

/**
 * Delete an object from Supabase Storage.
 * @param {string} path
 * @returns {Promise<void>}
 */
const deleteObject = async (path) => {
  assertBucket();
  const { error } = await supabaseAdmin.storage.from(bucket).remove([path]);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Storage Error',
      detail: `Failed to delete storage object: ${error.message}`,
    });
  }
};

/**
 * Server-side upload of a buffer (used for generated PDFs).
 * @param {Object} params
 * @param {string} params.path - Storage path
 * @param {Buffer} params.buffer - File bytes
 * @param {string} params.contentType
 * @returns {Promise<string>} Public/signed download URL
 */
const uploadBuffer = async ({ path, buffer, contentType }) => {
  assertBucket();
  const { error: uploadError } = await supabaseAdmin.storage.from(bucket).upload(path, buffer, {
    contentType,
    upsert: true,
  });

  if (uploadError) {
    throw new AppError({
      statusCode: 500,
      title: 'Storage Error',
      detail: `Failed to upload buffer: ${uploadError.message}`,
    });
  }

  return getSignedDownloadUrl({ path, expiresInSeconds: 300 });
};

module.exports = {
  getSignedUploadUrl,
  getSignedDownloadUrl,
  deleteObject,
  uploadBuffer,
};
