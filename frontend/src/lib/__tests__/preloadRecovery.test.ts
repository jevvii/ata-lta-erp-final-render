import { describe, it, expect, vi } from 'vitest';
import {
  PRELOAD_RECOVERY_FLAG,
  installPreloadErrorRecovery,
  type PreloadRecoveryDeps,
} from '@/lib/preloadRecovery';

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    values,
  };
}

function createHarness(options: {
  storage?: ReturnType<typeof createStorage> | null;
  setItemThrows?: boolean;
} = {}) {
  let handler: ((event: unknown) => void) | undefined;
  const storage = options.storage === undefined ? createStorage() : options.storage;
  if (storage && options.setItemThrows) {
    storage.setItem.mockImplementation(() => {
      throw new Error('quota exceeded');
    });
  }
  const reload = vi.fn<() => void>();
  const reportError = vi.fn<(event: unknown) => void>();

  const deps: PreloadRecoveryDeps = {
    addEventListener: (type, listener) => {
      if (type === 'vite:preloadError') handler = listener;
    },
    sessionStorage: storage,
    reload,
    reportError,
  };

  installPreloadErrorRecovery(deps);

  return {
    storage,
    reload,
    reportError,
    emit: (event: unknown = { type: 'vite:preloadError' }) => {
      if (!handler) throw new Error('preload error listener was not registered');
      handler(event);
    },
  };
}

describe('vite preload error recovery', () => {
  it('reloads once when a stale chunk fails to load after a deployment', () => {
    const harness = createHarness();

    harness.emit();

    expect(harness.reload).toHaveBeenCalledTimes(1);
    expect(harness.storage?.values.get(PRELOAD_RECOVERY_FLAG)).toBe('true');
    expect(harness.reportError).not.toHaveBeenCalled();
  });

  it('does not reload again when the error persists after the recovery reload', () => {
    const harness = createHarness({ storage: createStorage({ [PRELOAD_RECOVERY_FLAG]: 'true' }) });

    harness.emit();

    expect(harness.reload).not.toHaveBeenCalled();
    expect(harness.storage?.values.has(PRELOAD_RECOVERY_FLAG)).toBe(false);
    expect(harness.reportError).toHaveBeenCalledTimes(1);
  });

  it('does not reload when session storage is unavailable', () => {
    const harness = createHarness({ storage: null });

    harness.emit();

    expect(harness.reload).not.toHaveBeenCalled();
    expect(harness.reportError).toHaveBeenCalledTimes(1);
  });

  it('does not reload when the recovery flag cannot be persisted', () => {
    const harness = createHarness({ storage: createStorage(), setItemThrows: true });

    harness.emit();

    expect(harness.reload).not.toHaveBeenCalled();
    expect(harness.reportError).toHaveBeenCalledTimes(1);
  });
});
