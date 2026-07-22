/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.addColumns('clients', {
    contact_person: { type: 'varchar(255)', default: null }
  });
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropColumns('clients', ['contact_person']);
};
