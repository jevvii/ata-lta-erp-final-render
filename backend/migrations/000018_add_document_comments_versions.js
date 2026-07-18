/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE documents
      ADD COLUMN IF NOT EXISTS comments JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS versions JSONB DEFAULT '[]'::jsonb;
  `);
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE documents
      DROP COLUMN IF EXISTS comments,
      DROP COLUMN IF EXISTS versions;
  `);
};
