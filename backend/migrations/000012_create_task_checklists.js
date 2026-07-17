/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.createTable('task_checklists', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    task_id: { type: 'uuid', notNull: true, references: 'tasks', onDelete: 'cascade' },
    text: { type: 'varchar(500)', notNull: true },
    category: { type: 'varchar(100)' },
    completed: { type: 'boolean', notNull: true, default: false },
    assignee_id: { type: 'uuid', references: 'users', onDelete: 'set null' },
    assignee_name: { type: 'varchar(255)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('task_checklists', 'task_id');
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropTable('task_checklists');
};
