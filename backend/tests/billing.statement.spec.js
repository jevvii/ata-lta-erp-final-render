jest.mock('../src/services/supabaseClient', () => ({
  supabaseAdmin: require('./fixtures/supabaseMock').supabaseAdmin,
}));
jest.mock('../src/services/pdfService', () => ({
  generatePdf: jest.fn(async () => Buffer.from('pdf')),
}));
jest.mock('../src/services/storageService', () => {
  const actual = jest.requireActual('../src/services/storageService');
  return { ...actual, uploadBuffer: jest.fn(actual.uploadBuffer) };
});
const request = require('supertest');
const { app } = require('./helpers/testServer');
const {
  registerUser,
  seedDefaults,
  resetMock,
  mockTables,
  mockStorageObjects,
} = require('./fixtures/supabaseMock');
const { generatePdf } = require('../src/services/pdfService');
const { uploadBuffer } = require('../src/services/storageService');
const {
  buildStatementDocument,
  getInvoicePrintDetails,
  resolvePaymentProperties,
} = require('../src/modules/billing/statementDocument');
const clientId = '11111111-1111-1111-1111-111111111111';
const workRequestId = '33333333-3333-3333-3333-333333333333';
const taskId = '44444444-4444-4444-4444-444444444444';
let admin, accounting, invoice;
const api = (token) =>
  request(app)
    .patch(`/v1/invoices/${invoice.id}`)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Active-Entity', 'ATA');
beforeEach(async () => {
  resetMock();
  seedDefaults();
  jest.clearAllMocks();
  mockTables.clients.set(clientId, {
    id: clientId,
    entity_id: 'ent-ata',
    name: 'Manila Trading',
    address: 'Manila',
  });
  const accountingId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  mockTables.work_requests.set(workRequestId, {
    id: workRequestId,
    entity_id: 'ent-ata',
    client_id: clientId,
    title: 'Audit',
    status: 'In Progress',
    co_assignees: [accountingId],
  });
  mockTables.tasks.set(taskId, {
    id: taskId,
    work_request_id: workRequestId,
    title: 'Audit Task',
    status: 'In Progress',
  });
  admin = registerUser({ email: 'admin@example.test', role: 'Admin', entities: ['ATA'] });
  accounting = registerUser({
    id: accountingId,
    email: 'accounting@example.test',
    role: 'Accounting',
    entities: ['ATA'],
  });
  const res = await request(app)
    .post('/v1/invoices')
    .set('Authorization', `Bearer ${admin}`)
    .set('X-Active-Entity', 'ATA')
    .send({
      clientId,
      workRequestId,
      taskId,
      invoiceNumber: 'ATA-100',
      issueDate: '2026-10-19',
      dueDate: '2026-11-19',
      lineItems: [{ description: 'Audit', amount: 1500 }],
    })
    .expect(201);
  invoice = res.body.data;
  mockTables.invoices.get(invoice.id).status = 'Sent';
});
it('persists admin line item and statement edits on a released invoice without mutating the client', async () => {
  const before = JSON.stringify(mockTables.clients.get(clientId));
  const details = {
    notedBy: 'Reyes & Cruz',
    preparedBy: 'M. Santos',
    receivedBy: 'L. Tan',
    bankBranch: 'BDO Manila',
    cash: '',
  };
  const res = await api(admin)
    .send({
      lineItems: [{ description: 'Revised audit', amount: 1800 }],
      printDetails: details,
      expectedVersion: invoice.version,
    })
    .expect(200);
  expect(res.body.data.total).toBe(1800);
  expect(res.body.data.balance).toBe(1800);
  expect(res.body.data.print_details).toEqual(details);
  expect(res.body.data.version).toBe(invoice.version + 1);
  expect(JSON.stringify(mockTables.clients.get(clientId))).toBe(before);
});
it('rejects non-admin statement edits, including a mixed authorized address payload', async () => {
  await api(accounting)
    .send({
      address: 'New address',
      printDetails: { notedBy: 'Spoofed' },
      expectedVersion: invoice.version,
    })
    .expect(403);
  expect(mockTables.invoices.get(invoice.id).print_details).toBeUndefined();
});
it('continues to restrict released financial edits for non-admins', async () => {
  await api(accounting)
    .send({ lineItems: [{ description: 'Changed', amount: 2 }], expectedVersion: invoice.version })
    .expect(409);
});
it('rejects missing and stale versions without changing line items or statement details', async () => {
  await api(admin)
    .send({ printDetails: { notedBy: 'Changed' } })
    .expect(400);
  await api(admin)
    .send({
      printDetails: { notedBy: 'Changed' },
      lineItems: [{ description: 'Changed', amount: 99 }],
      expectedVersion: invoice.version + 1,
    })
    .expect(409);
  expect(mockTables.invoices.get(invoice.id).total).toBe(1500);
  expect(mockTables.invoices.get(invoice.id).print_details).toBeUndefined();
  expect(
    [...mockTables.invoice_line_items.values()].find((li) => li.invoice_id === invoice.id)
      .description
  ).toBe('Audit');
});
it('rejects lowering a total below recorded payments', async () => {
  mockTables.invoices.get(invoice.id).amount_paid = 1000;
  await api(admin)
    .send({
      lineItems: [{ description: 'Changed', amount: 500 }],
      expectedVersion: invoice.version,
    })
    .expect(400);
  expect(mockTables.invoices.get(invoice.id).total).toBe(1500);
});
it.each(['true', 'false'])(
  'generates the canonical PDF with includeCompanyDetails=%s and a stable invoice-number storage path',
  async (toggle) => {
    const stored = mockTables.invoices.get(invoice.id);
    stored.print_details = {
      preparedBy: 'M. Santos',
      receivedBy: 'L. Tan',
      bankBranch: '<script>bad</script>',
    };
    const getPdf = () =>
      request(app)
        .get(`/v1/invoices/${invoice.id}/pdf?includeCompanyDetails=${toggle}`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA');
    await getPdf().expect(200);
    const html = generatePdf.mock.calls[0][0].html;
    expect(html).toContain('M. Santos');
    expect(html).toContain('L. Tan');
    expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(html.includes('<img')).toBe(toggle === 'true');
    expect(html.includes('A.T.A. BUSINESS CONSULTANCY')).toBe(toggle === 'true');
    expect(html).toContain('@page { size: A4; margin: 15mm 20mm; }');
    expect(generatePdf.mock.calls[0][0].options.preferCSSPageSize).toBe(true);
    if (toggle === 'true') expect(html).toContain('data:image/jpeg;base64,');
    await getPdf().expect(200);
    const suffix = toggle === 'true' ? '' : '-no-company-details';
    const expectedPath = `entities/ATA/invoices/${invoice.id}/pdf/ATA-100${suffix}.pdf`;
    expect(uploadBuffer.mock.calls[0][0].path).toBe(expectedPath);
    expect(uploadBuffer.mock.calls[1][0].path).toBe(expectedPath);
    expect(mockStorageObjects.size).toBe(1);
  }
);
it.each([true, false])(
  'replaces regenerated files while preserving the other branding variant (first branded=%s)',
  async (firstBranded) => {
    const brandedPath = `entities/ATA/invoices/${invoice.id}/pdf/ATA-100.pdf`;
    const plainPath = `entities/ATA/invoices/${invoice.id}/pdf/ATA-100-no-company-details.pdf`;
    const firstPath = firstBranded ? brandedPath : plainPath;
    const otherPath = firstBranded ? plainPath : brandedPath;
    const getPdf = (includeCompanyDetails) =>
      request(app)
        .get(
          `/v1/invoices/${invoice.id}/pdf${includeCompanyDetails ? '' : '?includeCompanyDetails=false'}`
        )
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA');
    generatePdf
      .mockResolvedValueOnce(Buffer.from('first version'))
      .mockResolvedValueOnce(Buffer.from('other variant'))
      .mockResolvedValueOnce(Buffer.from('replacement'));
    await getPdf(firstBranded).expect(200);
    await getPdf(!firstBranded).expect(200);
    await getPdf(firstBranded).expect(200);
    expect(mockStorageObjects.size).toBe(2);
    expect(mockStorageObjects.get(firstPath).buffer).toEqual(Buffer.from('replacement'));
    expect(mockStorageObjects.get(otherPath).buffer).toEqual(Buffer.from('other variant'));
  }
);
it('validates the PDF toggle', async () => {
  await request(app)
    .get(`/v1/invoices/${invoice.id}/pdf?includeCompanyDetails=maybe`)
    .set('Authorization', `Bearer ${admin}`)
    .set('X-Active-Entity', 'ATA')
    .expect(400);
});
it.each(['ATA', 'LTA'])('escapes statement values and omits branding for %s', (entity) => {
  const html = buildStatementDocument(
    {
      ...invoice,
      entity_code: entity,
      clients: { name: '<svg onload=alert(1)>' },
      print_details: { notedBy: '<img src=x>', receivedBy: 'L. Tan' },
    },
    { includeCompanyDetails: false }
  );
  expect(html).not.toContain('<img');
  expect(html).not.toContain('<svg');
  expect(html).toContain('&lt;img src=x&gt;');
  expect(html).toContain('L. Tan');
});
it.each(['ATA', 'LTA'])(
  'omits the billing inquiry footer for %s in both branding modes',
  (entity) => {
    for (const includeCompanyDetails of [true, false]) {
      const html = buildStatementDocument(
        { ...invoice, entity_code: entity },
        { includeCompanyDetails }
      );
      expect(html).not.toMatch(/Should you have any (?:enquiries|inquiries)/i);
      expect(html).toContain('THANK YOU !!!');
    }
  }
);
describe('STATEMENT-DETAILS-20261025 canonical payments, overrides, and fail-fast child queries', () => {
  const pay = (data) =>
    request(app)
      .post(`/v1/invoices/${invoice.id}/payments`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(data);

  it.each([
    ['Cash', 'REF-1', '₱500.00', '', ''],
    ['Check', 'CHK-8899', '', 'CHK-8899', ''],
    ['Bank Transfer', 'BT-4455', '₱500.00', 'BT-4455', 'Bank Transfer'],
  ])(
    'exercises canonical %s payment and verifies details and statement document agreement',
    async (method, reference, expectedCash, expectedCheck, expectedBank) => {
      await pay({ amount: 500, method, reference, date: '2026-10-25' }).expect(201);
      const res = await request(app)
        .get(`/v1/invoices/${invoice.id}`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const d = getInvoicePrintDetails(res.body.data);
      expect(d.cash).toBe(expectedCash);
      expect(d.checkNumber).toBe(expectedCheck);
      expect(d.bankBranch).toBe(expectedBank);
      expect(d.paymentDate).toBe('Oct 25, 2026');

      const doc = buildStatementDocument(res.body.data);
      expect(doc).toContain('Oct 25, 2026');
      if (expectedCheck) {
        expect(doc).toContain(expectedCheck);
      }
      if (expectedCash) {
        expect(doc).toContain(expectedCash);
      }
      if (expectedBank) {
        expect(doc).toContain(expectedBank);
      }
    }
  );

  it('preserves empty method handling with no inferred cash, check, or bank', async () => {
    const inv = {
      ...invoice,
      payments: [{ amount: 500, method: '', reference: 'REF', payment_date: '2026-10-25' }],
    };
    const details = getInvoicePrintDetails(inv);
    expect(details.cash).toBe('');
    expect(details.checkNumber).toBe('');
    expect(details.bankBranch).toBe('');
    expect(details.paymentDate).toBe('Oct 25, 2026');
  });

  it('supports legacy alias fallbacks and enforces canonical non-nullish precedence', () => {
    // Canonical Check beats legacy alias
    const inv = {
      ...invoice,
      payments: [
        {
          amount: 500,
          method: 'Check',
          reference: 'CANONICAL-CHK',
          payment_method: 'Cash',
          reference_number: 'LEGACY-REF',
          payment_date: '2026-10-25',
        },
      ],
    };
    const d1 = getInvoicePrintDetails(inv);
    expect(d1.cash).toBe('');
    expect(d1.checkNumber).toBe('CANONICAL-CHK');
    expect(resolvePaymentProperties(inv.payments[0]).method).toBe('Check');
    expect(resolvePaymentProperties(inv.payments[0]).reference).toBe('CANONICAL-CHK');

    // Legacy fallback used when canonical is omitted
    const legacyOnly = {
      ...invoice,
      payments: [
        {
          amount: 500,
          payment_method: 'Check',
          reference_number: 'LEGACY-CHK',
          payment_date: '2026-10-25',
        },
      ],
    };
    const d2 = getInvoicePrintDetails(legacyOnly);
    expect(d2.cash).toBe('');
    expect(d2.checkNumber).toBe('LEGACY-CHK');

    // Explicit empty string wins over legacy alias
    const explicitEmpty = {
      ...invoice,
      payments: [
        {
          amount: 500,
          method: '',
          reference: '',
          payment_method: 'Check',
          reference_number: 'LEGACY-CHK',
          payment_date: '2026-10-25',
        },
      ],
    };
    const d3 = getInvoicePrintDetails(explicitEmpty);
    expect(d3.cash).toBe('');
    expect(d3.checkNumber).toBe('');
  });

  it('handles sparse overrides, deliberate blanks, and resetting to automatic defaults', async () => {
    // Set custom override and intentional blank
    await api(admin)
      .send({
        printDetails: { paymentDate: '', checkNumber: 'CUSTOM-CHK', preparedBy: 'Auditor A' },
        expectedVersion: invoice.version,
      })
      .expect(200);

    await pay({ amount: 500, method: 'Check', reference: 'AUTO-CHK', date: '2026-10-25' }).expect(201);

    let res = await request(app)
      .get(`/v1/invoices/${invoice.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    let d = getInvoicePrintDetails(res.body.data);
    expect(d.paymentDate).toBe('');
    expect(d.checkNumber).toBe('CUSTOM-CHK');
    expect(d.preparedBy).toBe('Auditor A');

    // Reset to automatic with empty object {}
    await api(admin)
      .send({
        printDetails: {},
        expectedVersion: res.body.data.version,
      })
      .expect(200);

    res = await request(app)
      .get(`/v1/invoices/${invoice.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    d = getInvoicePrintDetails(res.body.data);
    expect(d.paymentDate).toBe('Oct 25, 2026');
    expect(d.checkNumber).toBe('AUTO-CHK');
    expect(d.preparedBy).toBe('');
    expect(d.notedBy).toBe('HENRY WONG');
  });

  it.each([
    ['invoice_payments', ''],
    ['invoice_payments', '/pdf'],
    ['invoice_payments', '/voucher'],
    ['invoice_line_items', ''],
    ['invoice_line_items', '/pdf'],
    ['invoice_line_items', '/voucher'],
  ])(
    'rejects child-query failure on %s for endpoint %s before renderer or storage',
    async (table, suffix) => {
      const originalFrom = require('../src/services/supabaseClient').supabaseAdmin.from.bind(
        require('../src/services/supabaseClient').supabaseAdmin
      );
      const fromSpy = jest
        .spyOn(require('../src/services/supabaseClient').supabaseAdmin, 'from')
        .mockImplementation((t) =>
          t !== table
            ? originalFrom(t)
            : {
                select() {
                  return this;
                },
                eq() {
                  return this;
                },
                async order() {
                  return { data: null, error: { message: `Simulated error in ${table}` } };
                },
              }
        );

      try {
        await request(app)
          .get(`/v1/invoices/${invoice.id}${suffix}`)
          .set('Authorization', `Bearer ${admin}`)
          .set('X-Active-Entity', 'ATA')
          .expect(500);

        expect(generatePdf).not.toHaveBeenCalled();
        expect(uploadBuffer).not.toHaveBeenCalled();
      } finally {
        fromSpy.mockRestore();
      }
    }
  );
});
