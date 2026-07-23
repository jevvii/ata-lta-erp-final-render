/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE transmittals
      ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT FALSE;
  `);
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE transmittals
      DROP COLUMN IF EXISTS approved;
  `);
};
