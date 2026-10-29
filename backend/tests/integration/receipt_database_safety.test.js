jest.mock('../../src/services/supabaseClient', () => ({ supabaseAdmin: {} }));
const driver = require('../../src/modules/disbursements/receiptStoreDatabase');
const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  entityId: '22222222-2222-4222-8222-222222222222',
  receiptS3Key: 'entities/ATA/receipt.png',
};
const record = (extra = {}) => ({
  uploadId: 'upload',
  objectKey: actor.receiptS3Key,
  userId: actor.userId,
  entityId: actor.entityId,
  filename: 'receipt.png',
  contentType: 'image/png',
  size: 16,
  status: 'claimed',
  claimId: 'claim',
  expiresAt: new Date(Date.now() + 900000).toISOString(),
  createdAt: new Date().toISOString(),
  ...extra,
});
const unavailable = { statusCode: 503, code: 'RECEIPT_STORE_DATABASE_UNAVAILABLE' };
afterEach(() => {
  driver.setDatabaseClient(null);
  jest.restoreAllMocks();
});
it.each([
  {},
  [],
  true,
  2,
  undefined,
  { data: {} },
  { data: [] },
  { data: record(), claimId: 'wrong' },
  { data: record({ userId: 'wrong' }), claimId: 'claim' },
  { data: record({ entityId: 'wrong' }), claimId: 'claim' },
  { data: record({ objectKey: 'wrong' }), claimId: 'claim' },
  { data: record({ expiresAt: 'bad' }), claimId: 'claim' },
])('rejects malformed claim output %# before authorizing a voucher', async (result) => {
  driver.setDatabaseClient({ rpc: async () => ({ data: result }) });
  await expect(driver.claimReservationByKey(actor)).rejects.toMatchObject(unavailable);
});
it('accepts a complete matching claimed record and token', async () => {
  driver.setDatabaseClient({ rpc: async () => ({ data: { data: record(), claimId: 'claim' } }) });
  expect((await driver.claimReservationByKey(actor)).claimId).toBe('claim');
});
it.each([{ error: { message: 'SQL internal host' } }, {}, { data: undefined }])(
  'rejects invalid RPC envelope %#',
  async (response) => {
    driver.setDatabaseClient({ rpc: async () => response });
    await expect(driver.getReservation('upload')).rejects.toMatchObject(unavailable);
  }
);
const selection = {
  scanned: 1,
  skippedConsumed: 0,
  skippedActiveClaims: 0,
  prunedConsumedRecords: 0,
  candidates: [{ uploadId: 'upload', objectKey: actor.receiptS3Key, status: 'deleting' }],
};
const clientFor = ({
  linkage = [],
  linkageError = null,
  finalize = { ok: true },
  selectionResult = selection,
} = {}) => {
  const rpc = jest.fn(async (name) => ({
    data: name.endsWith('_select') ? selectionResult : finalize,
  }));
  const db = {
    rpc,
    from: () => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      limit: async () => ({ data: linkage, error: linkageError }),
    }),
  };
  return db;
};
it.each(['returned-error', 'thrown-error', 'null-result', 'malformed-selection'])(
  'never deletes on %s',
  async (failure) => {
    const db = clientFor(
      failure === 'returned-error'
        ? { linkageError: { message: 'offline' } }
        : failure === 'null-result'
          ? { linkage: null }
          : failure === 'malformed-selection'
            ? { selectionResult: { ...selection, candidates: [{}] } }
            : {}
    );
    if (failure === 'thrown-error')
      db.from = () => {
        throw new Error('offline');
      };
    const storage = { deleteObject: jest.fn() };
    if (failure === 'malformed-selection')
      await expect(driver.cleanupExpiredReservations({ db, storage })).rejects.toMatchObject(
        unavailable
      );
    else expect((await driver.cleanupExpiredReservations({ db, storage })).errors).toHaveLength(1);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  }
);
it('preserves linked receipts and records consumption', async () => {
  const db = clientFor({ linkage: [{ id: 'voucher' }] });
  const storage = { deleteObject: jest.fn() };
  const result = await driver.cleanupExpiredReservations({ db, storage });
  expect(result.linkedToVoucher).toBe(1);
  expect(storage.deleteObject).not.toHaveBeenCalled();
  expect(db.rpc).toHaveBeenCalledWith(
    'receipt_reservation_cleanup_finalize',
    expect.objectContaining({ p_action: 'linked' })
  );
});
it('dry run never finalizes or deletes objects', async () => {
  const db = clientFor();
  const storage = { deleteObject: jest.fn() };
  await driver.cleanupExpiredReservations({ db, storage, dryRun: true });
  expect(storage.deleteObject).not.toHaveBeenCalled();
  expect(db.rpc).toHaveBeenCalledTimes(1);
  expect(db.rpc).toHaveBeenCalledWith(
    'receipt_reservation_cleanup_select',
    expect.objectContaining({ p_dry_run: true })
  );
});
it('retains failed deletes for retry and does not count them as cleaned', async () => {
  const db = clientFor();
  const storage = { deleteObject: jest.fn().mockRejectedValue(new Error('offline')) };
  const result = await driver.cleanupExpiredReservations({ db, storage });
  expect(result.cleaned).toBe(0);
  expect(result.errors).toHaveLength(1);
  expect(db.rpc).toHaveBeenCalledWith(
    'receipt_reservation_cleanup_finalize',
    expect.objectContaining({ p_action: 'failed' })
  );
});
it('reports failed finalization instead of counting an unpersisted success', async () => {
  const db = clientFor({ finalize: {} });
  const result = await driver.cleanupExpiredReservations({
    db,
    storage: { deleteObject: jest.fn().mockResolvedValue() },
  });
  expect(result.cleaned).toBe(0);
  expect(result.errors).toHaveLength(1);
});
it.each([{ ok: 'true' }, { ok: 1 }, {}, null])('rejects nonboolean readiness %#', async (data) => {
  driver.setDatabaseClient({ rpc: async () => ({ data }) });
  expect((await driver.checkReadiness()).ok).toBe(false);
});
