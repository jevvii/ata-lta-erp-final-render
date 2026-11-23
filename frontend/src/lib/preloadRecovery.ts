/**
 * Recovers from stale dynamic-chunk imports after a deployment.
 *
 * Vite emits `vite:preloadError` when an already-loaded index.html references a
 * hashed chunk that the new deployment no longer serves. Reloading once fetches
 * the current index.html and its matching chunks. A sessionStorage flag prevents
 * a reload loop if the failure is not deployment-related.
 */
export const PRELOAD_RECOVERY_FLAG = 'erp_vite_preload_reloaded';

export interface PreloadRecoveryDeps {
  addEventListener: (type: 'vite:preloadError', listener: (event: unknown) => void) => void;
  sessionStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  reload: () => void;
  reportError?: (event: unknown) => void;
}

export function installPreloadErrorRecovery(deps: PreloadRecoveryDeps): void {
  deps.addEventListener('vite:preloadError', (event) => {
    let alreadyReloaded = false;
    try {
      alreadyReloaded = deps.sessionStorage?.getItem(PRELOAD_RECOVERY_FLAG) === 'true';
    } catch {
      alreadyReloaded = false;
    }

    if (alreadyReloaded) {
      try {
        deps.sessionStorage?.removeItem(PRELOAD_RECOVERY_FLAG);
      } catch {
        // The report below does not depend on clearing the flag.
      }
      deps.reportError?.(event);
      return;
    }

    try {
      if (!deps.sessionStorage) {
        throw new Error('session storage unavailable');
      }
      deps.sessionStorage.setItem(PRELOAD_RECOVERY_FLAG, 'true');
    } catch {
      // Without a persisted guard, reloading could loop forever.
      deps.reportError?.(event);
      return;
    }

    deps.reload();
  });
}
