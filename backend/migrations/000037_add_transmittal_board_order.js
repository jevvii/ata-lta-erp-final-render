/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  // Add board ordering support to transmittals so the kanban board can persist
  // drag-and-drop order across sessions and page refreshes.
  pgm.sql(`
    ALTER TABLE transmittals
      ADD COLUMN IF NOT EXISTS board_order INTEGER DEFAULT 0;

    UPDATE transmittals
      SET board_order = 0
      WHERE board_order IS NULL;
  `);
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE transmittals
      DROP COLUMN IF EXISTS board_order;
  `);
};
