const originalEnv = { ...process.env };
const serviceKey = 'sb_secret_test_service_credential';

const jwt = (role) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;

beforeEach(() => {
  jest.resetModules();
  process.env.SUPABASE_SERVICE_KEY = serviceKey;
  delete process.env.SUPABASE_ANON_KEY;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

jest.mock('../../../src/services/supabaseClient', () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }),
  },
}));

async function publicConfig(key) {
  if (key !== undefined) process.env.SUPABASE_ANON_KEY = key;
  const { getPublicConfig } = require('../../../src/modules/config/controller');
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await getPublicConfig({}, res, (err) => {
    throw err;
  });
  return res;
}

it.each([undefined, '', serviceKey, 'sb_secret_another_secret', jwt('service_role')])(
  'never returns a privileged credential when public key is %s',
  async (key) => {
    const res = await publicConfig(key);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0]).toEqual(
      expect.objectContaining({ code: 'PUBLIC_CONFIG_UNAVAILABLE' })
    );
    expect(JSON.stringify(res.json.mock.calls)).not.toContain(serviceKey);
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('data.supabaseAnonKey');
  }
);

it.each(['sb_publishable_test_public_key', jwt('anon')])('supports public key %s', async (key) => {
  const res = await publicConfig(key);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json.mock.calls[0][0].data.supabaseAnonKey).toBe(key);
});
