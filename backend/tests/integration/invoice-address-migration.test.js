/** Real schema/function regression in a private PostgreSQL schema, always rolled back. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const statementMigration = require('../../migrations/000067_invoice_statement_details_admin_edit');
const addressMigration = require('../../migrations/000069_add_invoice_address_snapshot');

const connectionString = process.env.BILLING_MIGRATION_TEST_DATABASE_URL;
const databaseDescribe = connectionString ? describe : describe.skip;

databaseDescribe('Invoice address snapshot repair on the real SQL schema', () => {
  const schema = `test_invoice_address_${crypto.randomBytes(8).toString('hex')}`;
  const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  let client;
  const apply = async (migration) => {
    const statements = [];
    migration.up({ sql: (sql) => statements.push(sql) });
    for (const sql of statements) await client.query(sql.replace(/\bpublic\b/g, schema));
  };
  const update = async (updates, items = null, version = 1) => {
    const result = await client.query(
      `SELECT ${schema}.invoice_update_transactional($1, $2::jsonb, $3::jsonb, $4, $5, $6) AS invoice`,
      [
        id(4),
        JSON.stringify(updates),
        items === null ? null : JSON.stringify(items),
        id(1),
        id(2),
        version,
      ]
    );
    return result.rows[0].invoice;
  };
  const expectSqlError = async (action, code) => {
    await client.query('SAVEPOINT expected_error');
    try {
      await expect(action()).rejects.toMatchObject({ code });
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT expected_error');
      await client.query('RELEASE SAVEPOINT expected_error');
    }
  };
  beforeAll(async () => {
    client = new Client({ connectionString, connectionTimeoutMillis: 15000 });
    await client.connect();
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}, public`);
    await client.query(`CREATE TABLE users (id uuid PRIMARY KEY, role text);
      CREATE TABLE entities (id uuid PRIMARY KEY);
      CREATE TABLE clients (id uuid PRIMARY KEY, address text);
      CREATE TABLE work_requests (id uuid PRIMARY KEY);`);
    // The actual base schema omits address, unlike the old mock fixtures.
    await client.query(
      fs.readFileSync(
        path.join(__dirname, '../../migrations/020-create-billing-tables.sql'),
        'utf8'
      )
    );
    await client.query(`ALTER TABLE invoices ADD COLUMN version integer NOT NULL DEFAULT 1,
        ADD COLUMN linked_task_id uuid, ADD COLUMN task_id uuid, ADD COLUMN linked_transmittal_id uuid;
      INSERT INTO users VALUES ('${id(1)}', 'Admin');
      INSERT INTO entities VALUES ('${id(2)}');
      INSERT INTO clients VALUES ('${id(3)}', 'Master client address');
      INSERT INTO invoices (id, invoice_number, client_id, entity_id, issue_date, due_date,
        status, subtotal, total, amount_paid, balance)
      VALUES ('${id(4)}', 'TEST-001', '${id(3)}', '${id(2)}', '2026-10-20', '2026-11-20',
        'Sent', 1500, 1500, 0, 1500);
      INSERT INTO invoice_line_items (invoice_id, description, amount, type)
      VALUES ('${id(4)}', 'Original fee', 1500, 'Professional Fee');`);
    await apply(statementMigration);
  }, 30000);
  afterAll(async () => {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } finally {
        await client.end();
      }
    }
  });
  it('reproduces the undefined-column failure even for a signature-only update', async () => {
    await expectSqlError(() => update({ print_details: { preparedBy: 'P. Cruz' } }), '42703');
  });
  it('adds the snapshot idempotently without changing master client data', async () => {
    await apply(addressMigration);
    await apply(addressMigration);
    expect((await client.query('SELECT address FROM invoices')).rows[0].address).toBeNull();
    expect((await client.query('SELECT address FROM clients')).rows[0].address).toBe(
      'Master client address'
    );
  });
  it('saves printed fields through the actual transaction function after repair', async () => {
    const invoice = await update({
      print_details: { preparedBy: 'P. Cruz', receivedBy: 'R. Tan' },
    });
    expect(invoice.print_details).toEqual({ preparedBy: 'P. Cruz', receivedBy: 'R. Tan' });
    expect(invoice.version).toBe(2);
    expect(invoice.address).toBeNull();
  });
  it('saves the full inline payload and recalculates totals without editing the master address', async () => {
    const invoice = await update(
      {
        client_id: id(3),
        work_request_id: null,
        linked_task_id: null,
        task_id: null,
        invoice_number: 'TEST-001',
        issue_date: '2026-10-20',
        due_date: '2026-11-20',
        address: 'Invoice-specific address',
        notes: 'Revised fee',
        terms: 'Net 30',
        print_details: { preparedBy: 'P. Cruz', receivedBy: 'R. Tan', bankBranch: 'Manila' },
      },
      [{ description: 'Revised fee', amount: 1800, type: 'Professional Fee' }],
      2
    );
    expect(invoice.address).toBe('Invoice-specific address');
    expect(Number(invoice.total)).toBe(1800);
    expect(Number(invoice.balance)).toBe(1800);
    expect(invoice.version).toBe(3);
    expect((await client.query('SELECT address FROM clients')).rows[0].address).toBe(
      'Master client address'
    );
  });
  it('rejects stale writes without losing the address, signature, or line items', async () => {
    await expectSqlError(
      () =>
        update(
          { address: 'Stale', print_details: { preparedBy: 'Stale' } },
          [{ description: 'Stale', amount: 1 }],
          2
        ),
      'P0001'
    );
    const invoice = (await client.query('SELECT address, print_details, version FROM invoices'))
      .rows[0];
    expect(invoice.address).toBe('Invoice-specific address');
    expect(invoice.print_details.preparedBy).toBe('P. Cruz');
    expect(invoice.version).toBe(3);
    expect(
      (await client.query('SELECT description FROM invoice_line_items')).rows[0].description
    ).toBe('Revised fee');
  });
  it('supports a deliberately cleared invoice address', async () => {
    const invoice = await update({ address: '' }, null, 3);
    expect(invoice.address).toBe('');
    expect((await client.query('SELECT address FROM clients')).rows[0].address).toBe(
      'Master client address'
    );
  });
});
