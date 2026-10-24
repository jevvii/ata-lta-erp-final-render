import { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSessionStore } from '@/lib/session';

export interface UseScopedRecordGuardOptions<T> {
  recordId: string | null | undefined;
  isOpen: boolean;
  onClose?: () => void;
  queryError?: unknown;
  isQueryError?: boolean;
  isPlaceholderData?: boolean;
  liveRecord?: T | null;
  initialRecord?: T | null;
  queryKey?: readonly unknown[];
}

export interface UseScopedRecordGuardResult<T> {
  record: T | null;
  isDenied: boolean;
  isScopeStale: boolean;
  canFetchChildren: boolean;
}

/**
 * 360° Shared Project Team Visibility (SHARED-PROJECT-VISIBILITY-20261024, Directive 3):
 * Scoped-record privacy guard for protected financial, document, and transmittal views.
 *
 * Enforces:
 * 1. Immediate Context Change Guard: When user switches account or active entity while
 *    modal is open, immediately marks scope as stale, suppresses child queries, closes the modal,
 *    and prevents old initial props from leaking in the DOM during delayed server reads.
 * 2. Stable Denied State Tracking: When server returns 403 or 404, latches denied state,
 *    purges query cache to null, and prevents fallback to initial props.
 * 3. Restored Membership on Fresh 200: Clears denied state only on genuinely fresh server 200
 *    (!isPlaceholderData), preventing stale query cache placeholder data from clearing latch early.
 */
export function useScopedRecordGuard<T extends { id?: string } | null | undefined>({
  recordId,
  isOpen,
  onClose,
  queryError,
  isQueryError,
  isPlaceholderData,
  liveRecord,
  initialRecord,
  queryKey,
}: UseScopedRecordGuardOptions<T>): UseScopedRecordGuardResult<T> {
  const queryClient = useQueryClient();
  const currentUser = useSessionStore((state) => state.user);
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const effectiveId = recordId || initialRecord?.id || null;

  // 1. Stable Denied Scope tracking
  const [deniedScope, setDeniedScope] = useState<{
    id: string;
    entity: string | null;
    userId: string | null;
  } | null>(null);

  const isScopeMatch = Boolean(
    deniedScope &&
      effectiveId &&
      deniedScope.id === effectiveId &&
      deniedScope.entity === activeEntity &&
      deniedScope.userId === (currentUser?.id ?? null)
  );

  // 2. Scope Owner tracking (immediate context switch guard)
  const [scopeOwner, setScopeOwner] = useState<{
    id: string;
    entity: string | null;
    userId: string | null;
  } | null>(() => {
    if (isOpen && effectiveId) {
      return {
        id: effectiveId,
        entity: activeEntity,
        userId: currentUser?.id ?? null,
      };
    }
    return null;
  });

  useEffect(() => {
    if (isOpen && effectiveId) {
      setScopeOwner((prev) => {
        if (!prev || prev.id !== effectiveId) {
          return {
            id: effectiveId,
            entity: activeEntity,
            userId: currentUser?.id ?? null,
          };
        }
        return prev;
      });
    } else if (!isOpen) {
      setScopeOwner(null);
    }
  }, [isOpen, effectiveId, activeEntity, currentUser?.id]);

  const isScopeStale = Boolean(
    scopeOwner &&
      (scopeOwner.entity !== activeEntity ||
        scopeOwner.userId !== (currentUser?.id ?? null))
  );

  useEffect(() => {
    if (isScopeStale && isOpen) {
      onClose?.();
    }
  }, [isScopeStale, isOpen, onClose]);

  const isErrorDenied = Boolean(
    isQueryError &&
      ((queryError as { status?: number })?.status === 403 ||
        (queryError as { status?: number })?.status === 404 ||
        String((queryError as { message?: string })?.message || '').includes('403') ||
        String((queryError as { message?: string })?.message || '').includes('404'))
  );

  const isDenied = Boolean(isScopeMatch || isErrorDenied);

  // On denial: record denied scope and purge query cache
  useEffect(() => {
    if (isErrorDenied && effectiveId) {
      setDeniedScope({
        id: effectiveId,
        entity: activeEntity,
        userId: currentUser?.id ?? null,
      });

      if (queryKey) {
        queryClient.setQueryData(queryKey, null);
      }
    }
  }, [isErrorDenied, effectiveId, activeEntity, currentUser?.id, queryKey, queryClient]);

  // On fresh server 200 (!isPlaceholderData): clear denied latch
  useEffect(() => {
    if (
      liveRecord &&
      (!effectiveId || (liveRecord as { id?: string }).id === effectiveId) &&
      !isQueryError &&
      !isPlaceholderData &&
      deniedScope
    ) {
      setDeniedScope(null);
    }
  }, [liveRecord, effectiveId, isQueryError, isPlaceholderData, deniedScope]);

  // Safe resolved record:
  // If denied or stale context: NEVER return data (initial or cached)
  const safeRecord = useMemo<T | null>(() => {
    if (isDenied || isScopeStale) return null;
    if (liveRecord !== undefined && liveRecord !== null) return liveRecord;
    return initialRecord ?? null;
  }, [isDenied, isScopeStale, liveRecord, initialRecord]);

  return {
    record: safeRecord,
    isDenied,
    isScopeStale,
    canFetchChildren: Boolean(isOpen && effectiveId && !isDenied && !isScopeStale),
  };
}
