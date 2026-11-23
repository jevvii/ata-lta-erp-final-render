import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const swPath = path.resolve(__dirname, '../../public/sw.js');

type SwHandler = (event: { waitUntil: (promise: Promise<unknown>) => void }) => void;

interface WindowClient {
  url: string;
  navigate?: ReturnType<typeof vi.fn>;
}

interface WorkerMocks {
  handlers: Map<string, SwHandler[]>;
  self: {
    addEventListener: (type: string, handler: SwHandler) => void;
    skipWaiting: ReturnType<typeof vi.fn>;
    registration: { unregister: ReturnType<typeof vi.fn> };
    clients: {
      claim: ReturnType<typeof vi.fn>;
      matchAll: ReturnType<typeof vi.fn>;
    };
  };
  caches: {
    keys: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

function loadWorker(options: {
  cacheKeys?: string[];
  cacheKeysError?: Error;
  clients?: WindowClient[];
  matchAllError?: Error;
} = {}): WorkerMocks {
  const handlers = new Map<string, SwHandler[]>();
  const cacheKeys = options.cacheKeys ?? ['erp-shell-v41', 'erp-api-v41'];
  const windowClients = options.clients ?? [];

  const self = {
    addEventListener: (type: string, handler: SwHandler) => {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
    },
    skipWaiting: vi.fn(async () => undefined),
    registration: { unregister: vi.fn(async () => true) },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => {
        if (options.matchAllError) throw options.matchAllError;
        return windowClients;
      }),
    },
  };

  const caches = {
    keys: vi.fn(async () => {
      if (options.cacheKeysError) throw options.cacheKeysError;
      return cacheKeys;
    }),
    delete: vi.fn(async () => true),
  };

  const source = fs.readFileSync(swPath, 'utf8');
  // The worker script is plain JS served to the browser; evaluating it here with
  // mocked globals exercises the real shipped file rather than a copy.
  vm.runInNewContext(source, { self, caches, console });

  return { handlers, self, caches };
}

async function runActivate(mocks: WorkerMocks): Promise<void> {
  const handler = mocks.handlers.get('activate')?.[0];
  if (!handler) throw new Error('activate handler is not registered');
  const waits: Promise<unknown>[] = [];
  handler({ waitUntil: (promise) => waits.push(promise) });
  await Promise.all(waits);
}

describe('legacy service-worker kill-switch', () => {
  it('exists at frontend/public/sw.js so the static build serves /sw.js', () => {
    expect(fs.existsSync(swPath), 'frontend/public/sw.js must exist').toBe(true);
  });

  it('registers install and activate handlers', () => {
    const { handlers } = loadWorker();
    expect(handlers.has('install')).toBe(true);
    expect(handlers.has('activate')).toBe(true);
  });

  it('skips waiting so the kill-switch replaces a stale prototype worker immediately', async () => {
    const mocks = loadWorker();
    const waits: Promise<unknown>[] = [];
    mocks.handlers.get('install')?.[0]?.({ waitUntil: (promise) => waits.push(promise) });
    await Promise.all(waits);
    expect(mocks.self.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('purges prototype-era caches and leaves unrelated caches alone', async () => {
    const mocks = loadWorker({
      cacheKeys: ['erp-shell-v41', 'erp-api-v41', 'unrelated-cache'],
    });

    await runActivate(mocks);

    expect(mocks.caches.delete).toHaveBeenCalledWith('erp-shell-v41');
    expect(mocks.caches.delete).toHaveBeenCalledWith('erp-api-v41');
    expect(mocks.caches.delete).not.toHaveBeenCalledWith('unrelated-cache');
  });

  it('unregisters the registration so the origin stops being controlled', async () => {
    const mocks = loadWorker();
    await runActivate(mocks);
    expect(mocks.self.registration.unregister).toHaveBeenCalledTimes(1);
  });

  it('reloads every controlled window onto the live deployment', async () => {
    const first = { url: 'https://erp.ltabmcorp.com/', navigate: vi.fn(async () => undefined) };
    const second = {
      url: 'https://erp.ltabmcorp.com/operations',
      navigate: vi.fn(async () => undefined),
    };
    const incomplete = { url: 'https://erp.ltabmcorp.com/login' };

    const mocks = loadWorker({ clients: [first, second, incomplete] });
    await runActivate(mocks);

    expect(mocks.self.clients.claim).toHaveBeenCalledTimes(1);
    expect(first.navigate).toHaveBeenCalledWith(first.url);
    expect(second.navigate).toHaveBeenCalledWith(second.url);
  });

  it('still unregisters when cache enumeration fails', async () => {
    const mocks = loadWorker({ cacheKeysError: new Error('cache storage unavailable') });

    await runActivate(mocks);

    expect(mocks.self.registration.unregister).toHaveBeenCalledTimes(1);
  });

  it('still unregisters when client enumeration fails', async () => {
    const mocks = loadWorker({ matchAllError: new Error('clients unavailable') });

    await runActivate(mocks);

    expect(mocks.self.registration.unregister).toHaveBeenCalledTimes(1);
  });
});
