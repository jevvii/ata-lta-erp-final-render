/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.addColumns('work_requests', {
    priority: { type: 'varchar(50)', notNull: true, default: 'Normal' },
  });
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropColumns('work_requests', ['priority']);
};
