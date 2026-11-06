const { truncateOperationalTables } = require('../../scripts/truncate-operational-tables');

const tables = ['tasks', 'task_creation_review_events'];
const makeClient = (failure) => ({
  query: jest.fn(async (sql) => {
    if (failure && sql.includes(failure)) throw new Error('injected database failure');
    return { rows: [{ tgenabled: 'O' }] };
  }),
});

it.each(['DISABLE TRIGGER', 'TRUNCATE TABLE', 'ENABLE TRIGGER'])(
  'rolls back the reset, including audit protection changes, when %s fails',
  async (failure) => {
    const client = makeClient(failure);
    await expect(truncateOperationalTables(client, tables)).rejects.toThrow('injected database failure');
    const statements = client.query.mock.calls.map(([sql]) => sql);
    expect(statements[0]).toBe('BEGIN');
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
  }
);

it('refuses unexpected immutable history protection rather than changing its state', async () => {
  const client = { query: jest.fn(async () => ({ rows: [{ tgenabled: 'D' }] })) };
  await expect(truncateOperationalTables(client, tables)).rejects.toThrow('reset aborted');
  const statements = client.query.mock.calls.map(([sql]) => sql);
  expect(statements.some((sql) => sql.includes('DISABLE TRIGGER'))).toBe(false);
  expect(statements.at(-1)).toBe('ROLLBACK');
});

it('restores audit protection before committing and restricts truncation to explicit tables', async () => {
  const client = makeClient();
  await truncateOperationalTables(client, tables);
  const statements = client.query.mock.calls.map(([sql]) => sql);
  expect(statements.find((sql) => sql.startsWith('TRUNCATE'))).toBe(
    'TRUNCATE TABLE public."tasks", public."task_creation_review_events" RESTART IDENTITY RESTRICT'
  );
  expect(statements.at(-2)).toContain('ENABLE TRIGGER');
  expect(statements.at(-1)).toBe('COMMIT');
  expect(statements.some((sql) => sql.includes('trg_task_creation_review_events_immutable'))).toBe(false);
});
