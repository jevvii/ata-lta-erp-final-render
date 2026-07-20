/** @type {import('node-pg-migrate').Migration} */
exports.up = async (pgm) => {
  await pgm.sql(`
    INSERT INTO entities (code, name) VALUES
      ('ATA', 'ATA Accounting Firm'),
      ('LTA', 'LTA Accounting Firm')
    ON CONFLICT (code) DO NOTHING;
  `);

  await pgm.sql(`
    INSERT INTO departments (name) VALUES
      ('Management'),
      ('Accounting'),
      ('Operations'),
      ('Documentation')
    ON CONFLICT (name) DO NOTHING;
  `);
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = async (pgm) => {
  await pgm.sql(`DELETE FROM departments WHERE name IN (
    'Management','Accounting','Operations','Documentation'
  );`);
  await pgm.sql(`DELETE FROM entities WHERE code IN ('ATA','LTA');`);
};
