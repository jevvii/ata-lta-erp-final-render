/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.createTable('operations_requests', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    entity_id: { type: 'uuid', notNull: true, references: 'entities', onDelete: 'restrict' },
    type: { type: 'varchar(50)', notNull: true },
    work_request_id: { type: 'uuid', references: 'work_requests', onDelete: 'set null' },
    client_id: { type: 'uuid', references: 'clients', onDelete: 'set null' },
    requested_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
    amount: { type: 'numeric(15,2)' },
    status: { type: 'varchar(50)', notNull: true, default: 'pending' },
    notes: { type: 'text' },
    rejection_reason: { type: 'text' },
    fulfilled_by: { type: 'uuid', references: 'users', onDelete: 'set null' },
    fulfilled_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('operations_requests', 'entity_id');
  pgm.createIndex('operations_requests', 'work_request_id');
  pgm.createIndex('operations_requests', 'requested_by');
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropTable('operations_requests');
};
