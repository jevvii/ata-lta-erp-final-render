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
const clientId = '11111111-1111-1111-1111-111111111111';
const wrId = '33333333-3333-3333-3333-333333333333';
let admin, accounting, other, voucher;
const api = (method, path, token = admin, entity = 'ATA') =>
  request(app)[method](path).set('Authorization', `Bearer ${token}`).set('X-Active-Entity', entity);
beforeEach(async () => {
  resetMock();
  seedDefaults();
  jest.clearAllMocks();
  const accountingId = '22222222-2222-4222-8222-222222222222';
  mockTables.clients.set(clientId, { id: clientId, entity_id: 'ent-ata', name: 'Manila Trading' });
  mockTables.work_requests.set(wrId, {
    id: wrId,
    entity_id: 'ent-ata',
    client_id: clientId,
    title: 'Audit',
    status: 'In Progress',
    co_assignees: [accountingId],
  });
  admin = registerUser({
    name: 'Maria Santos',
    email: 'admin@example.test',
    role: 'Admin',
    entities: ['ATA', 'LTA'],
  });
  accounting = registerUser({
    id: accountingId,
    name: 'Accountant',
    email: 'acct@example.test',
    role: 'Accounting',
    entities: ['ATA'],
  });
  other = registerUser({
    name: 'Other',
    email: 'other@example.test',
    role: 'Operations',
    entities: ['ATA'],
  });
  const res = await api('post', '/v1/disbursements')
    .send({
      category: 'Transportation',
      description: 'Site visit',
      amount: 1500,
      fundSource: 'Firm Fund',
      clientId,
      linkedWorkRequestId: wrId,
    })
    .expect(201);
  voucher = res.body.data;
  Object.assign(mockTables.disbursements.get(voucher.id), {
    status: 'Released',
    payment_method: 'Check',
    payment_reference: 'CHK-123',
    payment_bank: 'BDO',
    payment_date: '2026-10-15',
    released_at: '2026-10-19T08:00:00Z',
  });
});
it.each([
  ['', true, true, ''],
  ['?noLogo=true', false, true, '-no-logo'],
  ['?includeCompanyDetails=false', false, false, '-no-company-details'],
  ['?noLogo=true&includeCompanyDetails=false', false, false, '-no-company-details'],
])(
  'generates the canonical PDF at a stable variant key (%s)',
  async (query, hasLogo, hasCompany, suffix) => {
    const path = `/v1/disbursements/${voucher.id}/pdf${query}`;
    await api('get', path).expect(200);
    await api('get', path).expect(200);
    const html = generatePdf.mock.calls[0][0].html;
    expect(html.includes('<img')).toBe(hasLogo);
    expect(html.includes('ATA Accounting Services Firm')).toBe(hasCompany);
    if (hasLogo) expect(html).toContain('data:image/jpeg;base64,');
    expect(html).toContain('Expense Report');
    expect(html).toContain('Payment Voucher');
    expect(html).not.toContain('THANK YOU');
    expect(html).not.toContain('Official Internal Payment Authorization');
    expect(html).not.toContain('voucher-footer');
    expect(html).toContain('2026-10-15');
    expect(html).toContain('CHK-123');
    expect(html).toContain('@page { size: A4; margin: 15mm 20mm; }');
    expect(generatePdf.mock.calls[0][0].options.preferCSSPageSize).toBe(true);
    expect(uploadBuffer.mock.calls[0][0].path).toBe(
      `entities/ATA/disbursements/${voucher.id}/pdf/${voucher.disbursement_number}${suffix}.pdf`
    );
    expect(uploadBuffer.mock.calls[1][0].path).toBe(uploadBuffer.mock.calls[0][0].path);
    expect(mockStorageObjects.size).toBe(1);
  }
);
it.each(['ATA', 'LTA'])(
  'uses the voucher entity for storage and branding when active entity is ALL (%s)',
  async (entity) => {
    const ltaClientId = '11111111-1111-1111-1111-111111111112';
    const ltaWrId = '33333333-3333-3333-3333-333333333334';
    mockTables.clients.set(ltaClientId, { id: ltaClientId, entity_id: 'ent-lta', name: 'LTA Manila Trading' });
    mockTables.work_requests.set(ltaWrId, {
      id: ltaWrId,
      entity_id: 'ent-lta',
      client_id: ltaClientId,
      title: 'LTA Audit',
      status: 'In Progress',
    });
    Object.assign(mockTables.disbursements.get(voucher.id), {
      entity_id: entity === 'ATA' ? 'ent-ata' : 'ent-lta',
      client_id: entity === 'ATA' ? clientId : ltaClientId,
      linked_work_request_id: entity === 'ATA' ? wrId : ltaWrId,
      disbursement_number: `${entity}-100`,
    });
    await api('get', `/v1/disbursements/${voucher.id}/pdf`, admin, 'ALL').expect(200);
    expect(generatePdf.mock.calls[0][0].html).toContain(`${entity} Accounting Services Firm`);
    expect(uploadBuffer.mock.calls[0][0].path).toBe(
      `entities/${entity}/disbursements/${voucher.id}/pdf/${entity}-100.pdf`
    );
  }
);
it('keeps all three variants separate and replaces regenerated bytes', async () => {
  const url = `/v1/disbursements/${voucher.id}/pdf`;
  generatePdf
    .mockResolvedValueOnce(Buffer.from('branded'))
    .mockResolvedValueOnce(Buffer.from('generic'))
    .mockResolvedValueOnce(Buffer.from('plain'))
    .mockResolvedValueOnce(Buffer.from('branded-updated'));
  await api('get', url).expect(200);
  await api('get', url + '?noLogo=true').expect(200);
  await api('get', url + '?includeCompanyDetails=false').expect(200);
  await api('get', url).expect(200);
  expect(mockStorageObjects.size).toBe(3);
  const prefix = `entities/ATA/disbursements/${voucher.id}/pdf/${voucher.disbursement_number}`;
  expect(mockStorageObjects.get(prefix + '.pdf').buffer).toEqual(Buffer.from('branded-updated'));
  expect(mockStorageObjects.get(prefix + '-no-logo.pdf').buffer).toEqual(Buffer.from('generic'));
  expect(mockStorageObjects.get(prefix + '-no-company-details.pdf').buffer).toEqual(
    Buffer.from('plain')
  );
});
it.each(['noLogo=maybe', 'includeCompanyDetails=0'])(
  'rejects invalid PDF options (%s)',
  async (query) => {
    await api('get', `/v1/disbursements/${voucher.id}/pdf?${query}`).expect(400);
  }
);
it('enforces PDF ownership and entity scope', async () => {
  await api('get', `/v1/disbursements/${voucher.id}/pdf`, other).expect(403);
  await api('get', `/v1/disbursements/${voucher.id}/pdf`, admin, 'LTA').expect(404);
  await request(app).get(`/v1/disbursements/${voucher.id}/pdf`).expect(401);
  expect(generatePdf).not.toHaveBeenCalled();
});
it('allows admin corrections with version checks and preserves approval/requester identities', async () => {
  const original = { ...mockTables.disbursements.get(voucher.id) };
  const printDetails = {
    requesterName: 'M. Santos',
    paymentBank: '<img src=x>',
    preparedBy: 'P. Cruz',
    approvedBy: 'A. Reyes',
    releasedBy: 'R. Tan',
  };
  const res = await api('put', `/v1/disbursements/${voucher.id}`)
    .send({ printDetails, expectedVersion: voucher.version })
    .expect(200);
  expect(res.body.data.amount).toBe(original.amount);
  expect(res.body.data.print_details).toEqual(printDetails);
  expect(res.body.data.version).toBe(voucher.version + 1);
  expect(res.body.data.status).toBe('Released');
  const stored = mockTables.disbursements.get(voucher.id);
  for (const key of [
    'requested_by',
    'created_by',
    'employee_id',
    'approved_by',
    'released_by',
    'payment_bank',
  ])
    expect(stored[key]).toBe(original[key]);
  await api('get', `/v1/disbursements/${voucher.id}/pdf`).expect(200);
  expect(generatePdf.mock.calls[0][0].html).toContain('&lt;img src=x&gt;');
  expect(generatePdf.mock.calls[0][0].html).toContain('P. Cruz');
});
it('rejects stale corrections without changing fields or signatures', async () => {
  await api('put', `/v1/disbursements/${voucher.id}`)
    .send({
      amount: 2000,
      printDetails: { preparedBy: 'Stale' },
      expectedVersion: voucher.version + 1,
    })
    .expect(409);
  expect(mockTables.disbursements.get(voucher.id).amount).toBe(1500);
  expect(mockTables.disbursements.get(voucher.id).print_details).toBeUndefined();
});
it('requires a version for both printed details and released financial corrections', async () => {
  await api('put', `/v1/disbursements/${voucher.id}`)
    .send({ printDetails: { preparedBy: 'Missing version' } })
    .expect(400);
  await api('put', `/v1/disbursements/${voucher.id}`).send({ amount: 2000 }).expect(400);
});
it('keeps non-admin edits restricted', async () => {
  await api('put', `/v1/disbursements/${voucher.id}`, accounting)
    .send({ amount: 2000, expectedVersion: voucher.version })
    .expect(409);
  mockTables.disbursements.get(voucher.id).status = 'Draft';
  await api('put', `/v1/disbursements/${voucher.id}`, accounting)
    .send({ printDetails: { preparedBy: 'Spoofed' }, expectedVersion: voucher.version })
    .expect(403);
});
it('rejects unknown, oversized, or mixed workflow snapshot payloads', async () => {
  for (const printDetails of [{ preparedBy: 'x'.repeat(501) }, { approved_by: 'spoofed-uuid' }]) {
    await api('put', `/v1/disbursements/${voucher.id}`)
      .send({ printDetails, expectedVersion: voucher.version })
      .expect(400);
  }
  await api('put', `/v1/disbursements/${voucher.id}`)
    .send({
      status: 'Approved',
      printDetails: { preparedBy: 'Wrong flow' },
      expectedVersion: voucher.version,
    })
    .expect(400);
});
