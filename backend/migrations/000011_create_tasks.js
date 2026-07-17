/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.createTable('tasks', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    work_request_id: { type: 'uuid', notNull: true, references: 'work_requests', onDelete: 'cascade' },
    title: { type: 'varchar(255)', notNull: true },
    description: { type: 'text' },
    status: { type: 'varchar(50)', notNull: true, default: 'Draft' },
    assignee_id: { type: 'uuid', references: 'users', onDelete: 'set null' },
    assignee_name: { type: 'varchar(255)' },
    predecessors: { type: 'uuid[]', default: '{}' },
    due_date: { type: 'timestamptz' },
    display_order: { type: 'integer', notNull: true, default: 0 },
    deleted_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('tasks', 'work_request_id');
  pgm.createIndex('tasks', 'assignee_id');
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropTable('tasks');
};
