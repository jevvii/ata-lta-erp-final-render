import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(__dirname, '../../index.html');

type Mock = ReturnType<typeof vi.fn>;

interface Registration {
  unregister: Mock;
}

interface CleanupRun {
  serviceWorker: { getRegistrations: Mock } | undefined;
  cacheStore: {
    keys: Mock;
    delete: Mock;
  };
  registrations: Registration[];
}

function readIndexHtml(): string {
  return fs.readFileSync(indexPath, 'utf8');
}

function extractCleanupScript(html: string): string {
  const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1] ?? ''
  );
  const cleanup = inlineScripts.find((script) => script.includes('getRegistrations'));
  if (!cleanup) {
    throw new Error('index.html is missing the legacy client cleanup script');
  }
  return cleanup;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function runCleanup(
  options: { cacheKeys?: string[]; withServiceWorker?: boolean } = {}
): CleanupRun {
  const registrations: Registration[] = [
    { unregister: vi.fn(async () => true) },
    { unregister: vi.fn(async () => true) },
  ];
  const cacheStore = {
    keys: vi.fn(async () => options.cacheKeys ?? ['erp-shell-v41', 'erp-api-v41', 'unrelated-cache']),
    delete: vi.fn(async () => true),
  };
  const serviceWorker =
    options.withServiceWorker === false
      ? undefined
      : { getRegistrations: vi.fn(async () => registrations) };
  const navigator = serviceWorker ? { serviceWorker } : {};
  const window = { caches: cacheStore };

  const script = extractCleanupScript(readIndexHtml());
  vm.runInNewContext(script, { navigator, caches: cacheStore, window, console });

  return { serviceWorker, cacheStore, registrations };
}

describe('legacy client-state cleanup in index.html', () => {
  it('runs before the application module so a stale worker is released on first paint', () => {
    const html = readIndexHtml();
    const cleanupIndex = html.indexOf('getRegistrations');
    const moduleIndex = html.indexOf('src="/src/main.tsx"');

    expect(cleanupIndex, 'cleanup script must be present').toBeGreaterThan(-1);
    expect(moduleIndex, 'application module must be present').toBeGreaterThan(-1);
    expect(cleanupIndex).toBeLessThan(moduleIndex);
  });

  it('unregisters every registered service worker', async () => {
    const run = runCleanup();

    await flush();

    expect(run.serviceWorker?.getRegistrations).toHaveBeenCalledTimes(1);
    for (const registration of run.registrations) {
      expect(registration.unregister).toHaveBeenCalledTimes(1);
    }
  });

  it('deletes prototype-era caches but leaves unrelated caches alone', async () => {
    const run = runCleanup();

    await flush();

    expect(run.cacheStore.delete).toHaveBeenCalledWith('erp-shell-v41');
    expect(run.cacheStore.delete).toHaveBeenCalledWith('erp-api-v41');
    expect(run.cacheStore.delete).not.toHaveBeenCalledWith('unrelated-cache');
  });

  it('does not throw when the service worker API is unavailable', async () => {
    expect(() => runCleanup({ withServiceWorker: false })).not.toThrow();

    await flush();
  });
});
