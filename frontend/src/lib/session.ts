import { create } from 'zustand';
import { syncSupabaseRealtimeAuth } from './supabase';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: string;
  departments: string[];
  entities: string[];
  isActive?: boolean;
  avatarUrl?: string | null;
  preferences?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface SessionState {
  user: UserProfile | null;
  permissions: Set<string>;
  activeEntity: string | null;
  unreadCount: number;
  isAuthenticated: boolean;
  isLoading: boolean;

  setSession: (params: {
    user: UserProfile;
    permissions: readonly string[] | string[] | Set<string>;
    activeEntity?: string | null;
    unreadCount?: number;
  }) => void;
  updateUser?: (patch: Partial<UserProfile>) => void;
  setActiveEntity: (entity: string | null) => void;
  setUnreadCount: (count: number) => void;
  clearSession: () => void;
  setLoading: (isLoading: boolean) => void;
}

export const ACTIVE_ENTITY_STORAGE_KEY = 'erp_active_entity';

const initialStoredEntity =
  typeof localStorage !== 'undefined'
    ? localStorage.getItem(ACTIVE_ENTITY_STORAGE_KEY)
    : null;

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  permissions: new Set<string>(),
  activeEntity: initialStoredEntity,
  unreadCount: 0,
  isAuthenticated: false,
  isLoading: true,

  setSession: ({ user, permissions, activeEntity, unreadCount }) => {
    const permSet = permissions instanceof Set ? permissions : new Set(permissions);

    let chosenEntity: string | null = null;
    if (activeEntity !== undefined) {
      chosenEntity = activeEntity;
    } else {
      const stored =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem(ACTIVE_ENTITY_STORAGE_KEY)
          : null;
      if (stored && (stored === 'ALL' || (Array.isArray(user.entities) && user.entities.includes(stored)))) {
        chosenEntity = stored;
      } else if (user.entities && user.entities.length > 0) {
        chosenEntity = user.entities[0] ?? null;
      }
    }

    try {
      if (chosenEntity) {
        localStorage.setItem(ACTIVE_ENTITY_STORAGE_KEY, chosenEntity);
      } else {
        localStorage.removeItem(ACTIVE_ENTITY_STORAGE_KEY);
      }
    } catch {
      // ignore
    }

    syncSupabaseRealtimeAuth();
    set({
      user,
      permissions: permSet,
      activeEntity: chosenEntity,
      unreadCount: unreadCount ?? 0,
      isAuthenticated: true,
      isLoading: false,
    });
  },

  updateUser: (patch) => {
    set((state) => {
      if (!state.user) return state;
      return {
        user: {
          ...state.user,
          ...patch,
        },
      };
    });
  },

  setActiveEntity: (entity) => {
    try {
      if (entity) {
        localStorage.setItem(ACTIVE_ENTITY_STORAGE_KEY, entity);
      } else {
        localStorage.removeItem(ACTIVE_ENTITY_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
    set({ activeEntity: entity });
  },

  setUnreadCount: (count) => {
    set({ unreadCount: Math.max(0, count) });
  },

  clearSession: () => {
    try {
      localStorage.removeItem('erp_access_token');
      localStorage.removeItem('erp_refresh_token');
      localStorage.removeItem(ACTIVE_ENTITY_STORAGE_KEY);
    } catch {
      // ignore
    }
    syncSupabaseRealtimeAuth(null);
    set({
      user: null,
      permissions: new Set<string>(),
      activeEntity: null,
      unreadCount: 0,
      isAuthenticated: false,
      isLoading: false,
    });
  },

  setLoading: (isLoading) => {
    set({ isLoading });
  },
}));
