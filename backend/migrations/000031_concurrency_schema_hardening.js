/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  // 0.1 — Add version columns to every mutable table (idempotent)
  const versionableTables = [
    'clients',
    'invoices',
    'invoice_line_items',
    'disbursements',
    'transmittals',
    'transmittal_items',
    'work_requests',
    'tasks',
    'operations_requests',
    'pending_changes',
    'documents',
  ];
  versionableTables.forEach((table) => {
    pgm.sql(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1`);
  });

  // 0.2 — Normalize archive metadata on tables that already use deleted_at + status
  pgm.sql(`
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived_at timestamptz;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS archived_at timestamptz;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE disbursements ADD COLUMN IF NOT EXISTS archived_at timestamptz;
    ALTER TABLE disbursements ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE work_requests ADD COLUMN IF NOT EXISTS archived_at timestamptz;
    ALTER TABLE work_requests ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS archived_at timestamptz;
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES users(id) ON DELETE SET NULL;
  `);

  // 0.3 — CHECK constraints for status columns (idempotent)
  pgm.sql(`
    ALTER TABLE disbursements
      DROP CONSTRAINT IF EXISTS chk_disbursements_status,
      ADD CONSTRAINT chk_disbursements_status
      CHECK (status IN ('Draft', 'Pending', 'Approved', 'Released', 'Funded', 'Rejected', 'Cancelled'));

    ALTER TABLE work_requests
      DROP CONSTRAINT IF EXISTS chk_work_requests_status,
      ADD CONSTRAINT chk_work_requests_status
      CHECK (status IN ('Draft', 'In Progress', 'On Hold', 'Completed', 'Cancelled'));

    ALTER TABLE tasks
      DROP CONSTRAINT IF EXISTS chk_tasks_status,
      ADD CONSTRAINT chk_tasks_status
      CHECK (status IN ('Draft', 'In Progress', 'Completed', 'Cancelled'));

    ALTER TABLE operations_requests
      DROP CONSTRAINT IF EXISTS chk_operations_requests_status,
      ADD CONSTRAINT chk_operations_requests_status
      CHECK (status IN ('pending', 'fulfilled', 'rejected', 'cancelled'));
  `);

  // 0.3b — Lifecycle CHECK: normalize existing bad values first, then enforce.
  // The app currently only uses 'collected', 'active', and 'inactive'. Any other
  // value is treated as 'active' for compatibility with older rows.
  pgm.sql(`
    UPDATE documents
    SET document_lifecycle = 'active'
    WHERE document_lifecycle IS NOT NULL
      AND document_lifecycle NOT IN ('collected', 'active', 'inactive', 'transmitted');

    ALTER TABLE documents
      DROP CONSTRAINT IF EXISTS chk_documents_lifecycle,
      ADD CONSTRAINT chk_documents_lifecycle
      CHECK (document_lifecycle IN ('collected', 'active', 'inactive', 'transmitted'));
  `);

  // 0.4 — Missing UNIQUE constraints (idempotent)
  pgm.sql(`
    ALTER TABLE disbursements
      DROP CONSTRAINT IF EXISTS disbursements_entity_id_disbursement_number_key,
      ADD CONSTRAINT disbursements_entity_id_disbursement_number_key
      UNIQUE (entity_id, disbursement_number);
  `);

  // 0.5 — Partial unique indexes for active duplicates (idempotent)
  pgm.sql(`
    DROP INDEX IF EXISTS idx_pending_changes_active_unique;
    CREATE UNIQUE INDEX idx_pending_changes_active_unique
    ON pending_changes (entity_id, table_name, parent_record_id, submitted_by)
    WHERE status = 'pending';
  `);
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_pending_changes_active_unique;
    ALTER TABLE disbursements DROP CONSTRAINT IF EXISTS disbursements_entity_id_disbursement_number_key;
    ALTER TABLE documents DROP CONSTRAINT IF EXISTS chk_documents_lifecycle;
    ALTER TABLE operations_requests DROP CONSTRAINT IF EXISTS chk_operations_requests_status;
    ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_status;
    ALTER TABLE work_requests DROP CONSTRAINT IF EXISTS chk_work_requests_status;
    ALTER TABLE disbursements DROP CONSTRAINT IF EXISTS chk_disbursements_status;
  `);

  pgm.sql(`
    ALTER TABLE documents DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS archived_by;
    ALTER TABLE work_requests DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS archived_by;
    ALTER TABLE disbursements DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS archived_by;
    ALTER TABLE invoices DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS archived_by;
    ALTER TABLE clients DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS archived_by;
  `);

  const versionableTables = [
    'clients',
    'invoices',
    'invoice_line_items',
    'disbursements',
    'transmittals',
    'transmittal_items',
    'work_requests',
    'tasks',
    'operations_requests',
    'pending_changes',
    'documents',
  ];
  versionableTables.forEach((table) => {
    pgm.sql(`ALTER TABLE ${table} DROP COLUMN IF EXISTS version`);
  });
};
