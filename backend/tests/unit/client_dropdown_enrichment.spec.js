const operationsService = require('../../src/modules/operations/service');
const billingService = require('../../src/modules/billing/service');
const transmittalsService = require('../../src/modules/transmittals/service');
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
});
