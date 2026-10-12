/**
 * Ephemeral Collaboration & SidePeek Presence Avatars (Spec §5, Parcel F)
 *
 * Connects to Supabase Realtime Presence channel `presence:work_request:${roomId}`
 * using the singleton Supabase client. Renders Notion-style overlapping circular
 * avatar badges showing other active viewers.
 *
 * Guarded by `isFeatureEnabled('realtime_sync')`. Purely in-memory WebSocket presence
 * with 0 persistent database writes.
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/lib/session';
import { isFeatureEnabled } from '@/lib/flags';
import { queryClient } from '@/lib/api';

export interface ViewerPresence {
  userId: string;
  name: string;
  email: string;
  role: string;
  avatarUrl?: string | null;
}

export interface PresenceAvatarsProps {
  roomId: string;
  domain?: 'work_request' | 'invoice' | 'disbursement' | 'document' | string;
  className?: string;
  maxAvatars?: number;
}

const AVATAR_BG_COLORS = [
  'bg-indigo-600 text-white',
  'bg-emerald-600 text-white',
  'bg-amber-600 text-white',
  'bg-rose-600 text-white',
  'bg-sky-600 text-white',
  'bg-violet-600 text-white',
  'bg-teal-600 text-white',
  'bg-fuchsia-600 text-white',
];

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1];
  if (!last) return first.slice(0, 2).toUpperCase();
  const firstChar = first[0] ?? '';
  const lastChar = last[0] ?? '';
  return (firstChar + lastChar).toUpperCase();
}

export function getAvatarColorClass(idOrName: string): string {
  let hash = 0;
  for (let i = 0; i < idOrName.length; i++) {
    hash = (hash << 5) - hash + idOrName.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_BG_COLORS.length;
  return AVATAR_BG_COLORS[index] ?? 'bg-indigo-600 text-white';
}

export function getCachedUserAvatar(userIdOrKey?: string, userEmail?: string): string | null {
  try {
    const team = queryClient.getQueryData<Array<{ id?: string; email?: string; avatarUrl?: string | null }>>(['me', 'team']);
    if (Array.isArray(team)) {
      const match = team.find(
        (m) =>
          (m.id && userIdOrKey && m.id === userIdOrKey) ||
          (m.email && userEmail && m.email.toLowerCase() === userEmail.toLowerCase())
      );
      if (match?.avatarUrl && typeof match.avatarUrl === 'string' && match.avatarUrl.trim() !== '') {
        return match.avatarUrl.trim();
      }
    }
  } catch {
    // safe fallback
  }

  try {
    const adminUsers = queryClient.getQueryData<Array<{ id?: string; email?: string; avatarUrl?: string | null }>>(['admin', 'users']);
    if (Array.isArray(adminUsers)) {
      const match = adminUsers.find(
        (m) =>
          (m.id && userIdOrKey && m.id === userIdOrKey) ||
          (m.email && userEmail && m.email.toLowerCase() === userEmail.toLowerCase())
      );
      if (match?.avatarUrl && typeof match.avatarUrl === 'string' && match.avatarUrl.trim() !== '') {
        return match.avatarUrl.trim();
      }
    }
  } catch {
    // safe fallback
  }

  return null;
}

export function extractViewers(
  presenceState: Record<string, unknown>,
  currentUserId?: string,
  currentUserEmail?: string
): ViewerPresence[] {
  const viewerMap = new Map<string, ViewerPresence>();

  for (const key of Object.keys(presenceState)) {
    const entry = presenceState[key];
    const items = Array.isArray(entry) ? entry : [entry];

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;

      const id = String(rec.userId || rec.id || key || '').trim();
      const name = String(rec.name || rec.displayName || rec.email || 'Colleague').trim();
      const email = String(rec.email || '').trim();
      const role = String(rec.role || 'Staff').trim();
      const rawAvatar = rec.avatarUrl || rec.avatar_url;
      const resolvedAvatar =
        typeof rawAvatar === 'string' && rawAvatar.trim() !== ''
          ? rawAvatar.trim()
          : null;
      const avatarUrl = resolvedAvatar || getCachedUserAvatar(id, email);

      // Filter out current active user
      if (currentUserId && id === currentUserId) continue;
      if (currentUserEmail && email && email.toLowerCase() === currentUserEmail.toLowerCase()) continue;

      const dedupeKey = id || email || name;
      if (dedupeKey && !viewerMap.has(dedupeKey)) {
        viewerMap.set(dedupeKey, {
          userId: id || dedupeKey,
          name,
          email,
          role,
          avatarUrl,
        });
      }
    }
  }

  return Array.from(viewerMap.values());
}

export function PresenceAvatars({
  roomId,
  domain,
  className = '',
  maxAvatars = 5,
}: PresenceAvatarsProps) {
  const isSyncEnabled = isFeatureEnabled('realtime_sync');
  const user = useSessionStore((state) => state.user);
  const [otherViewers, setOtherViewers] = useState<ViewerPresence[]>([]);
  const [hoveredUserId, setHoveredUserId] = useState<string | null>(null);
  const [isOverflowHovered, setIsOverflowHovered] = useState(false);
  const [failedAvatarIds, setFailedAvatarIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Eagerly reset otherViewers when roomId/domain changes
    setOtherViewers((prev) => (prev.length > 0 ? [] : prev));

    // Guard: feature flag bypass or empty roomId or unauthenticated session
    if (!isSyncEnabled || !roomId || !roomId.trim() || !user) {
      return;
    }

    let isMounted = true;
    const cleanRoomId = roomId.trim();
    const effectiveDomain = domain?.trim() || 'work_request';
    const channelName = cleanRoomId.startsWith('presence:')
      ? cleanRoomId
      : `presence:${effectiveDomain}:${cleanRoomId}`;
    const channel = supabase.channel(channelName);

    const updateFromState = (payload?: unknown) => {
      if (!isMounted) return;
      try {
        let state: Record<string, unknown> = { ...channel.presenceState() };
        if (payload && typeof payload === 'object') {
          const p = payload as Record<string, unknown>;
          if (p.state && typeof p.state === 'object') {
            state = { ...state, ...(p.state as Record<string, unknown>) };
          } else if (p.currentPresences && Array.isArray(p.currentPresences) && p.key) {
            const k = String(p.key).trim();
            if (k) {
              state[k] = p.currentPresences;
            }
          } else if (p.newPresences && Array.isArray(p.newPresences) && p.key) {
            const k = String(p.key).trim();
            if (k && !state[k]) {
              state[k] = p.newPresences;
            }
          }
        }
        const viewers = extractViewers(state, user.id, user.email);
        if (isMounted) {
          setOtherViewers((prev) => {
            if (prev.length === 0 && viewers.length === 0) {
              return prev;
            }
            return viewers;
          });
        }
      } catch {
        // purely in-memory presence; safe error swallow
      }
    };

    const handleLeave = (payload?: unknown) => {
      if (!isMounted) return;
      const p = payload as Record<string, unknown> | undefined;

      // If remaining presences exist for this key (e.g. multi-tab partial leave), retain user
      const remainingPresences = (p?.currentPresences && Array.isArray(p.currentPresences))
        ? p.currentPresences
        : [];
      if (remainingPresences.length > 0) {
        updateFromState(payload);
        return;
      }

      // Collect all keys/identifiers that left (strictly non-empty strings)
      const leftKeys = new Set<string>();
      if (p?.leftPresences && Array.isArray(p.leftPresences)) {
        for (const lp of p.leftPresences) {
          if (lp && typeof lp === 'object') {
            const rec = lp as Record<string, unknown>;
            const id = String(rec.userId || rec.id || '').trim();
            if (id) leftKeys.add(id);
            const email = String(rec.email || '').trim().toLowerCase();
            if (email) leftKeys.add(email);
            const name = String(rec.name || rec.displayName || '').trim();
            if (name) leftKeys.add(name);
          }
        }
      }
      if (p?.key) {
        const trimmedKey = String(p.key).trim();
        if (trimmedKey) {
          leftKeys.add(trimmedKey);
        }
      }

      const isLeaving = (v: ViewerPresence) => {
        const idMatches = Boolean(v.userId && leftKeys.has(v.userId));
        const emailMatches = Boolean(v.email && leftKeys.has(v.email.toLowerCase()));
        const nameMatches = Boolean(v.name && leftKeys.has(v.name));
        return idMatches || emailMatches || nameMatches;
      };

      // Synchronize with channel presenceState if available, strictly excluding left keys
      const rawState = channel.presenceState();
      if (rawState && typeof rawState === 'object' && Object.keys(rawState).length > 0) {
        const viewers = extractViewers(rawState, user.id, user.email);
        setOtherViewers(viewers.filter((v) => !isLeaving(v)));
      } else {
        setOtherViewers((prev) => prev.filter((v) => !isLeaving(v)));
      }
    };

    channel
      .on('presence', { event: 'sync' }, updateFromState)
      .on('presence', { event: 'join' }, updateFromState)
      .on('presence', { event: 'leave' }, handleLeave)
      .subscribe(async (status) => {
        if (!isMounted) return;
        if (status === 'SUBSCRIBED') {
          try {
            await channel.track({
              userId: user.id,
              name: user.name || 'User',
              email: user.email,
              role: user.role || 'Staff',
              avatarUrl: user.avatarUrl,
              joinedAt: new Date().toISOString(),
            });
            if (!isMounted) {
              void channel.untrack();
            } else {
              updateFromState();
            }
          } catch {
            // in-memory presence; ignore tracking errors
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // Reset stale presence on disconnection or transport errors
          if (isMounted) {
            setOtherViewers([]);
          }
        }
      });

    return () => {
      isMounted = false;
      try {
        void channel.untrack();
      } catch {
        // ignore unmount errors
      }
      try {
        void supabase.removeChannel(channel);
      } catch {
        // ignore unmount errors
      }
    };
  }, [roomId, domain, user, isSyncEnabled]);

  // Renders nothing (null) if feature flag is false, roomId is empty, or no other viewers
  if (!isSyncEnabled || !roomId || !roomId.trim() || !user || otherViewers.length === 0) {
    return null;
  }

  const safeMaxAvatars = Math.max(0, maxAvatars);
  const visibleViewers = otherViewers.slice(0, safeMaxAvatars);
  const overflowViewers = otherViewers.slice(safeMaxAvatars);
  const overflowCount = overflowViewers.length;

  let overflowTooltipText = '';
  if (overflowCount === 1 && overflowViewers[0]) {
    overflowTooltipText = `+1 more: ${overflowViewers[0].name} (${overflowViewers[0].role})`;
  } else if (overflowCount > 1) {
    const previewList = overflowViewers.slice(0, 5).map((v) => `${v.name} (${v.role})`).join(', ');
    const remainingCount = overflowCount - 5;
    overflowTooltipText = remainingCount > 0
      ? `+${overflowCount} more: ${previewList}, and ${remainingCount} others`
      : `+${overflowCount} more: ${previewList}`;
  }

  return (
    <div
      className={`flex items-center -space-x-1.5 overflow-visible py-0.5 ${className}`}
      data-testid="presence-avatars"
      aria-label="Active viewers"
    >
      {visibleViewers.map((viewer) => {
        const isHovered = hoveredUserId === viewer.userId;
        const tooltipText = `Viewing now: ${viewer.name} (${viewer.role})`;
        const initials = getInitials(viewer.name);
        const colorClass = getAvatarColorClass(viewer.userId || viewer.name);
        const effectiveAvatarUrl = viewer.avatarUrl || getCachedUserAvatar(viewer.userId, viewer.email);
        const hasValidAvatar = Boolean(effectiveAvatarUrl && !failedAvatarIds[viewer.userId]);

        return (
          <div
            key={viewer.userId}
            className={`relative group focus:outline-none transition-all ${isHovered ? 'z-30' : 'z-0'}`}
            data-testid={`presence-avatar-${viewer.userId}`}
            title={tooltipText}
            aria-label={tooltipText}
            tabIndex={0}
            onMouseEnter={() => setHoveredUserId(viewer.userId)}
            onMouseLeave={() => setHoveredUserId(null)}
            onFocus={() => setHoveredUserId(viewer.userId)}
            onBlur={() => setHoveredUserId(null)}
          >
            <div
              className={`h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 border-white shadow-xs transition-transform hover:scale-110 cursor-pointer ${colorClass}`}
            >
              {hasValidAvatar && effectiveAvatarUrl ? (
                <img
                  src={effectiveAvatarUrl}
                  alt={viewer.name}
                  className="h-full w-full rounded-full object-cover"
                  onError={() => {
                    setFailedAvatarIds((prev) => ({ ...prev, [viewer.userId]: true }));
                  }}
                />
              ) : (
                <span>{initials}</span>
              )}
            </div>

            {/* Live presence active green dot */}
            <span
              className="absolute bottom-0 right-0 block h-2 w-2 rounded-full bg-emerald-500 ring-1 ring-white"
              aria-hidden="true"
            />

            {/* Hover tooltip */}
            {isHovered && (
              <div
                role="tooltip"
                data-testid={`presence-tooltip-${viewer.userId}`}
                className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2.5 py-1 bg-slate-900 text-white text-xs font-normal rounded-md shadow-lg max-w-xs break-words sm:whitespace-nowrap z-50 pointer-events-none animate-in fade-in-0 zoom-in-95 duration-100"
              >
                {tooltipText}
                <span
                  className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-slate-900"
                  aria-hidden="true"
                />
              </div>
            )}
          </div>
        );
      })}

      {overflowCount > 0 && (
        <div
          className={`relative h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 border-white shadow-xs bg-slate-200 text-slate-700 cursor-default focus:outline-none ${isOverflowHovered ? 'z-30' : 'z-0'}`}
          title={overflowTooltipText}
          aria-label={`${overflowCount} more viewers: ${overflowViewers.map((v) => v.name).join(', ')}`}
          data-testid="presence-avatars-overflow"
          tabIndex={0}
          onMouseEnter={() => setIsOverflowHovered(true)}
          onMouseLeave={() => setIsOverflowHovered(false)}
          onFocus={() => setIsOverflowHovered(true)}
          onBlur={() => setIsOverflowHovered(false)}
        >
          +{overflowCount}
          {isOverflowHovered && (
            <div
              role="tooltip"
              data-testid="presence-tooltip-overflow"
              className="absolute top-full right-0 mt-1.5 px-2.5 py-1.5 bg-slate-900 text-white text-xs font-normal rounded-md shadow-lg max-w-xs sm:max-w-sm break-words z-50 pointer-events-none animate-in fade-in-0 zoom-in-95 duration-100"
            >
              {overflowTooltipText}
              <span
                className="absolute bottom-full right-2.5 border-4 border-transparent border-b-slate-900"
                aria-hidden="true"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
