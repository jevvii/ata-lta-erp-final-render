/**
 * Add required_link_type to tasks and linked_task_id to transmittals.
 */

/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_link_type VARCHAR(50);
    ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS linked_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_transmittals_linked_task_id ON transmittals(linked_task_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_required_link_type ON tasks(required_link_type);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_tasks_required_link_type;
    DROP INDEX IF EXISTS idx_transmittals_linked_task_id;
    ALTER TABLE transmittals DROP COLUMN IF EXISTS linked_task_id;
    ALTER TABLE tasks DROP COLUMN IF EXISTS required_link_type;
  `);
};
