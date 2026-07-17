/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.createTable('client_related_companies', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    client_id: { type: 'uuid', notNull: true, references: 'clients', onDelete: 'cascade' },
    related_client_id: { type: 'uuid', notNull: true, references: 'clients', onDelete: 'cascade' },
    relationship: { type: 'varchar(100)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('client_related_companies', 'client_id');
  pgm.createIndex('client_related_companies', ['client_id', 'related_client_id'], { unique: true });
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropTable('client_related_companies');
};
