/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.createTable('audit_logs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    action: { type: 'varchar(100)', notNull: true },
    table_name: { type: 'varchar(100)' },
    record_id: { type: 'uuid' },
    entity: { type: 'varchar(10)' },
    user_id: { type: 'uuid', references: 'users', onDelete: 'set null' },
    details: { type: 'jsonb', notNull: true, default: '{}' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('audit_logs', 'created_at');
  pgm.createIndex('audit_logs', 'entity');
  pgm.createIndex('audit_logs', 'user_id');
  pgm.createIndex('audit_logs', 'record_id');
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropTable('audit_logs');
};
