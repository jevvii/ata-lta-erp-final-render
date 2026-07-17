/**
 * AWS SDK configuration.
 */

const { S3Client } = require('@aws-sdk/client-s3');
const env = require('./env');

const s3Client = new S3Client({
  region: env.aws.region,
  credentials: env.aws.accessKeyId && env.aws.secretAccessKey
    ? {
        accessKeyId: env.aws.accessKeyId,
        secretAccessKey: env.aws.secretAccessKey,
      }
    : undefined,
  endpoint: env.aws.endpoint || undefined,
  forcePathStyle: !!env.aws.endpoint,
});

module.exports = { s3Client };
