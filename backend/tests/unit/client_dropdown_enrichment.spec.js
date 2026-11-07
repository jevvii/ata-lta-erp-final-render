const operationsService = require('../../src/modules/operations/service');
const billingService = require('../../src/modules/billing/service');
const transmittalsService = require('../../src/modules/transmittals/service');
const clientsService = require('../../src/modules/clients/service');
const { supabaseAdmin } = require('../../src/services/supabaseClient');

const createFluentMock = (data) => {
  const builder = {
    select: jest.fn().mockImplementation(() => builder),
    eq: jest.fn().mockImplementation(() => builder),
    neq: jest.fn().mockImplementation(() => builder),
    is: jest.fn().mockImplementation(() => builder),
    or: jest.fn().mockImplementation(() => builder),
    order: jest.fn().mockImplementation(() => builder),
    in: jest.fn().mockImplementation(() => builder),
    single: jest.fn().mockResolvedValue({ data, error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data, error: null }),
  };
  return builder;
};

describe('Client Dropdown TIN & Trade Name Backend Enrichment', () => {
  describe('Operations Module - Work Request Mapping & Projection', () => {
    it('uses enriched select string in listWorkRequests', async () => {
      let selectArg = null;
      const selectSpy = jest.spyOn(supabaseAdmin, 'from').mockImplementation((table) => {
        if (table === 'work_requests') {
          const mock = createFluentMock([]);
          mock.select = jest.fn().mockImplementation((cols) => {
            selectArg = cols;
            return mock;
          });
          // fetchInPages support
          mock.range = jest.fn().mockResolvedValue({ data: [], error: null });
          return mock;
        }
        if (table === 'entities') return createFluentMock([{ id: 'ent-ata', code: 'ATA' }]);
        return createFluentMock([]);
      });

      await operationsService.listWorkRequests({
        entityId: 'ent-ata',
        user: { id: 'usr-1', role: 'Admin', entities: ['ATA'] },
      });

      selectSpy.mockRestore();

      expect(selectArg).toBe('*, clients(name, client_number, tin, trade_name)');
    });

    it('enriches joined clients relation and maps clientTin and clientTradeName in getWorkRequestById', async () => {
      let selectArg = null;
      const mockRow = {
        id: '11111111-1111-4000-a000-000000000001',
        work_request_number: 'WR-2026-001',
        entity_id: 'ent-ata',
        title: 'Tax Filing',
        status: 'Draft',
        client_id: 'cli-001',
        clients: {
          name: 'Acme Corp',
          client_number: 'CLI-001',
          tin: '123-456-789-000',
          trade_name: 'Acme Trading',
        },
      };

      const selectSpy = jest.spyOn(supabaseAdmin, 'from').mockImplementation((table) => {
        if (table === 'work_requests') {
          const mock = createFluentMock(mockRow);
          mock.select = jest.fn().mockImplementation((cols) => {
            selectArg = cols;
            return mock;
          });
          return mock;
        }
        if (table === 'entities') return createFluentMock({ code: 'ATA' });
        if (table === 'users') return createFluentMock(null);
        return createFluentMock([]);
      });

      const res = await operationsService.getWorkRequestById({
        entityId: 'ent-ata',
        id: mockRow.id,
        user: { id: 'usr-1', role: 'Admin', entities: ['ATA'] },
      });

      selectSpy.mockRestore();

      expect(selectArg).toBe('*, clients(name, client_number, tin, trade_name)');
      expect(res).toBeDefined();
      expect(res.clientName).toBe('Acme Corp');
      expect(res.client_name).toBe('Acme Corp');
      expect(res.clientNumber).toBe('CLI-001');
      expect(res.client_number).toBe('CLI-001');
      expect(res.clientTin).toBe('123-456-789-000');
      expect(res.client_tin).toBe('123-456-789-000');
      expect(res.clientTradeName).toBe('Acme Trading');
      expect(res.client_trade_name).toBe('Acme Trading');
      expect(res.clients).toEqual({
        name: 'Acme Corp',
        client_number: 'CLI-001',
        tin: '123-456-789-000',
        trade_name: 'Acme Trading',
      });
    });
  });

  describe('Billing Module - Invoice Mapping & Projection', () => {
    it('uses enriched select string in listInvoices', async () => {
      let selectArg = null;
      const selectSpy = jest.spyOn(supabaseAdmin, 'from').mockImplementation((table) => {
        if (table === 'invoices') {
          const mock = createFluentMock([]);
          mock.select = jest.fn().mockImplementation((cols) => {
            selectArg = cols;
            return mock;
          });
          mock.range = jest.fn().mockResolvedValue({ data: [], error: null });
          return mock;
        }
        if (table === 'entities') return createFluentMock([{ id: 'ent-ata', code: 'ATA' }]);
        return createFluentMock([]);
      });

      await billingService.listInvoices({
        entityId: 'ent-ata',
        user: { id: 'usr-1', role: 'Admin', entities: ['ATA'] },
      });

      selectSpy.mockRestore();

      expect(selectArg).toBe('*, clients(name, client_number, tin, trade_name)');
    });

    it('enriches joined clients relation and exposes clientTin and clientTradeName in getInvoiceById', async () => {
      let selectArg = null;
      const mockInvoice = {
        id: '22222222-2222-4000-a000-000000000002',
        invoice_number: 'INV-2026-001',
        entity_id: 'ent-ata',
        client_id: 'cli-001',
        clients: {
          name: 'Acme Corp',
          client_number: 'CLI-001',
          tin: '123-456-789-000',
          address: '123 Main St',
          trade_name: 'Acme Trading',
        },
      };

      const selectSpy = jest.spyOn(supabaseAdmin, 'from').mockImplementation((table) => {
        if (table === 'invoices') {
          const mock = createFluentMock(mockInvoice);
          mock.select = jest.fn().mockImplementation((cols) => {
            selectArg = cols;
            return mock;
          });
          return mock;
        }
        if (table === 'entities') return createFluentMock({ code: 'ATA' });
        return createFluentMock([]);
      });

      const res = await billingService.getInvoiceById({
        entityId: 'ent-ata',
        id: mockInvoice.id,
        user: { id: 'usr-1', role: 'Admin', entities: ['ATA'] },
        checkViewPermissions: false,
      });

      selectSpy.mockRestore();

      expect(selectArg).toBe('*, clients(name, tin, address, client_number, trade_name)');
      expect(res).toBeDefined();
      expect(res.clientName).toBe('Acme Corp');
      expect(res.client_name).toBe('Acme Corp');
      expect(res.clientNumber).toBe('CLI-001');
      expect(res.client_number).toBe('CLI-001');
      expect(res.clientTin).toBe('123-456-789-000');
      expect(res.client_tin).toBe('123-456-789-000');
      expect(res.clientTradeName).toBe('Acme Trading');
      expect(res.client_trade_name).toBe('Acme Trading');
      expect(res.clients.tin).toBe('123-456-789-000');
      expect(res.clients.trade_name).toBe('Acme Trading');
    });
  });

  describe('Transmittals Module - Transmittal Mapping & Projection', () => {
    it('uses enriched select string in listTransmittals', async () => {
      let selectArg = null;
      const selectSpy = jest.spyOn(supabaseAdmin, 'from').mockImplementation((table) => {
        if (table === 'transmittals') {
          const mock = createFluentMock([]);
          mock.select = jest.fn().mockImplementation((cols) => {
            selectArg = cols;
            return mock;
          });
          mock.range = jest.fn().mockResolvedValue({ data: [], error: null });
          return mock;
        }
        if (table === 'entities') return createFluentMock([{ id: 'ent-ata', code: 'ATA' }]);
        return createFluentMock([]);
      });

      await transmittalsService.listTransmittals({
        entityId: 'ent-ata',
        user: { id: 'usr-1', role: 'Admin', entities: ['ATA'] },
      });

      selectSpy.mockRestore();

      expect(selectArg).toBe('*, clients(name, client_number, tin, trade_name)');
    });

    it('enriches joined clients relation and exposes clientTin and clientTradeName in getTransmittalById', async () => {
      let selectArg = null;
      const mockTransmittal = {
        id: '33333333-3333-4000-a000-000000000003',
        tracking_number: 'TR-2026-001',
        entity_id: 'ent-ata',
        client_id: 'cli-001',
        clients: {
          name: 'Acme Corp',
          client_number: 'CLI-001',
          tin: '123-456-789-000',
          address: '123 Main St',
          trade_name: 'Acme Trading',
        },
      };

      const selectSpy = jest.spyOn(supabaseAdmin, 'from').mockImplementation((table) => {
        if (table === 'transmittals') {
          const mock = createFluentMock(mockTransmittal);
          mock.select = jest.fn().mockImplementation((cols) => {
            selectArg = cols;
            return mock;
          });
          return mock;
        }
        if (table === 'entities') return createFluentMock({ code: 'ATA' });
        return createFluentMock([]);
      });

      const res = await transmittalsService.getTransmittalById({
        entityId: 'ent-ata',
        id: mockTransmittal.id,
        user: { id: 'usr-1', role: 'Admin', entities: ['ATA'] },
        internal: true,
      });

      selectSpy.mockRestore();

      expect(selectArg).toBe('*, clients(name, address, tin, client_number, trade_name)');
      expect(res).toBeDefined();
      expect(res.clientName).toBe('Acme Corp');
      expect(res.client_name).toBe('Acme Corp');
      expect(res.clientNumber).toBe('CLI-001');
      expect(res.client_number).toBe('CLI-001');
      expect(res.clientTin).toBe('123-456-789-000');
      expect(res.client_tin).toBe('123-456-789-000');
      expect(res.clientTradeName).toBe('Acme Trading');
      expect(res.client_trade_name).toBe('Acme Trading');
      expect(res.clients.tin).toBe('123-456-789-000');
      expect(res.clients.trade_name).toBe('Acme Trading');
    });
  });

  describe('Clients Module - Client Sorting & Ordering', () => {
    const sampleRows = [
      { id: 'c1', name: 'Zebra Corp', client_number: 'CLI-ATA-0002', tin: '999-000-111-000', rdo_code: '047', created_at: '2026-01-01T00:00:00Z', entity_id: 'ent-ata', deleted_at: null, status: 'Active' },
      { id: 'c2', name: 'Alpha Logistics', client_number: 'CLI-ATA-0001', tin: '111-222-333-000', rdo_code: '034A', created_at: '2026-02-01T00:00:00Z', entity_id: 'ent-ata', deleted_at: null, status: 'Active' },
      { id: 'c3', name: 'Middle Enterprises', client_number: 'CLI-ATA-0010', tin: '555-666-777-000', rdo_code: '044', created_at: '2026-03-01T00:00:00Z', entity_id: 'ent-ata', deleted_at: null, status: 'Active' },
      { id: 'c4', name: 'Beta Technologies', client_number: null, tin: '333-444-555-000', rdo_code: null, created_at: '2026-01-15T00:00:00Z', entity_id: 'ent-ata', deleted_at: null, status: 'Active' },
      { id: 'c5', name: 'Gamma Holdings', client_number: '', tin: null, rdo_code: '', created_at: '2026-04-01T00:00:00Z', entity_id: 'ent-ata', deleted_at: null, status: 'Active' },
    ];

    const mockClientsQuery = (rows) => {
      const orderCalls = [];
      const selectSpy = jest.spyOn(supabaseAdmin, 'from').mockImplementation((table) => {
        if (table === 'clients') {
          const mock = createFluentMock(rows);
          mock.order = jest.fn().mockImplementation((col, opts) => {
            orderCalls.push({ col, opts });
            return mock;
          });
          mock.range = jest.fn().mockReturnValue(mock);
          mock.then = (resolve) => resolve({ data: rows, error: null, count: rows.length });
          return mock;
        }
        if (table === 'entities') return createFluentMock([{ id: 'ent-ata', code: 'ATA' }]);
        if (table === 'client_contact_details' || table === 'client_related_companies') {
          return createFluentMock([]);
        }
        return createFluentMock([]);
      });
      return { selectSpy, getOrderCalls: () => orderCalls };
    };

    it('defaults to sorting by client_number ascending with null/empty values placed last', async () => {
      const { selectSpy, getOrderCalls } = mockClientsQuery(sampleRows);
      const res = await clientsService.listClients({ entityId: 'ent-ata' });
      selectSpy.mockRestore();

      expect(getOrderCalls()[0]).toEqual({ col: 'client_number', opts: { ascending: true } });
      const ids = res.data.map((c) => c.id);
      expect(ids).toEqual(['c2', 'c1', 'c3', 'c4', 'c5']);
      expect(res.data[0].client_number).toBe('CLI-ATA-0001');
      expect(res.data[1].client_number).toBe('CLI-ATA-0002');
      expect(res.data[2].client_number).toBe('CLI-ATA-0010');
      expect(res.data[3].client_number).toBeNull();
      expect(res.data[4].client_number).toBeNull();
    });

    it('sorts by client_number descending with null/empty values placed last', async () => {
      const { selectSpy, getOrderCalls } = mockClientsQuery(sampleRows);
      const res = await clientsService.listClients({
        entityId: 'ent-ata',
        sortBy: 'client_number',
        sortOrder: 'desc',
      });
      selectSpy.mockRestore();

      expect(getOrderCalls()[0]).toEqual({ col: 'client_number', opts: { ascending: false } });
      const ids = res.data.map((c) => c.id);
      expect(ids).toEqual(['c3', 'c1', 'c2', 'c4', 'c5']);
    });

    it('sorts by name ascending', async () => {
      const { selectSpy, getOrderCalls } = mockClientsQuery(sampleRows);
      const res = await clientsService.listClients({
        entityId: 'ent-ata',
        sortBy: 'name',
        sortOrder: 'asc',
      });
      selectSpy.mockRestore();

      expect(getOrderCalls()[0]).toEqual({ col: 'name', opts: { ascending: true } });
      const ids = res.data.map((c) => c.id);
      expect(ids).toEqual(['c2', 'c4', 'c5', 'c3', 'c1']);
    });

    it('sorts by name descending', async () => {
      const { selectSpy, getOrderCalls } = mockClientsQuery(sampleRows);
      const res = await clientsService.listClients({
        entityId: 'ent-ata',
        sortBy: 'name',
        sortOrder: 'desc',
      });
      selectSpy.mockRestore();

      expect(getOrderCalls()[0]).toEqual({ col: 'name', opts: { ascending: false } });
      const ids = res.data.map((c) => c.id);
      expect(ids).toEqual(['c1', 'c3', 'c5', 'c4', 'c2']);
    });

    it('sorts by tin ascending with nulls placed last', async () => {
      const { selectSpy, getOrderCalls } = mockClientsQuery(sampleRows);
      const res = await clientsService.listClients({
        entityId: 'ent-ata',
        sortBy: 'tin',
        sortOrder: 'asc',
      });
      selectSpy.mockRestore();

      expect(getOrderCalls()[0]).toEqual({ col: 'tin', opts: { ascending: true } });
      const ids = res.data.map((c) => c.id);
      expect(ids).toEqual(['c2', 'c4', 'c3', 'c1', 'c5']);
    });

    it('sorts by tin descending with nulls placed last', async () => {
      const { selectSpy, getOrderCalls } = mockClientsQuery(sampleRows);
      const res = await clientsService.listClients({
        entityId: 'ent-ata',
        sortBy: 'tin',
        sortOrder: 'desc',
      });
      selectSpy.mockRestore();

      expect(getOrderCalls()[0]).toEqual({ col: 'tin', opts: { ascending: false } });
      const ids = res.data.map((c) => c.id);
      expect(ids).toEqual(['c1', 'c3', 'c4', 'c2', 'c5']);
    });

    it('sorts by created_at descending', async () => {
      const { selectSpy, getOrderCalls } = mockClientsQuery(sampleRows);
      const res = await clientsService.listClients({
        entityId: 'ent-ata',
        sortBy: 'created_at',
        sortOrder: 'desc',
      });
      selectSpy.mockRestore();

      expect(getOrderCalls()[0]).toEqual({ col: 'created_at', opts: { ascending: false } });
      const ids = res.data.map((c) => c.id);
      expect(ids).toEqual(['c5', 'c3', 'c2', 'c4', 'c1']);
    });

    it('sorts by rdo_code ascending with nulls placed last', async () => {
      const { selectSpy, getOrderCalls } = mockClientsQuery(sampleRows);
      const res = await clientsService.listClients({
        entityId: 'ent-ata',
        sortBy: 'rdo_code',
        sortOrder: 'asc',
      });
      selectSpy.mockRestore();

      expect(getOrderCalls()[0]).toEqual({ col: 'rdo_code', opts: { ascending: true } });
      const ids = res.data.map((c) => c.id);
      expect(ids).toEqual(['c2', 'c3', 'c1', 'c4', 'c5']);
      expect(res.data[0].rdoCode).toBe('034A');
      expect(res.data[1].rdoCode).toBe('044');
      expect(res.data[2].rdoCode).toBe('047');
      expect(res.data[3].rdoCode).toBeNull();
      expect(res.data[4].rdoCode).toBeNull();
    });

    it('sorts by rdo_code descending with nulls placed last', async () => {
      const { selectSpy, getOrderCalls } = mockClientsQuery(sampleRows);
      const res = await clientsService.listClients({
        entityId: 'ent-ata',
        sortBy: 'rdo_code',
        sortOrder: 'desc',
      });
      selectSpy.mockRestore();

      expect(getOrderCalls()[0]).toEqual({ col: 'rdo_code', opts: { ascending: false } });
      const ids = res.data.map((c) => c.id);
      expect(ids).toEqual(['c1', 'c3', 'c2', 'c4', 'c5']);
      expect(res.data[0].rdoCode).toBe('047');
      expect(res.data[1].rdoCode).toBe('044');
      expect(res.data[2].rdoCode).toBe('034A');
      expect(res.data[3].rdoCode).toBeNull();
      expect(res.data[4].rdoCode).toBeNull();
    });

    it('sorts by rdoCode alias identically to rdo_code', async () => {
      const { selectSpy, getOrderCalls } = mockClientsQuery(sampleRows);
      const res = await clientsService.listClients({
        entityId: 'ent-ata',
        sortBy: 'rdoCode',
        sortOrder: 'asc',
      });
      selectSpy.mockRestore();

      expect(getOrderCalls()[0]).toEqual({ col: 'rdo_code', opts: { ascending: true } });
      const ids = res.data.map((c) => c.id);
      expect(ids).toEqual(['c2', 'c3', 'c1', 'c4', 'c5']);
    });
  });
});
