jest.mock('../../src/services/supabaseClient', () => ({ supabaseAdmin: { from: jest.fn() } }));
jest.mock('../../src/lib/projectLinkage', () => ({ ...jest.requireActual('../../src/lib/projectLinkage'), filterValidProjectRecords: jest.fn(async (rows) => rows) }));
const { supabaseAdmin } = require('../../src/services/supabaseClient');
const { listInvoices } = require('../../src/modules/billing/service');

it('retains work-request metadata beyond the PostgREST row cap in View All', async () => {
  const invoices = Array.from({ length: 1001 }, (_, i) => ({ id: `invoice-${i}`, work_request_id: `wr-${i}`, entity_id: 'ent-ata' }));
  supabaseAdmin.from.mockImplementation((table) => {
    let ids = [], start = 0, end = 999;
    const query = {};
    for (const method of ['select', 'is', 'eq', 'or', 'order']) query[method] = () => query;
    query.in = (_column, values) => { ids = values; return query; };
    query.range = (from, to) => { start = from; end = to; return query; };
    query.then = (resolve, reject) => Promise.resolve({ data:
      table === 'invoices' ? invoices.slice(start, end + 1) :
      table === 'work_requests' ? ids.slice(0, 1000).map((id) => ({ id, title: `Project ${id}` })) :
      table === 'entities' ? [{ id: 'ent-ata', code: 'ATA' }] : [], error: null
    }).then(resolve, reject);
    return query;
  });
  const result = await listInvoices({ entityId: 'ent-ata', user: { id: 'admin', role: 'Admin' }, filters: { limit: 'all' } });
  expect(result.data).toHaveLength(1001);
  expect(result.data.at(-1).work_request_title).toBe('Project wr-1000');
});
