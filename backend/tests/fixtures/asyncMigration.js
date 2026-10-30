exports.up = async (pgm) => {
  await new Promise((resolve) => setTimeout(resolve, 5));
  pgm.sql('SELECT 1 AS async_migration_completed');
};
