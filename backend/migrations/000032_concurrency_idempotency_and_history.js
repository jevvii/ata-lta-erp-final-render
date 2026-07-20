/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  // 0.6 — Idempotency keys table with 24-hour TTL
  pgm.createTable('idempotency_keys', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    actor_scope: { type: 'varchar(255)', notNull: true },
    idempotency_key: { type: 'varchar(255)', notNull: true },
    request_hash: { type: 'varchar(64)' },
    response_json: { type: 'jsonb', notNull: true, default: '{}' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('idempotency_keys', ['actor_scope', 'idempotency_key'], {
    unique: true,
    name: 'idx_idempotency_keys_scope_key',
  });
  pgm.createIndex('idempotency_keys', 'created_at', { name: 'idx_idempotency_keys_created_at' });

  // 0.7 — Status history / entity events table for audit-inside-transition
  pgm.createTable('status_history', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    table_name: { type: 'varchar(100)', notNull: true },
    record_id: { type: 'uuid', notNull: true },
    old_status: { type: 'varchar(100)' },
    new_status: { type: 'varchar(100)', notNull: true },
    actor_id: { type: 'uuid', references: 'users', onDelete: 'set null' },
    entity_id: { type: 'uuid', notNull: true, references: 'entities', onDelete: 'cascade' },
    details: { type: 'jsonb', notNull: true, default: '{}' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('status_history', ['table_name', 'record_id'], { name: 'idx_status_history_record' });
  pgm.createIndex('status_history', 'entity_id', { name: 'idx_status_history_entity' });
  pgm.createIndex('status_history', 'created_at', { name: 'idx_status_history_created_at' });
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropTable('status_history');
  pgm.dropTable('idempotency_keys');
};
