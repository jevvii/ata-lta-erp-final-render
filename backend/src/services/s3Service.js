/**
 * S3 signed URL service.
 * Generic helpers for document upload/download.
 *
 * Document-specific key generation lives in the documents module.
 */

const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getSignedUrl: getCloudfrontSignedUrl } = require('@aws-sdk/cloudfront-signer');
const { s3Client } = require('../config/aws');
const env = require('../config/env');

/**
 * Generate a pre-signed upload URL.
 * @param {Object} params
 * @param {string} params.key
 * @param {string} params.contentType
 * @param {number} [params.expiresInSeconds=300]
 * @returns {Promise<string>}
 */
const getSignedUploadUrl = async ({ key, contentType, expiresInSeconds = 300 }) => {
  const command = new PutObjectCommand({
    Bucket: env.s3.documentBucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
};

/**
 * Generate a CloudFront or S3 pre-signed download URL.
 * Prefers CloudFront signed URLs when key + domain are configured; otherwise
 * falls back to an S3 GET signed URL.
 *
 * @param {Object} params
 * @param {string} params.key
 * @param {number} [params.expiresInSeconds=300]
 * @returns {Promise<string>}
 */
const getSignedDownloadUrl = async ({ key, expiresInSeconds = 300 }) => {
  if (env.cloudfront.documentDomain && env.cloudfront.keyId && env.cloudfront.privateKey) {
    const url = `${env.cloudfront.documentDomain.replace(/\/$/, '')}/${key}`;
    return getCloudfrontSignedUrl({
      url,
      keyPairId: env.cloudfront.keyId,
      privateKey: env.cloudfront.privateKey,
      dateLessThan: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    });
  }

  const command = new GetObjectCommand({
    Bucket: env.s3.documentBucket,
    Key: key,
  });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
};

/**
 * Delete an object from S3.
 * @param {string} key
 * @returns {Promise<void>}
 */
const deleteObject = async (key) => {
  const command = new DeleteObjectCommand({
    Bucket: env.s3.documentBucket,
    Key: key,
  });
  await s3Client.send(command);
};

module.exports = {
  getSignedUploadUrl,
  getSignedDownloadUrl,
  deleteObject,
};
