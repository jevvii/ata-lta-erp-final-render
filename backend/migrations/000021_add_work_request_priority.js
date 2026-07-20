/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.addColumn('work_requests', {
    priority: { type: 'varchar(50)', notNull: true, default: 'Normal' },
  });
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropColumn('work_requests', 'priority');
};
