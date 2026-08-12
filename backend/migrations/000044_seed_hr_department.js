/** @type {import('node-pg-migrate').Migration} */
exports.up = async (pgm) => {
  await pgm.sql(`
    INSERT INTO departments (name) VALUES
      ('HR')
    ON CONFLICT (name) DO NOTHING;
  `);
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = async (pgm) => {
  await pgm.sql(`DELETE FROM departments WHERE name = 'HR';`);
};
