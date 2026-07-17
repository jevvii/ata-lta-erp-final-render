/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.createTable('clients', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    entity_id: { type: 'uuid', notNull: true, references: 'entities', onDelete: 'restrict' },
    name: { type: 'varchar(255)', notNull: true },
    tin: { type: 'varchar(50)', notNull: true },
    rdo_code: { type: 'varchar(20)' },
    address: { type: 'text' },
    trade_name: { type: 'varchar(255)' },
    contact_user_id: { type: 'uuid', references: 'users', onDelete: 'set null' },
    retainer: { type: 'boolean', notNull: true, default: false },
    status: { type: 'varchar(50)', notNull: true, default: 'Active' },
    created_by: { type: 'uuid', references: 'users', onDelete: 'set null' },
    updated_by: { type: 'uuid', references: 'users', onDelete: 'set null' },
    deleted_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('clients', 'entity_id');
  pgm.createIndex('clients', 'tin');
  pgm.createIndex('clients', 'status');
  pgm.createIndex('clients', ['entity_id', 'tin'], { unique: true, where: 'deleted_at IS NULL' });
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropTable('clients');
};
