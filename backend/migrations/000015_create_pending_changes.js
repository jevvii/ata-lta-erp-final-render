/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.createTable('pending_changes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    entity_id: { type: 'uuid', notNull: true, references: 'entities', onDelete: 'restrict' },
    table_name: { type: 'varchar(100)', notNull: true },
    parent_record_id: { type: 'uuid' },
    proposed_data: { type: 'jsonb', notNull: true, default: '{}' },
    submitted_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
    status: { type: 'varchar(50)', notNull: true, default: 'pending' },
    rejection_reason: { type: 'text' },
    reviewed_by: { type: 'uuid', references: 'users', onDelete: 'set null' },
    reviewed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('pending_changes', 'entity_id');
  pgm.createIndex('pending_changes', 'status');
  pgm.createIndex('pending_changes', 'submitted_by');
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropTable('pending_changes');
};
