jest.mock('../../src/services/supabaseClient', () => ({
  supabaseAdmin: require('../fixtures/supabaseMock').supabaseAdmin,
}));
const fs = require('fs');
const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, resetMock, seedDefaults, mockTables } = require('../fixtures/supabaseMock');
const reservations = require('../../src/modules/disbursements/receiptReservationStore');
const OWNER = '99999999-9999-4999-8999-999999999999';
const WR = '33333333-3333-4333-8333-333333333333';
const TASK = '44444444-4444-4444-4444-444444444444';
let token;
const send = (method, url, body) =>
  request(app)
    [method](url)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Active-Entity', 'ATA')
    .send(body);
beforeEach(() => {
  resetMock();
  seedDefaults();
  reservations.clearReservations();
  token = registerUser({
    id: OWNER,
    email: 'receipt-failure@example.test',
    name: 'Admin',
    role: 'Admin',
    entities: ['ATA'],
  });
  mockTables.work_requests.set(WR, { id: WR, entity_id: 'ent-ata', title: 'WR' });
  mockTables.tasks.set(TASK, { id: TASK, work_request_id: WR, title: 'Task', status: 'In Progress' });
  reservations.createReservation({
    uploadId: 'failure',
    objectKey: 'verified-key',
    userId: OWNER,
    entityId: 'ent-ata',
    filename: 'receipt.pdf',
    size: 10,
    contentType: 'application/pdf',
  });
  reservations.completeReservation('failure', { userId: OWNER, entityId: 'ent-ata' });
});
afterEach(() => jest.restoreAllMocks());
it.each(['create', 'update'])(
  'preserves the committed voucher and binding claim when %s consumption cannot persist',
  async (operation) => {
    const id = 'existing';
    if (operation === 'update')
      mockTables.disbursements.set(id, {
        id,
        entity_id: 'ent-ata',
        status: 'Draft',
        version: 1,
        created_by: OWNER,
        requested_by: OWNER,
        amount: 5,
        description: 'Before',
        linked_work_request_id: WR,
        task_id: TASK,
        linked_task_id: TASK,
      });
    const rename = fs.renameSync;
    jest.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (
        destination === reservations.getStorePath() &&
        JSON.parse(fs.readFileSync(source, 'utf8')).failure?.status === 'consumed'
      ) {
        throw new Error('disk full at consume');
      }
      return rename(source, destination);
    });
    const payload = {
      category: 'Meals',
      description: 'Committed change',
      amount: 100,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR,
      linkedTaskId: TASK,
      receiptS3Key: 'verified-key',
      receiptFilename: 'receipt.pdf',
      ...(operation === 'update' ? { expectedVersion: 1 } : {}),
    };
    const response = await send(
      operation === 'create' ? 'post' : 'put',
      operation === 'create' ? '/v1/disbursements' : `/v1/disbursements/${id}`,
      payload
    );
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('RECEIPT_STORE_IO_ERROR');
    const bound = Array.from(mockTables.disbursements.values()).filter(
      (row) => row.receipt_s3_key === 'verified-key'
    );
    expect(bound).toHaveLength(1);
    expect(bound[0].description).toBe('Committed change');
    expect(bound[0].amount).toBe(100);
    expect(reservations.getReservation('failure').status).toBe('claimed');
    expect(
      reservations.claimReservationByKey({
        receiptS3Key: 'verified-key',
        userId: OWNER,
        entityId: 'ent-ata',
      }).error
    ).toBe('ALREADY_CLAIMED');
    const storage = { deleteObject: jest.fn() };
    await reservations.cleanupExpiredReservations({
      now: new Date(Date.now() + 86400000),
      storage,
    });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  }
);

it.each([
  ['40003', 'claimed'], // statement completion unknown
  ['08007', 'claimed'], // transaction resolution unknown
  ['23514', 'completed'], // definite check constraint rejection
])('handles database outcome %s without releasing an uncertain claim', async (code, status) => {
  const { supabaseAdmin } = require('../../src/services/supabaseClient');
  const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
  jest.spyOn(supabaseAdmin, 'from').mockImplementation((table) => {
    const query = originalFrom(table);
    if (table === 'disbursements') {
      query.insert = () => ({
        select: () => ({
          single: async () => ({
            data: null,
            error: { code, message: 'injected database outcome' },
          }),
        }),
      });
    }
    return query;
  });
  const response = await send('post', '/v1/disbursements', {
    category: 'Meals',
    description: 'Uncertain receipt binding',
    amount: 100,
    fundSource: 'Firm Fund',
    linkedWorkRequestId: WR,
    linkedTaskId: TASK,
    receiptS3Key: 'verified-key',
    receiptFilename: 'receipt.pdf',
  });
  expect(response.status).toBe(500);
  expect(reservations.getReservation('failure').status).toBe(status);
});
