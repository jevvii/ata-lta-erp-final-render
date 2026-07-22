/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.addColumns('task_time_logs', {
    worker_name: { type: 'varchar(255)', default: null },
    checklist_item_id: { type: 'uuid', references: 'task_checklists', onDelete: 'cascade', default: null }
  });
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropColumns('task_time_logs', ['worker_name', 'checklist_item_id']);
};
