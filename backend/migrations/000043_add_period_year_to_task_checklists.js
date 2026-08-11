/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.addColumns('task_checklists', {
    period_year: { type: 'varchar(100)', default: null }
  });
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropColumns('task_checklists', ['period_year']);
};
