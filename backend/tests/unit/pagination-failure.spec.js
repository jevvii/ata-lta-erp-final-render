jest.mock('../../src/services/supabaseClient', () => ({ supabaseAdmin: { from: jest.fn() } }));
const { supabaseAdmin } = require('../../src/services/supabaseClient');
const operations = require('../../src/modules/operations/service');
const admin = require('../../src/modules/admin/service');

describe('Full-dataset pagination failures', () => {
  beforeEach(() => {
    supabaseAdmin.from.mockImplementation((table) => {
      let offset = 0;
      const query = {};
      for (const method of ['select', 'eq', 'neq', 'is', 'or', 'in', 'order', 'gte', 'lte']) {
        query[method] = jest.fn(() => query);
      }
      query.maybeSingle = () => Promise.resolve({ data: table === 'entities' ? { id: 'ent-ata', code: 'ATA' } : null, error: null });
      query.range = jest.fn((start) => { offset = start; return query; });
      query.then = (resolve, reject) => Promise.resolve(
        ['work_requests', 'audit_logs'].includes(table)
          ? offset >= 1000
            ? { data: null, error: { message: 'Injected later-page failure' } }
            : { data: Array.from({ length: 1000 }, (_, i) => ({ id: `row-${i}`, entity_id: 'ent-ata', entity: 'ATA', title: 'Visible row' })), error: null }
          : { data: [], error: null }
      ).then(resolve, reject);
      return query;
    });
  });

  it('rejects a partial work-request list when a later page fails', async () => {
    await expect(operations.listWorkRequests({ entityId: 'ent-ata', user: { id: 'admin', role: 'Admin' }, limit: 'all' }))
      .rejects.toMatchObject({ statusCode: 500, detail: expect.stringContaining('Injected later-page failure') });
  });

  it('rejects a partial audit list when a later page fails', async () => {
    await expect(admin.getAuditLogs({ entityCode: 'ALL', filters: { limit: 'all' } }))
      .rejects.toMatchObject({ statusCode: 500, detail: expect.stringContaining('Injected later-page failure') });
  });
});
