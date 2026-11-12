const { supabaseAdmin, mockTables, resetMock } = require('../fixtures/supabaseMock');

describe('PostgREST pagination contract in the test database', () => {
  beforeEach(() => {
    resetMock();
    for (let i = 0; i < 10; i += 1) {
      mockTables.clients.set(`client-${i}`, { id: `client-${i}`, retainer: i < 6 });
    }
  });

  it('returns the complete filtered count with a limited page', async () => {
    const { data, count } = await supabaseAdmin.from('clients').select('*', { count: 'exact' })
      .eq('retainer', true).range(0, 1);
    expect(data).toHaveLength(2);
    expect(count).toBe(6);
  });

  it('replaces an earlier range instead of applying both ranges', async () => {
    const query = supabaseAdmin.from('clients').select('*').order('id');
    expect((await query.range(0, 1)).data.map((row) => row.id)).toEqual(['client-0', 'client-1']);
    expect((await query.range(2, 3)).data.map((row) => row.id)).toEqual(['client-2', 'client-3']);
  });
});
