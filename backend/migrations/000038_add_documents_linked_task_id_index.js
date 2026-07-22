/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  // Replace the non-partial index with a partial index that only covers
  // live (non-deleted) documents, matching the filtering used by the DMS
  // list endpoint and keeping the index small for archived rows.
  pgm.sql(`
    DROP INDEX IF EXISTS idx_documents_linked_task_id;
    CREATE INDEX idx_documents_linked_task_id ON documents(linked_task_id) WHERE deleted_at IS NULL;
  `);
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_documents_linked_task_id;
    CREATE INDEX idx_documents_linked_task_id ON documents(linked_task_id);
  `);
};
