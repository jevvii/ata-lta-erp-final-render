/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  // 0.6 — Idempotency keys table with 24-hour TTL (idempotent)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_scope VARCHAR(255) NOT NULL,
      idempotency_key VARCHAR(255) NOT NULL,
      request_hash VARCHAR(64),
      response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    DROP INDEX IF EXISTS idx_idempotency_keys_scope_key;
    CREATE UNIQUE INDEX idx_idempotency_keys_scope_key
      ON idempotency_keys (actor_scope, idempotency_key);

    DROP INDEX IF EXISTS idx_idempotency_keys_created_at;
    CREATE INDEX idx_idempotency_keys_created_at
      ON idempotency_keys (created_at);
  `);

  // 0.7 — Status history / entity events table for audit-inside-transition (idempotent)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS status_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      table_name VARCHAR(100) NOT NULL,
      record_id UUID NOT NULL,
      old_status VARCHAR(100),
      new_status VARCHAR(100) NOT NULL,
      actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
      entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    DROP INDEX IF EXISTS idx_status_history_record;
    CREATE INDEX idx_status_history_record
      ON status_history (table_name, record_id);

    DROP INDEX IF EXISTS idx_status_history_entity;
    CREATE INDEX idx_status_history_entity
      ON status_history (entity_id);

    DROP INDEX IF EXISTS idx_status_history_created_at;
    CREATE INDEX idx_status_history_created_at
      ON status_history (created_at);
  `);
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS status_history;
    DROP TABLE IF EXISTS idempotency_keys;
  `);
};
