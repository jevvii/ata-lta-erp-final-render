/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_work_requests_entity_status
      ON work_requests(entity_id, status) WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_work_requests_entity_due_date
      ON work_requests(entity_id, due_date) WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_tasks_wr_status_due_date
      ON tasks(work_request_id, status, due_date) WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_invoice_payments_payment_date_invoice_id
      ON invoice_payments(payment_date, invoice_id);

    CREATE INDEX IF NOT EXISTS idx_documents_entity_wr_lifecycle
      ON documents(entity_id, work_request_id, document_lifecycle) WHERE deleted_at IS NULL;
  `);
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_work_requests_entity_status;
    DROP INDEX IF EXISTS idx_work_requests_entity_due_date;
    DROP INDEX IF EXISTS idx_tasks_wr_status_due_date;
    DROP INDEX IF EXISTS idx_invoice_payments_payment_date_invoice_id;
    DROP INDEX IF EXISTS idx_documents_entity_wr_lifecycle;
  `);
};
