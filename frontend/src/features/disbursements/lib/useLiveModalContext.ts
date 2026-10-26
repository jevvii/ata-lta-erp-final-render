import { useRef, useLayoutEffect } from 'react';
import { useSessionStore } from '@/lib/session';

export interface LiveModalContextOptions {
  isOpen: boolean;
  disbursementId?: string | null;
  version?: number | null;
}

/** A server response may update the version; only a different form/session invalidates its callbacks. */
export function useLiveModalContext({
  isOpen,
  disbursementId = null,
  version = null,
}: LiveModalContextOptions) {
  const userId = useSessionStore((state) => state.user?.id);
  const entity = useSessionStore((state) => state.activeEntity);
  const contextKey = JSON.stringify([isOpen, disbursementId, userId, entity]);
  const liveRef = useRef({ generation: 0, mounted: false });

  useLayoutEffect(() => {
    liveRef.current = { generation: liveRef.current.generation + 1, mounted: true };
    return () => {
      liveRef.current = { generation: liveRef.current.generation + 1, mounted: false };
    };
  }, [contextKey]);

  const captureContext = () => {
    const generation = liveRef.current.generation;
    const session = useSessionStore.getState();
    const startUserId = session.user?.id;
    const startEntity = session.activeEntity;
    return {
      startId: disbursementId,
      startVersion: version,
      isStale: () => {
        const current = useSessionStore.getState();
        return !isOpen || !liveRef.current.mounted || liveRef.current.generation !== generation ||
          current.user?.id !== startUserId || current.activeEntity !== startEntity;
      },
    };
  };

  return { contextKey, captureContext };
}
