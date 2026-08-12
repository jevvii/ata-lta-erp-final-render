/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.addColumns('clients', {
    retainer_fee: { type: 'numeric(15,2)', default: null }
  });
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropColumns('clients', ['retainer_fee']);
};
