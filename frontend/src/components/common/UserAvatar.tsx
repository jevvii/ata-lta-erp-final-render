import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryClient as globalQueryClient } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import { cn } from '@/lib/utils';

export interface UserAvatarProps {
  userId?: string | null;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  size?: '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  shape?: 'circle' | 'rounded';
  className?: string;
  imgClassName?: string;
  fallbackClassName?: string;
  title?: string;
  ring?: boolean;
  imgTestId?: string;
  initialsTestId?: string;
  'data-testid'?: string;
}

const AVATAR_PALETTE = [
  '#1D4ED8', // blue
  '#047857', // emerald
  '#6D28D9', // violet
  '#B45309', // amber
  '#BE123C', // rose
  '#0E7490', // cyan
  '#4338CA', // indigo
  '#334155', // slate
];

export function getAvatarColorStyle(idOrKey: string): { bg: string; color: string; backgroundColor: string } {
  let hash = 0;
  const str = idOrKey || '?';
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_PALETTE.length;
  const bg = AVATAR_PALETTE[index] ?? '#1D4ED8';
  return {
    bg,
    color: '#FFFFFF',
    backgroundColor: bg,
  };
}

export function getUserInitials(nameOrEmail?: string | null): string {
  if (!nameOrEmail) return '?';
  const clean = nameOrEmail.trim();
  if (!clean || clean === '?') return '?';

  const isEmail = clean.includes('@');
  const text = isEmail ? (clean.split('@')[0] || clean) : clean;
  const parts = text.split(isEmail ? /[\s._-]+/ : /\s+/).filter(Boolean);

  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    const single = parts[0]!;
    if (single.length >= 2) return single.slice(0, 2).toUpperCase();
    return single.toUpperCase();
  }
  const first = parts[0]?.[0] ?? '';
  const last = parts[parts.length - 1]?.[0] ?? '';
  const result = (first + last).toUpperCase();
  return result || '?';
}

function findAvatarInQueries(
  queriesData: Array<[unknown, unknown]>,
  userId?: string | null,
  email?: string | null,
  name?: string | null
): string | null {
  for (const [, queryData] of queriesData) {
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

      const matchesId = Boolean(userId && itemId && itemId === userId);
      const matchesEmail = Boolean(email && itemEmail && itemEmail.toLowerCase() === email.toLowerCase());
      const matchesName = Boolean(name && itemName && itemName.trim().toLowerCase() === name.trim().toLowerCase());

      if (matchesId || matchesEmail || matchesName) {
        const rawUrl = rec.avatarUrl || rec.avatar_url;
        if (typeof rawUrl === 'string' && rawUrl.trim() !== '') {
          return rawUrl.trim();
        }
      }
    }
  }
  return null;
}

export function useResolvedAvatarUrl({
  userId,
  name,
  email,
  avatarUrl,
}: {
  userId?: string | null;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}): string | null {
  // Always call hooks unconditionally at the top level
  const sessionUser = useSessionStore((s) => s.user);

  let hookQueryClient = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    hookQueryClient = useQueryClient();
  } catch {
    hookQueryClient = null;
  }

  // 1. Direct non-empty prop takes highest precedence
  if (typeof avatarUrl === 'string' && avatarUrl.trim() !== '') {
    return avatarUrl.trim();
  }

  // 2. Check current session user
  if (sessionUser?.avatarUrl && typeof sessionUser.avatarUrl === 'string' && sessionUser.avatarUrl.trim() !== '') {
    const matchesId = Boolean(userId && sessionUser.id && sessionUser.id === userId);
    const matchesEmail = Boolean(email && sessionUser.email && sessionUser.email.toLowerCase() === email.toLowerCase());
    const matchesName = Boolean(name && sessionUser.name && sessionUser.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (matchesId || matchesEmail || matchesName) {
      return sessionUser.avatarUrl.trim();
    }
  }

  // 3. Check QueryClient cache: try useQueryClient() hook, then fallback to globalQueryClient
  const clientsToCheck = [hookQueryClient, globalQueryClient].filter(Boolean);

  for (const qc of clientsToCheck) {
    if (!qc) continue;
    try {
      const candidateQueries = [
        ...qc.getQueriesData<unknown>({ queryKey: ['me', 'team'] }),
        ...qc.getQueriesData<unknown>({ queryKey: ['admin', 'users'] }),
      ];
      const match = findAvatarInQueries(candidateQueries, userId, email, name);
      if (match) {
        return match;
      }
    } catch {
      // safe fallback
    }
  }

  return null;
}

const SIZE_CLASSES = {
  '2xs': 'h-4 w-4 text-[8px]',
  'xs': 'h-5 w-5 text-[9px]',
  'sm': 'h-7 w-7 text-xs',
  'md': 'h-8 w-8 text-sm',
  'lg': 'h-10 w-10 text-base',
  'xl': 'h-12 w-12 text-lg',
};

const SHAPE_CLASSES = {
  circle: 'rounded-full',
  rounded: 'rounded-[6px]',
};

export function UserAvatar({
  userId,
  name,
  email,
  avatarUrl,
  size = 'md',
  shape = 'circle',
  className,
  imgClassName,
  fallbackClassName,
  title,
  ring = false,
  imgTestId,
  initialsTestId,
  'data-testid': dataTestId,
}: UserAvatarProps) {
  const resolvedUrl = useResolvedAvatarUrl({ userId, name, email, avatarUrl });
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [resolvedUrl]);

  const sizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES.md;
  const shapeClass = SHAPE_CLASSES[shape] ?? SHAPE_CLASSES.circle;
  const ringClass = ring ? 'ring-1 ring-white border border-white' : '';

  if (resolvedUrl && !imgError) {
    return (
      <div
        className={cn(
          'relative shrink-0 flex items-center justify-center overflow-hidden bg-white select-none',
          sizeClass,
          shapeClass,
          ringClass,
          className
        )}
        style={{
          backgroundImage: `url('${resolvedUrl}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
        data-testid={dataTestId}
        title={title}
      >
        <img
          src={resolvedUrl}
          alt={name || 'User avatar'}
          onError={() => setImgError(true)}
          data-testid={imgTestId}
          className={cn('h-full w-full object-cover', imgClassName)}
        />
      </div>
    );
  }

  const initials = getUserInitials(name || email || '?');
  const palette = getAvatarColorStyle(userId || email || name || '?');

  return (
    <div
      className={cn(
        'relative shrink-0 flex items-center justify-center font-bold select-none',
        sizeClass,
        shapeClass,
        ringClass,
        className,
        fallbackClassName
      )}
      style={{
        backgroundColor: palette.bg,
        color: '#FFFFFF',
      }}
      data-testid={dataTestId}
      title={title}
    >
      <span data-testid={initialsTestId}>{initials}</span>
    </div>
  );
}
