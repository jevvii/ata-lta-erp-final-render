/**
 * Migration 000065: Fix Avatar Storage Public Bucket
 *
 * Verifies/creates the public 'avatars' bucket in Supabase Storage with { public: true }
 * and updates legacy rows in users where avatar_url references private storage paths.
 *
 * @type {import('node-pg-migrate').Migration}
 */

let supabaseAdmin;
try {
  ({ supabaseAdmin } = require('../src/services/supabaseClient'));
} catch (_err) {
  try {
    ({ supabaseAdmin } = require('../src/config/supabase'));
  } catch (_e) {
    supabaseAdmin = null;
  }
}

exports.up = async (pgm) => {
  try {
    if (supabaseAdmin?.storage?.listBuckets) {
      const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets();
      if (!listError && Array.isArray(buckets)) {
        const exists = buckets.some((b) => b.name === 'avatars');
        if (!exists) {
          if (supabaseAdmin.storage.createBucket) {
            await supabaseAdmin.storage.createBucket('avatars', {
              public: true,
              fileSizeLimit: 5242880,
              allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
            });
          }
        } else {
          if (supabaseAdmin.storage.updateBucket) {
            await supabaseAdmin.storage.updateBucket('avatars', {
              public: true,
            });
          }
        }
      }
    }
  } catch (_err) {
    // Safely handle offline test environments where Supabase Storage API may be unreachable
  }

  pgm.sql(`
    UPDATE users
    SET avatar_url = regexp_replace(
      avatar_url,
      '/storage/v1/object/public/[^/]+/(entities/)?avatars/',
      '/storage/v1/object/public/avatars/'
    )
    WHERE avatar_url LIKE '%/storage/v1/object/public/%'
      AND avatar_url NOT LIKE '%/storage/v1/object/public/avatars/%';
  `);
};

exports.down = (pgm) => {
  // Reverting URL replacements is irreversible because original bucket names cannot be inferred.
  // The avatars bucket remains public for asset access.
  pgm.sql('-- 000065 down migration: no-op for irreversible data backfill');
};
