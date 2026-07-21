/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  // Expand the work_requests status constraint to include every lifecycle status
  // used by the application. Existing out-of-range rows are normalized to 'Draft'
  // before the constraint is enforced.
  pgm.sql(`
    UPDATE work_requests
    SET status = 'Draft'
    WHERE status IS NOT NULL
      AND status NOT IN ('Draft', 'Pre-processing', 'In Progress', 'Processing', 'For Review', 'Billing', 'Disbursement', 'On Hold', 'Completed', 'Cancelled');

    ALTER TABLE work_requests
      DROP CONSTRAINT IF EXISTS chk_work_requests_status,
      ADD CONSTRAINT chk_work_requests_status
      CHECK (status IN ('Draft', 'Pre-processing', 'In Progress', 'Processing', 'For Review', 'Billing', 'Disbursement', 'On Hold', 'Completed', 'Cancelled'));
  `);
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE work_requests
      DROP CONSTRAINT IF EXISTS chk_work_requests_status;
  `);
};
