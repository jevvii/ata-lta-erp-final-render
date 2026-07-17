/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.createTable('client_contact_details', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    client_id: { type: 'uuid', notNull: true, references: 'clients', onDelete: 'cascade' },
    type: { type: 'varchar(20)', notNull: true },
    value: { type: 'varchar(255)', notNull: true },
    label: { type: 'varchar(50)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('client_contact_details', 'client_id');
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropTable('client_contact_details');
};
