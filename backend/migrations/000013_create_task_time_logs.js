/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.createTable('task_time_logs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    task_id: { type: 'uuid', notNull: true, references: 'tasks', onDelete: 'cascade' },
    start_time: { type: 'timestamptz' },
    end_time: { type: 'timestamptz' },
    date: { type: 'date' },
    hours: { type: 'numeric(10,2)', notNull: true, default: 0 },
    user_id: { type: 'uuid', references: 'users', onDelete: 'set null' },
    note: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('task_time_logs', 'task_id');
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropTable('task_time_logs');
};
