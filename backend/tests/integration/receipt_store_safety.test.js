jest.mock('../../src/services/supabaseClient', () => ({ supabaseAdmin: { from: jest.fn() } }));
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const store = require('../../src/modules/disbursements/receiptReservationStore');
const { supabaseAdmin } = require('../../src/services/supabaseClient');
const actor = { userId: 'actor', entityId: 'entity' };
const dbResult = (data, error = null) => ({
  select() {
    return this;
  },
  eq() {
    return this;
  },
  limit: async () => ({ data, error }),
});
let dir;
const workers = [];
const originalPath = store.getStorePath();
function seed(id, expiresInSeconds = -1) {
  return store.createReservation({
    uploadId: id,
    objectKey: id,
    ...actor,
    filename: 'r.pdf',
    size: 5,
    contentType: 'application/pdf',
    expiresInSeconds,
  });
}
function worker() {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, '../fixtures/receiptStoreWorker.js'), [], {
      env: { ...process.env, RESERVATION_STORE_PATH: store.getStorePath() },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    workers.push(child);
    child.once('error', reject);
    child.once('message', () => resolve(child));
  });
}
function call(child, action, input) {
  return new Promise((resolve) => {
    child.once('message', resolve);
    child.send({ action, input });
  });
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-safety-'));
  store.setStorePath(path.join(dir, 'reservations.json'));
  supabaseAdmin.from.mockReset().mockImplementation(() => dbResult([]));
});
afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(
    workers.splice(0).map(
      (child) =>
        new Promise((resolve) => {
          child.once('exit', resolve);
          child.kill();
        })
    )
  );
  store.setStorePath(originalPath);
  fs.rmSync(dir, { recursive: true, force: true });
});
it('default cleanup uses the configured database and preserves linked receipts', async () => {
  seed('linked');
  supabaseAdmin.from.mockImplementation(() => dbResult([{ id: 'voucher' }]));
  const storage = { deleteObject: jest.fn() };
  const result = await store.cleanupExpiredReservations({ storage });
  expect(supabaseAdmin.from).toHaveBeenCalledWith('disbursements');
  expect(result.linkedToVoucher).toBe(1);
  expect(storage.deleteObject).not.toHaveBeenCalled();
  expect(store.getReservation('linked').status).toBe('consumed');
});
it.each(['returned', 'thrown', 'missing', 'invalid'])(
  'retains receipts when database verification is %s',
  async (failure) => {
    seed('unverified');
    if (failure === 'returned')
      supabaseAdmin.from.mockImplementation(() => dbResult(null, { message: 'offline' }));
    if (failure === 'thrown')
      supabaseAdmin.from.mockImplementation(() => {
        throw new Error('offline');
      });
    if (failure === 'invalid') supabaseAdmin.from.mockImplementation(() => dbResult(null));
    const storage = { deleteObject: jest.fn() };
    const result = await store.cleanupExpiredReservations({
      storage,
      ...(failure === 'missing' ? { db: null } : {}),
    });
    expect(result.errors).toHaveLength(1);
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(store.getStorePath())).unverified.status).toBe(
      'cleanup_failed'
    );
  }
);
it('marks deletion intent before await; another worker cannot complete or bind the key', async () => {
  seed('deleting', 900);
  store.completeReservation('deleting', actor);
  let unblock;
  supabaseAdmin.from.mockImplementation(() => ({
    select() {
      return this;
    },
    eq() {
      return this;
    },
    limit: () =>
      new Promise((resolve) => {
        unblock = resolve;
      }),
  }));
  const storage = { deleteObject: jest.fn().mockResolvedValue() };
  const cleanup = store.cleanupExpiredReservations({ now: new Date(Date.now() + 901000), storage });
  const child = await worker();
  const result = await call(child, 'claimReservationByKey', { receiptS3Key: 'deleting', ...actor });
  expect(result.result.error).toBe('NOT_COMPLETED');
  expect(store.completeReservation('deleting', actor).error).toBe('CLEANUP_IN_PROGRESS');
  unblock({ data: [], error: null });
  await cleanup;
  expect(storage.deleteObject).toHaveBeenCalledWith('deleting');
});
it('never steals old binding claims or deletes their receipts', async () => {
  seed('binding', 900);
  store.completeReservation('binding', actor);
  store.claimReservationByKey({ receiptS3Key: 'binding', ...actor });
  const storage = { deleteObject: jest.fn() };
  const result = await store.cleanupExpiredReservations({
    now: new Date(Date.now() + 86400000),
    storage,
  });
  expect(result.skippedActiveClaims).toBe(1);
  expect(storage.deleteObject).not.toHaveBeenCalled();
  expect(
    store.claimReservationByKey({ receiptS3Key: 'binding', ...actor, claimTimeoutSeconds: -1 })
      .error
  ).toBe('ALREADY_CLAIMED');
});
it('retains failed deletes for retry and only counts successful deletes', async () => {
  seed('retry');
  const storage = {
    deleteObject: jest
      .fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValue(),
  };
  expect(store.getReservation('retry')).toBeNull();
  const first = await store.cleanupExpiredReservations({ storage });
  expect(first.cleaned).toBe(0);
  expect(first.errors).toHaveLength(1);
  const second = await store.cleanupExpiredReservations({ storage });
  expect(second.cleaned).toBe(1);
  expect(storage.deleteObject).toHaveBeenCalledTimes(2);
});
it.each(['writeFileSync', 'renameSync', 'fsyncSync'])(
  'fails closed when %s fails and does not retain a successful cache',
  (method) => {
    const spy = jest.spyOn(fs, method).mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    expect(() => seed('failed', 900)).toThrow('persistence failed');
    spy.mockRestore();
    expect(store.getReservation('failed')).toBeNull();
    expect(fs.existsSync(`${store.getStorePath()}.lock`)).toBe(false);
  }
);
it('fails closed on corrupt disk contents rather than using an old cache', () => {
  seed('corruption', 900);
  fs.writeFileSync(store.getStorePath(), 'broken');
  expect(() => store.getReservation('corruption')).toThrow('persistence failed');
});
it('one of eight independent processes claims a shared reservation, never two', async () => {
  seed('race', 900);
  store.completeReservation('race', actor);
  const children = await Promise.all(Array.from({ length: 8 }, worker));
  const results = await Promise.all(
    children.map((child) =>
      call(child, 'claimReservationByKey', { receiptS3Key: 'race', ...actor })
    )
  );
  expect(results.filter((result) => result.result?.claimId)).toHaveLength(1);
  for (const result of results.filter((result) => !result.result?.claimId)) {
    expect(result.error || result.result.error).toMatch(/RECEIPT_STORE_BUSY|ALREADY_CLAIMED/);
  }
  const fresh = await worker();
  expect((await call(fresh, 'getReservation', 'race')).result.status).toBe('claimed');
});
it('separate processes retain every unrelated create on the same shared file', async () => {
  const children = await Promise.all(Array.from({ length: 6 }, worker));
  await Promise.all(
    children.map(async (child, index) => {
      const input = {
        uploadId: `u-${index}`,
        objectKey: `key-${index}`,
        ...actor,
        expiresInSeconds: 900,
      };
      for (let retry = 0; retry < 30; retry++) {
        const result = await call(child, 'createReservation', input);
        if (!result.error) return;
        expect(result.error).toBe('RECEIPT_STORE_BUSY');
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error('Store remained busy');
    })
  );
  expect(Object.keys(JSON.parse(fs.readFileSync(store.getStorePath())))).toHaveLength(6);
});
it('does not silently fall back to memory when no durable path is configured', () => {
  store.setStorePath(null);
  expect(() => seed('no-path')).toThrow('shared durable volume');
});
