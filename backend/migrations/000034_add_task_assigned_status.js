/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  // The UI creates tasks with an 'Assigned' status when an assignee is picked,
  // and also allows 'For Review' transitions. Expand the existing check
  // constraint so these states survive the database insert/update.
  pgm.sql(`
    ALTER TABLE tasks
      DROP CONSTRAINT IF EXISTS chk_tasks_status,
      ADD CONSTRAINT chk_tasks_status
      CHECK (status IN ('Draft', 'Assigned', 'In Progress', 'For Review', 'Completed', 'Cancelled'));
  `);
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE tasks
      DROP CONSTRAINT IF EXISTS chk_tasks_status,
      ADD CONSTRAINT chk_tasks_status
      CHECK (status IN ('Draft', 'In Progress', 'Completed', 'Cancelled'));
  `);
};
