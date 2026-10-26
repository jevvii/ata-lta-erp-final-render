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

const ALLOWED_RECEIPT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const MAX_RECEIPT_SIZE_BYTES = 10 * 1024 * 1024; // 10,485,760 bytes (10 MiB)

/**
 * Detect MIME type from raw magic byte signatures.
 * - PDF: %PDF- (0x25, 0x50, 0x44, 0x46, 0x2D)
 * - PNG: 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
 * - JPEG: 0xFF, 0xD8, 0xFF
 *
 * @param {Buffer} buffer
 * @returns {string|null} Detected MIME type or null
 */
const detectMimeTypeFromBuffer = (buffer) => {
  if (!buffer || buffer.length < 3) return null;

  // JPEG: 0xFF, 0xD8, 0xFF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PDF: %PDF- (0x25, 0x50, 0x44, 0x46, 0x2D)
  if (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    return 'application/pdf';
  }

  // PNG: 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  return null;
};

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
 * @param {string} [params.bucket] - Optional target bucket
 * @param {string} params.path - Storage path (e.g. entities/ATA/...)
 * @param {string} [params.contentType] - Optional content type
 * @param {number} [params.expiresInSeconds=300]
 * @returns {Promise<string>}
 */
const getSignedUploadUrl = async ({
  bucket: targetBucket,
  path,
  contentType: _contentType,
  expiresInSeconds: _expiresInSeconds = 300,
}) => {
  const activeBucket = targetBucket || env.storage.bucket;
  if (!activeBucket) {
    throw new AppError({
      statusCode: 500,
      title: 'Configuration Error',
      detail: 'Storage bucket is not configured',
    });
  }
  const { data, error } = await supabaseAdmin.storage.from(activeBucket).createSignedUploadUrl(path);

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

/**
 * Verify whether an object exists in private Supabase Storage.
 * @param {Object} params
 * @param {string} params.path - Storage path
 * @param {string} [params.bucket] - Optional bucket override
 * @returns {Promise<boolean>}
 */
const verifyObjectExists = async ({ path, bucket: targetBucket }) => {
  const activeBucket = targetBucket || env.storage.bucket;
  if (!activeBucket) return false;
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(activeBucket)
      .download(path);
    if (error || !data) return false;
    return true;
  } catch (_e) {
    return false;
  }
};

/**
 * Download and thoroughly inspect an uploaded receipt object.
 * Validates:
 * 1. Object existence and accessibility in storage
 * 2. Byte size <= 10 MiB (10,485,760 bytes)
 * 3. Byte size matches reservation size
 * 4. Content-Type is allowed and matches reservation
 * 5. Magic bytes header matches expected MIME type
 *
 * @param {Object} params
 * @param {string} params.path - Object storage path
 * @param {number} params.expectedSize - Reserved file size in bytes
 * @param {string} params.expectedContentType - Reserved MIME type
 * @param {string} [params.bucket] - Optional bucket override
 * @returns {Promise<{ valid: boolean, error?: string, code?: string, buffer?: Buffer, size?: number, mimeType?: string }>}
 */
const verifyReceiptObject = async ({
  path,
  expectedSize,
  expectedContentType,
  bucket: targetBucket,
}) => {
  const activeBucket = targetBucket || env.storage.bucket;
  if (!activeBucket) {
    return {
      valid: false,
      code: 'RECEIPT_UPLOAD_VERIFICATION_FAILED',
      error: 'Storage bucket is not configured.',
    };
  }

  let data;
  try {
    const res = await supabaseAdmin.storage.from(activeBucket).download(path);
    if (res.error || !res.data) {
      return {
        valid: false,
        code: 'RECEIPT_UPLOAD_VERIFICATION_FAILED',
        error: 'Receipt binary was not found in storage. Upload failed or was interrupted.',
      };
    }
    data = res.data;
  } catch (err) {
    return {
      valid: false,
      code: 'RECEIPT_UPLOAD_VERIFICATION_FAILED',
      error: `Failed to download receipt from storage: ${err.message}`,
    };
  }

  // Extract raw Buffer
  let buffer;
  if (Buffer.isBuffer(data)) {
    buffer = data;
  } else if (data && typeof data.arrayBuffer === 'function') {
    buffer = Buffer.from(await data.arrayBuffer());
  } else if (data && Buffer.isBuffer(data.buffer)) {
    buffer = data.buffer;
  } else {
    return {
      valid: false,
      code: 'RECEIPT_UPLOAD_VERIFICATION_FAILED',
      error: 'Receipt binary format is invalid or unreadable.',
    };
  }

  const byteLength = buffer.length;

  // 1. Non-empty check
  if (byteLength === 0) {
    return {
      valid: false,
      code: 'RECEIPT_UPLOAD_VERIFICATION_FAILED',
      error: 'Receipt binary is empty (0 bytes).',
    };
  }

  // 2. Maximum ceiling: 10 MiB (10,485,760 bytes)
  if (byteLength > MAX_RECEIPT_SIZE_BYTES) {
    return {
      valid: false,
      code: 'RECEIPT_UPLOAD_VERIFICATION_FAILED',
      error: `Receipt binary exceeds maximum size limit of 10 MiB (${byteLength} bytes).`,
    };
  }

  // 3. Size match with reservation
  if (expectedSize !== undefined && expectedSize !== null && byteLength !== expectedSize) {
    return {
      valid: false,
      code: 'RECEIPT_UPLOAD_VERIFICATION_FAILED',
      error: `Receipt binary size (${byteLength} bytes) does not match reserved size (${expectedSize} bytes).`,
    };
  }

  // 4. Allowed MIME type check
  if (expectedContentType && !ALLOWED_RECEIPT_MIME_TYPES.includes(expectedContentType)) {
    return {
      valid: false,
      code: 'RECEIPT_UPLOAD_VERIFICATION_FAILED',
      error: `Requested content type '${expectedContentType}' is not in allowed types: ${ALLOWED_RECEIPT_MIME_TYPES.join(', ')}.`,
    };
  }

  // 5. Check metadata content-type if provided by storage
  const storageContentType = data.contentType || data.type;
  if (storageContentType && expectedContentType && storageContentType !== expectedContentType) {
    return {
      valid: false,
      code: 'RECEIPT_UPLOAD_VERIFICATION_FAILED',
      error: `Uploaded object content type '${storageContentType}' does not match reservation '${expectedContentType}'.`,
    };
  }

  // 6. Magic bytes header inspection
  const detectedMime = detectMimeTypeFromBuffer(buffer);
  if (!detectedMime) {
    return {
      valid: false,
      code: 'RECEIPT_UPLOAD_VERIFICATION_FAILED',
      error: 'Receipt binary magic bytes header does not match any allowed MIME type (PDF, PNG, JPEG).',
    };
  }

  if (expectedContentType && detectedMime !== expectedContentType) {
    return {
      valid: false,
      code: 'RECEIPT_UPLOAD_VERIFICATION_FAILED',
      error: `Receipt binary magic bytes header detected as '${detectedMime}', which mismatches expected reservation '${expectedContentType}'.`,
    };
  }

  return {
    valid: true,
    buffer,
    size: byteLength,
    mimeType: detectedMime,
  };
};

module.exports = {
  getSignedUploadUrl,
  getSignedDownloadUrl,
  deleteObject,
  uploadBuffer,
  verifyObjectExists,
  verifyReceiptObject,
  detectMimeTypeFromBuffer,
  ALLOWED_RECEIPT_MIME_TYPES,
  MAX_RECEIPT_SIZE_BYTES,
};
