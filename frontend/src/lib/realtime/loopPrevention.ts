/**
 * Loop Prevention Registry & Tab Origin Tracking (Spec §4.3, Parcel E)
 *
 * Prevents echo loops and cache thrashing when mutations originate from the current browser tab:
 * 1. Checks payload origin_tab_id / originTabId against getTabId().
 * 2. Matches recently dispatched local mutations in an in-memory TTL registry.
 */

import { getTabId } from '@/lib/tabSync';

interface LocalMutationEntry {
  table: string;
  id: string;
  version?: number;
  timestamp: number;
}

const LOCAL_MUTATION_TTL_MS = 10_000;
const localMutations = new Map<string, LocalMutationEntry>();

function cleanExpiredMutations(): void {
  const now = Date.now();
  for (const [key, entry] of localMutations.entries()) {
    if (now - entry.timestamp > LOCAL_MUTATION_TTL_MS) {
      localMutations.delete(key);
    }
  }
}

/**
 * Registers a locally-initiated mutation for loop suppression.
 */
export function trackLocalMutation(table: string, id: string, version?: number): void {
  cleanExpiredMutations();
  const key = version !== undefined ? `${table}:${id}:${version}` : `${table}:${id}`;
  localMutations.set(key, {
    table,
    id,
    version,
    timestamp: Date.now(),
  });
}

export const registerLocalMutation = trackLocalMutation;

/**
 * Checks whether an incoming record update corresponds to a locally dispatched mutation.
 */
export function isLocalMutation(table: string, id: string, version?: number): boolean {
  cleanExpiredMutations();

  // If a version is provided, check if the exact version was tracked
  if (version !== undefined && localMutations.has(`${table}:${id}:${version}`)) {
    return true;
  }

  // Check unversioned table:id match
  if (localMutations.has(`${table}:${id}`)) {
    return true;
  }

  return false;
}

/**
 * Checks if the payload's origin tab matches the current browser tab.
 */
export function isSelfOriginatedPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;

  const currentTabId = getTabId();
  if (!currentTabId) return false;

  const payloadObj = payload as {
    new?: { origin_tab_id?: string; originTabId?: string };
    origin_tab_id?: string;
    originTabId?: string;
  };

  const incomingTabId =
    payloadObj?.new?.origin_tab_id ??
    payloadObj?.new?.originTabId ??
    payloadObj?.origin_tab_id ??
    payloadObj?.originTabId;

  if (incomingTabId && incomingTabId === currentTabId) {
    return true;
  }

  return false;
}

/**
 * Clears local mutation registry (used by test suites).
 */
export function clearLocalMutationsForTesting(): void {
  localMutations.clear();
}
