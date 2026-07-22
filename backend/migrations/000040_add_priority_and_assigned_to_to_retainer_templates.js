/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.addColumns('retainer_templates', {
    priority: { type: 'varchar(50)', default: 'Normal' },
    assigned_to: { type: 'uuid', references: 'users', onDelete: 'set null', default: null }
  });
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropColumns('retainer_templates', ['priority', 'assigned_to']);
};
