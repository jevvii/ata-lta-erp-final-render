/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  // The UI supports per-checklist-item dependencies (dependsOn). Persist them.
  pgm.sql(`
    ALTER TABLE task_checklists
      ADD COLUMN IF NOT EXISTS depends_on uuid[] DEFAULT '{}';
  `);
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE task_checklists
      DROP COLUMN IF EXISTS depends_on;
  `);
};
