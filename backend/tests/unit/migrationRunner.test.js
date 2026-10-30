const path = require('node:path');
const { applyJsMigration } = require('../../scripts/migrate-remote');

it('waits for asynchronous migration preparation before executing its SQL', async () => {
  const statements = [];
  const client = {
    query: async (sql) => {
      statements.push(sql);
    },
  };
  await applyJsMigration(client, path.join(__dirname, '../fixtures/asyncMigration.js'));
  expect(statements).toEqual(['SELECT 1 AS async_migration_completed']);
});
