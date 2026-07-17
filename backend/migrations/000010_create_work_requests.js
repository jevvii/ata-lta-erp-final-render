/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.createTable('work_requests', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    entity_id: { type: 'uuid', notNull: true, references: 'entities', onDelete: 'restrict' },
    client_id: { type: 'uuid', notNull: true, references: 'clients', onDelete: 'restrict' },
    title: { type: 'varchar(255)', notNull: true },
    description: { type: 'text' },
    status: { type: 'varchar(50)', notNull: true, default: 'Draft' },
    requested_by: { type: 'uuid', references: 'users', onDelete: 'set null' },
    assigned_to: { type: 'uuid', references: 'users', onDelete: 'set null' },
    due_date: { type: 'timestamptz' },
    deleted_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('work_requests', 'entity_id');
  pgm.createIndex('work_requests', 'client_id');
  pgm.createIndex('work_requests', 'status');
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropTable('work_requests');
};
