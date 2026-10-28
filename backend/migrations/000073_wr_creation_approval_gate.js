/**
 * Migration 000073: Work Request Creation Approval Gate
 *
 * Adds creation admission gating columns to work_requests per CONTRACT.md (Policy R1, R2).
 * Existing records are grandfathered as 'approved' by default.
 *
 * @type {import('node-pg-migrate').Migration}
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE work_requests
      ADD COLUMN IF NOT EXISTS creation_approval_status varchar(30) NOT NULL DEFAULT 'approved',
      ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
      ADD COLUMN IF NOT EXISTS rejection_reason text;

    ALTER TABLE work_requests
      DROP CONSTRAINT IF EXISTS chk_work_requests_creation_approval_status,
      ADD CONSTRAINT chk_work_requests_creation_approval_status
      CHECK (creation_approval_status IN ('approved', 'pending', 'rejected'));

    CREATE INDEX IF NOT EXISTS idx_work_requests_creation_approval_status
      ON work_requests (entity_id, creation_approval_status)
      WHERE deleted_at IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_work_requests_creation_approval_status;
    ALTER TABLE work_requests
      DROP CONSTRAINT IF EXISTS chk_work_requests_creation_approval_status,
      DROP COLUMN IF EXISTS creation_approval_status,
      DROP COLUMN IF EXISTS created_by,
      DROP COLUMN IF EXISTS reviewed_by,
      DROP COLUMN IF EXISTS reviewed_at,
      DROP COLUMN IF EXISTS rejection_reason;
  `);
};
