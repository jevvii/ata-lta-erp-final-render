import { QueryClient } from '@tanstack/react-query';
import { useSessionStore, type UserProfile } from './session';
import { setupTabSyncListener } from './tabSync';
import { syncSupabaseRealtimeAuth } from './supabase';

export const API_BASE_URL =
  (import.meta.env.ERP_API_BASE_URL as string | undefined) ||
  'https://ata-lta-erp-api-staging.onrender.com/v1';

export class ApiError extends Error {
  status: number;
  code?: string;
  detail?: string;

  constructor(status: number, message: string, detail?: string, code?: string) {
    super(detail || message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const getToken = (): string | null => {
  try {
    return localStorage.getItem('erp_access_token');
  } catch {
    return null;
  }
};

export const getRefreshToken = (): string | null => {
  try {
    return localStorage.getItem('erp_refresh_token');
  } catch {
    return null;
  }
};

export const setTokens = (accessToken: string, refreshToken?: string): void => {
  try {
    localStorage.setItem('erp_access_token', accessToken);
    if (refreshToken) {
      localStorage.setItem('erp_refresh_token', refreshToken);
    }
  } catch {
    // ignore
  }
  syncSupabaseRealtimeAuth(accessToken);
};

export const clearTokens = (): void => {
  try {
    localStorage.removeItem('erp_access_token');
    localStorage.removeItem('erp_refresh_token');
  } catch {
    // ignore
  }
  syncSupabaseRealtimeAuth(null);
};

/**
 * Global QueryClient per Spec §3.1:
 * staleTime: 30s, retry: 1, refetchOnWindowFocus: true, refetchOnReconnect: true
 *
 * Instant-feel tuning: cached pages render immediately on navigation
 * (staleTime window), while focus refetching (background, keeps previous data
 * rendered) and full stale-marking after every blocking mutation guarantee the
 * UI never shows records older than the latest write — no manual refresh
 * required anywhere in the app.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      retry: (failureCount, error) =>
        ![401, 403, 404].includes((error as ApiError).status) && failureCount < 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
});

// Mount cross-tab synchronization listener across open tabs (Spec §4.2, Parcel A)
setupTabSyncListener(queryClient);


function areSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

function areStringArraysEqual(a?: string[] | null, b?: string[] | null): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

let currentScopeGeneration = 0;

export const getScopeGeneration = (): number => currentScopeGeneration;

/**
 * Entity, User, Role, Status, Departments, Entities, or Permissions switch ⇒ cancel in-flight queries and refresh/reset cache.
 * Tracks currentScopeGeneration to ensure stale in-flight fetches/rollbacks are rejected.
 * Value-checks permissions and array fields to avoid clearing cache on same-value /me refreshes.
 */
useSessionStore.subscribe((state, prevState) => {
  const user = state.user;
  const prevUser = prevState.user;

  const userChanged = user?.id !== prevUser?.id;
  const roleChanged = user?.role !== prevUser?.role;
  const isActiveChanged = user?.isActive !== prevUser?.isActive;
  const entitiesChanged = !areStringArraysEqual(user?.entities, prevUser?.entities);
  const deptsChanged = !areStringArraysEqual(user?.departments, prevUser?.departments);
  const permsChanged = !areSetsEqual(state.permissions, prevState.permissions);
  const entityChanged = state.activeEntity !== prevState.activeEntity;

  const authorityChanged =
    userChanged ||
    roleChanged ||
    isActiveChanged ||
    entitiesChanged ||
    deptsChanged ||
    permsChanged;

  if (authorityChanged || entityChanged) {
    currentScopeGeneration++;
    void queryClient.cancelQueries();
    // Keep active observers attached so private rows disappear immediately.
    // clear() removes queries without notifying their mounted observers.
    queryClient.removeQueries({ type: 'inactive' });
    void queryClient.resetQueries();
  }
});

export interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
}

let refreshInFlight: Promise<string | null> | null = null;

function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return Promise.resolve(null);
  refreshInFlight = (async () => {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return null;
    const { data } = await response.json() as { data: { accessToken: string; refreshToken?: string } };
    // Do not restore a session that was signed out while refresh was pending.
    if (getRefreshToken() !== refreshToken) return getToken();
    setTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

export async function apiRequest<T = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const cleanPath = path.startsWith('/v1/') ? path.slice(3) : path === '/v1' ? '' : path;
  const url = `${API_BASE_URL}${cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`}`;
  const token = getToken();

  // Scope tracking: capture generation and direct identity values
  const capturedGeneration = currentScopeGeneration;
  const capturedUserId = useSessionStore.getState().user?.id ?? null;
  const capturedEntity = useSessionStore.getState().activeEntity ?? null;
  const isSkipAuth = Boolean(options.skipAuth);

  const checkScopeSafety = () => {
    if (isSkipAuth) return;
    if (options.signal?.aborted) {
      throw new ApiError(499, 'Request aborted by client');
    }
    const nowUserId = useSessionStore.getState().user?.id ?? null;
    const nowEntity = useSessionStore.getState().activeEntity ?? null;
    if (
      currentScopeGeneration !== capturedGeneration ||
      nowUserId !== capturedUserId ||
      nowEntity !== capturedEntity
    ) {
      throw new ApiError(499, 'Request aborted: session or entity scope changed during request');
    }
  };

  const activeEntity = capturedEntity;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token && !options.skipAuth) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Normalize entity header handling case-insensitively
  const entityHeaderKeys = Object.keys(headers).filter(
    (k) => k.toLowerCase() === 'x-active-entity'
  );

  if (activeEntity && activeEntity !== 'ALL' && entityHeaderKeys.length === 0) {
    headers['X-Active-Entity'] = activeEntity;
  }

  for (const key of entityHeaderKeys) {
    if (headers[key]?.trim().toUpperCase() === 'ALL') {
      delete headers[key];
    }
  }

  const methodUpper = (options.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(methodUpper) && !headers['Idempotency-Key']) {
    headers['Idempotency-Key'] =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `idemp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  let res = await fetch(url, {
    ...options,
    cache: 'no-cache',
    headers,
  });

  // Scope check #1: immediate post-fetch
  checkScopeSafety();

  // Handle 401 with token refresh attempt (Spec 3.2, R6)
  if (res.status === 401 && !path.startsWith('/auth/')) {
    // Concurrent 401s share one refresh; late responses use the rotated token.
    const latestToken = getToken();
    const accessToken = latestToken && latestToken !== token ? latestToken : await refreshAccessToken();
    // Scope check #2: recheck scope immediately AFTER refresh/latest-token resolution and BEFORE issuing any retry fetch
    checkScopeSafety();
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await fetch(url, { ...options, cache: 'no-cache', headers });
    }

    // Scope check #3: post-401 retry response
    checkScopeSafety();

    if (res.status === 401) {
      // Refresh failed or retry returned 401 -> logout & redirect (R6)
      clearTokens();
      useSessionStore.getState().clearSession();
      queryClient.clear();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      throw new ApiError(401, 'Unauthorized', 'Session expired. Please sign in again.');
    }
  }

  if (!res.ok) {
    let errorDetail = `HTTP ${res.status}`;
    let errorCode: string | undefined;
    try {
      const errBody = (await res.json()) as { message?: string; detail?: string; code?: string; title?: string };
      errorDetail = errBody.detail || errBody.message || errBody.title || errorDetail;
      errorCode = errBody.code;
    } catch {
      // ignore
    }
    // Scope check #3: post-error parsing
    checkScopeSafety();
    throw new ApiError(res.status, res.statusText, errorDetail, errorCode);
  }

  if (res.status === 204) {
    checkScopeSafety();
    return null as T;
  }

  const data = (await res.json()) as T;
  // Scope check #4: post-body parsing before returning
  checkScopeSafety();
  return data;
}

export interface SignInResponse {
  data: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  };
}

export interface MeResponse {
  data: UserProfile & {
    activeEntity?: string;
    permissions?: string[];
    unread_notifications?: number;
  };
}

export async function signIn(email: string, password: string): Promise<SignInResponse['data']> {
  const result = await apiRequest<SignInResponse>('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    skipAuth: true,
  });
  setTokens(result.data.accessToken, result.data.refreshToken);
  return result.data;
}

export async function getMe(): Promise<MeResponse['data']> {
  const result = await apiRequest<MeResponse>('/me');
  return result.data;
}

export function signOut(): void {
  clearTokens();
  useSessionStore.getState().clearSession();
  queryClient.clear();
}
