/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  // 0.1 — Add version columns to every mutable table
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
    pgm.addColumns(table, {
      version: { type: 'integer', notNull: true, default: 1 },
    });
  });

  // 0.2 — Normalize archive metadata on tables that already use deleted_at + status
  pgm.addColumns('clients', {
    archived_at: { type: 'timestamptz' },
    archived_by: { type: 'uuid', references: 'users', onDelete: 'set null' },
  });
  pgm.addColumns('invoices', {
    archived_at: { type: 'timestamptz' },
    archived_by: { type: 'uuid', references: 'users', onDelete: 'set null' },
  });
  pgm.addColumns('disbursements', {
    archived_at: { type: 'timestamptz' },
    archived_by: { type: 'uuid', references: 'users', onDelete: 'set null' },
  });
  pgm.addColumns('work_requests', {
    archived_at: { type: 'timestamptz' },
    archived_by: { type: 'uuid', references: 'users', onDelete: 'set null' },
  });
  pgm.addColumns('documents', {
    archived_at: { type: 'timestamptz' },
    archived_by: { type: 'uuid', references: 'users', onDelete: 'set null' },
  });

  // 0.3 — CHECK constraints for status columns
  pgm.sql(`
    ALTER TABLE disbursements
      ADD CONSTRAINT chk_disbursements_status
      CHECK (status IN ('Draft', 'Pending', 'Approved', 'Released', 'Funded', 'Rejected', 'Cancelled'));

    ALTER TABLE work_requests
      ADD CONSTRAINT chk_work_requests_status
      CHECK (status IN ('Draft', 'In Progress', 'On Hold', 'Completed', 'Cancelled'));

    ALTER TABLE tasks
      ADD CONSTRAINT chk_tasks_status
      CHECK (status IN ('Draft', 'In Progress', 'Completed', 'Cancelled'));

    ALTER TABLE operations_requests
      ADD CONSTRAINT chk_operations_requests_status
      CHECK (status IN ('pending', 'fulfilled', 'rejected', 'cancelled'));

    ALTER TABLE documents
      ADD CONSTRAINT chk_documents_lifecycle
      CHECK (document_lifecycle IN ('collected', 'active', 'inactive', 'transmitted'));
  `);

  // 0.4 — Missing UNIQUE constraints
  pgm.addConstraint('disbursements', 'disbursements_entity_id_disbursement_number_key', {
    unique: ['entity_id', 'disbursement_number'],
  });

  // 0.5 — Partial unique indexes for active duplicates
  pgm.createIndex('pending_changes', ['entity_id', 'table_name', 'parent_record_id', 'submitted_by'], {
    unique: true,
    where: "status = 'pending'",
    name: 'idx_pending_changes_active_unique',
  });
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropIndex('pending_changes', ['entity_id', 'table_name', 'parent_record_id', 'submitted_by'], {
    name: 'idx_pending_changes_active_unique',
  });
  pgm.dropConstraint('disbursements', 'disbursements_entity_id_disbursement_number_key');

  pgm.sql(`
    ALTER TABLE documents DROP CONSTRAINT IF EXISTS chk_documents_lifecycle;
    ALTER TABLE operations_requests DROP CONSTRAINT IF EXISTS chk_operations_requests_status;
    ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_status;
    ALTER TABLE work_requests DROP CONSTRAINT IF EXISTS chk_work_requests_status;
    ALTER TABLE disbursements DROP CONSTRAINT IF EXISTS chk_disbursements_status;
  `);

  pgm.dropColumns('documents', ['archived_at', 'archived_by']);
  pgm.dropColumns('work_requests', ['archived_at', 'archived_by']);
  pgm.dropColumns('disbursements', ['archived_at', 'archived_by']);
  pgm.dropColumns('invoices', ['archived_at', 'archived_by']);
  pgm.dropColumns('clients', ['archived_at', 'archived_by']);

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
    pgm.dropColumns(table, ['version']);
  });
};
