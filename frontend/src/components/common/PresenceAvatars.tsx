import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/lib/session';
import { isFeatureEnabled } from '@/lib/flags';
import { queryClient } from '@/lib/api';
import { UserAvatar } from './UserAvatar';

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
  'bg-[#1E3A8A] text-white',
  'bg-[#0369A1] text-white',
  'bg-[#1D4ED8] text-white',
  'bg-[#166534] text-white',
  'bg-[#854D0E] text-white',
  'bg-[#334155] text-white',
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
  return AVATAR_BG_COLORS[index] ?? 'bg-[#1E3A8A] text-white';
}

export function getCachedUserAvatar(
  userIdOrKey?: string,
  userEmail?: string,
  userName?: string
): string | null {
  try {
    const candidateQueries = [
      ...queryClient.getQueriesData<unknown>({ queryKey: ['me', 'team'] }),
      ...queryClient.getQueriesData<unknown>({ queryKey: ['admin', 'users'] }),
    ];
    for (const [, queryData] of candidateQueries) {
      if (!queryData) continue;
      const list = Array.isArray(queryData)
        ? queryData
        : Array.isArray((queryData as { data?: unknown[] }).data)
        ? (queryData as { data: unknown[] }).data
        : [];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const itemId = rec.id ? String(rec.id) : null;
        const itemEmail = rec.email ? String(rec.email) : null;
        const itemName = rec.name ? String(rec.name) : null;
        const matchesId = Boolean(userIdOrKey && itemId && itemId === userIdOrKey);
        const matchesEmail = Boolean(userEmail && itemEmail && itemEmail.toLowerCase() === userEmail.toLowerCase());
        const matchesName = Boolean(userName && itemName && itemName.trim().toLowerCase() === userName.trim().toLowerCase());
        if (matchesId || matchesEmail || matchesName) {
          const rawUrl = rec.avatarUrl || rec.avatar_url;
          if (typeof rawUrl === 'string' && rawUrl.trim() !== '') {
            return rawUrl.trim();
          }
        }
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
      const avatarUrl = resolvedAvatar || getCachedUserAvatar(id, email, name);

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

// Module-level shared presence hub registry
// Prevents duplicate channel subscriptions and "cannot add presence callbacks after subscribe()" errors
// when multiple components (e.g. Kanban Board + SidePeek) view the same presence room simultaneously.
interface PresenceHub {
  channel: ReturnType<typeof supabase.channel>;
  subscribers: Set<(viewers: ViewerPresence[]) => void>;
  lastViewers: ViewerPresence[];
}

const presenceHubs = new Map<string, PresenceHub>();

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

  useEffect(() => {
    setOtherViewers((prev) => (prev.length > 0 ? [] : prev));

    if (!isSyncEnabled || !roomId || !roomId.trim() || !user) {
      return;
    }

    let isMounted = true;
    const cleanRoomId = roomId.trim();
    const effectiveDomain = domain?.trim() || 'work_request';
    const channelName = cleanRoomId.startsWith('presence:')
      ? cleanRoomId
      : `presence:${effectiveDomain}:${cleanRoomId}`;

    let hub = presenceHubs.get(channelName);

    // If an external cleanup (e.g. supabase.removeAllChannels in test runners) removed the channel, purge the stale hub
    if (hub && !supabase.getChannels().some((c) => c.topic === hub!.channel.topic || c === hub!.channel)) {
      presenceHubs.delete(channelName);
      hub = undefined;
    }

    if (!hub) {
      // If a non-hub channel with this name exists in supabase, remove it first to attach fresh callbacks cleanly
      const existingChannels = supabase.getChannels();
      const existing = existingChannels.find(
        (c) => c.topic === channelName || c.topic === `realtime:${channelName}`
      );
      if (existing) {
        try {
          void supabase.removeChannel(existing);
        } catch {
          // ignore
        }
      }

      const channel = supabase.channel(channelName);
      hub = {
        channel,
        subscribers: new Set(),
        lastViewers: [],
      };
      presenceHubs.set(channelName, hub);

      const notifySubscribers = (viewers: ViewerPresence[]) => {
        const currentHub = presenceHubs.get(channelName);
        if (!currentHub) return;
        currentHub.lastViewers = viewers;
        for (const sub of currentHub.subscribers) {
          try {
            sub(viewers);
          } catch {
            // ignore subscriber callback error
          }
        }
      };

      const updateFromState = (payload?: unknown) => {
        try {
          let state: Record<string, unknown> = { ...channel.presenceState() };
          if (payload && typeof payload === 'object') {
            const p = payload as Record<string, unknown>;
            if (p.state && typeof p.state === 'object') {
              state = { ...state, ...(p.state as Record<string, unknown>) };
            } else if (p.currentPresences && Array.isArray(p.currentPresences) && p.key) {
              const k = String(p.key).trim();
              if (k) state[k] = p.currentPresences;
            } else if (p.newPresences && Array.isArray(p.newPresences) && p.key) {
              const k = String(p.key).trim();
              if (k && !state[k]) state[k] = p.newPresences;
            }
          }
          const viewers = extractViewers(state, user.id, user.email);
          notifySubscribers(viewers);
        } catch {
          // purely in-memory presence
        }
      };

      const handleLeave = (payload?: unknown) => {
        const p = payload as Record<string, unknown> | undefined;

        const remainingPresences = (p?.currentPresences && Array.isArray(p.currentPresences))
          ? p.currentPresences
          : [];
        if (remainingPresences.length > 0) {
          updateFromState(payload);
          return;
        }

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
          if (trimmedKey) leftKeys.add(trimmedKey);
        }

        const isLeaving = (v: ViewerPresence) => {
          const idMatches = Boolean(v.userId && leftKeys.has(v.userId));
          const emailMatches = Boolean(v.email && leftKeys.has(v.email.toLowerCase()));
          const nameMatches = Boolean(v.name && leftKeys.has(v.name));
          return idMatches || emailMatches || nameMatches;
        };

        const rawState = channel.presenceState();
        if (rawState && typeof rawState === 'object' && Object.keys(rawState).length > 0) {
          const viewers = extractViewers(rawState, user.id, user.email);
          notifySubscribers(viewers.filter((v) => !isLeaving(v)));
        } else {
          const currentHub = presenceHubs.get(channelName);
          notifySubscribers(currentHub ? currentHub.lastViewers.filter((v) => !isLeaving(v)) : []);
        }
      };

      try {
        channel
          .on('presence', { event: 'sync' }, updateFromState)
          .on('presence', { event: 'join' }, updateFromState)
          .on('presence', { event: 'leave' }, handleLeave);
      } catch {
        // Safe fallback if channel is already joined/joining
      }

      try {
        channel.subscribe(async (status) => {
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
              updateFromState();
            } catch {
              // in-memory presence
            }
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            notifySubscribers([]);
          }
        });
      } catch {
        // Safe fallback if already subscribed
      }
    }

    const onViewerUpdate = (viewers: ViewerPresence[]) => {
      if (isMounted) {
        setOtherViewers((prev) => {
          if (prev.length === 0 && viewers.length === 0) return prev;
          return viewers;
        });
      }
    };

    hub.subscribers.add(onViewerUpdate);

    // Seed initial state from hub or channel presenceState
    if (hub.lastViewers.length > 0) {
      setOtherViewers(hub.lastViewers);
    } else {
      try {
        const initial = extractViewers(hub.channel.presenceState(), user.id, user.email);
        if (initial.length > 0) {
          setOtherViewers(initial);
        }
      } catch {
        // ignore
      }
    }

    return () => {
      isMounted = false;
      const currentHub = presenceHubs.get(channelName);
      if (!currentHub) return;
      currentHub.subscribers.delete(onViewerUpdate);

      if (currentHub.subscribers.size === 0) {
        presenceHubs.delete(channelName);
        try {
          void currentHub.channel.untrack();
        } catch {
          // ignore unmount errors
        }
        try {
          void supabase.removeChannel(currentHub.channel);
        } catch {
          // ignore unmount errors
        }
      }
    };
  }, [roomId, domain, user, isSyncEnabled]);

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
      className={`flex items-center -space-x-1 overflow-visible py-0.5 ${className}`}
      data-testid="presence-avatars"
      aria-label="Active viewers"
    >
      {visibleViewers.map((viewer) => {
        const isHovered = hoveredUserId === viewer.userId;
        const tooltipText = `Viewing now: ${viewer.name} (${viewer.role})`;
        const colorClass = getAvatarColorClass(viewer.userId || viewer.name);
        const effectiveAvatarUrl = viewer.avatarUrl || getCachedUserAvatar(viewer.userId, viewer.email, viewer.name);

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
            <UserAvatar
              userId={viewer.userId}
              name={viewer.name}
              email={viewer.email}
              avatarUrl={effectiveAvatarUrl}
              size="sm"
              shape="circle"
              className={`border-2 border-white shadow-2xs cursor-pointer font-semibold ${colorClass}`}
            />

            {/* Live presence active green dot */}
            <span
              className="absolute -bottom-0.5 -right-0.5 block h-2 w-2 rounded-full bg-[#166534] border border-[#FFFFFF]"
              aria-hidden="true"
            />

            {/* Hover tooltip */}
            {isHovered && (
              <div
                role="tooltip"
                data-testid={`presence-tooltip-${viewer.userId}`}
                className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2.5 py-1 bg-[#0F172A] text-[#FFFFFF] text-xs font-medium rounded-[6px] border border-[#334155] shadow-float max-w-xs break-words sm:whitespace-nowrap z-50 pointer-events-none"
              >
                {tooltipText}
              </div>
            )}
          </div>
        );
      })}

      {overflowCount > 0 && (
        <div
          className={`relative h-7 w-7 rounded-full flex items-center justify-center tabular-nums text-xs font-semibold border-2 border-white bg-[#F8FAFC] text-[#1E293B] shadow-2xs cursor-default focus:outline-none ${isOverflowHovered ? 'z-30' : 'z-0'}`}
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
              className="absolute top-full right-0 mt-1.5 px-2.5 py-1 bg-[#0F172A] text-[#FFFFFF] text-xs font-medium rounded-[6px] border border-[#334155] shadow-float max-w-xs sm:max-w-sm break-words z-50 pointer-events-none"
            >
              {overflowTooltipText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
