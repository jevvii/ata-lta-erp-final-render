/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.createTable('entities', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    code: { type: 'varchar(10)', notNull: true, unique: true },
    name: { type: 'varchar(255)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('entities', 'code', { unique: true });
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropTable('entities');
};
