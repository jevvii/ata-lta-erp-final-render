import { useQuery, useQueryClient, keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { apiRequest, type ApiError } from '@/lib/api';
import { runBlockingAction, useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { isConcurrencyConflictError } from '@/components/common/ConflictResolutionModal';
import { useSessionStore } from '@/lib/session';
import { registerLocalMutation } from '@/lib/realtime';
import { broadcastEntityChange } from '@/lib/tabSync';
import { adminKeys } from './queryKeys';
import type { AdminUser, CreateUserInput, UpdateUserInput } from './types';

export function normalizeAdminUser(u: AdminUser): AdminUser {
  const isActive =
    typeof u.isActive === 'boolean'
      ? u.isActive
      : u.status
        ? u.status === 'Active'
        : true;
  const raw = u as unknown as Record<string, unknown>;
  const avatarUrl =
    (typeof raw.avatarUrl === 'string' && raw.avatarUrl.trim() !== '' ? raw.avatarUrl.trim() : null) ??
    (typeof raw.avatar_url === 'string' && raw.avatar_url.trim() !== '' ? raw.avatar_url.trim() : null) ??
    null;
  return {
    ...u,
    isActive,
    status: u.status ?? (isActive ? 'Active' : 'Disabled'),
    version: typeof u.version === 'number' ? u.version : 1,
    avatarUrl: avatarUrl ?? u.avatarUrl ?? null,
  };
}

export const normalizeUser = normalizeAdminUser;

// ============================================================================
// 1. Query Hooks
// ============================================================================

export interface UseUsersListOptions {
  entity?: string | null;
  enabled?: boolean;
}

export function useUsersList(options?: UseUsersListOptions) {
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const effectiveEntity = options?.entity ?? (activeEntity !== 'ALL' ? activeEntity : undefined);

  return useQuery<AdminUser[], ApiError>({
    queryKey: adminKeys.users(effectiveEntity),
    queryFn: async () => {
      const res = await apiRequest<{ data: AdminUser[] }>('/admin/users');
      const list = Array.isArray(res?.data) ? res.data : [];
      return list.map(normalizeAdminUser);
    },
    enabled: options?.enabled ?? true,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useUserDetail(id: string | null | undefined, enabled = true) {
  return useQuery<AdminUser, ApiError>({
    queryKey: adminKeys.userDetail(id || ''),
    queryFn: async () => {
      if (!id) throw new Error('User ID is required');
      const res = await apiRequest<{ data: AdminUser }>(`/admin/users/${id}`);
      return normalizeAdminUser(res.data);
    },
    enabled: Boolean(id) && enabled,
    staleTime: 60 * 1000,
  });
}

// ============================================================================
// 2. Direct Blocking Action Runners (Zero Optimistic Updates + OCC + CDC/TabSync)
// ============================================================================

/**
 * Creates a new user account via `runBlockingAction`.
 * Handles HTTP 403 `USER_LIMIT_REACHED` (active user cap of 15) verbatim.
 */
export async function createUserAction(
  data: CreateUserInput,
  activeEntity?: string | null,
  queryClient?: QueryClient
): Promise<AdminUser> {
  return runBlockingAction<AdminUser>({
    title: 'Creating User Account',
    message: `Provisioning user account for ${data.email}...`,
    actionName: 'Create User Account',
    successTitle: 'User Created',
    successMessage: `User account for ${data.name} (${data.email}) created successfully.`,
    apiCall: async () => {
      const res = await apiRequest<{ data: AdminUser }>('/admin/users', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      const created = normalizeAdminUser(res.data);

      registerLocalMutation('users', created.id, created.version ?? 1);

      if (queryClient) {
        queryClient.setQueriesData<AdminUser[]>(
          { queryKey: adminKeys.allUsers() },
          (old) => {
            if (!Array.isArray(old)) return old;
            const exists = old.some((u) => u.id === created.id);
            return exists
              ? old.map((u) => (u.id === created.id ? created : u))
              : [created, ...old];
          }
        );
        queryClient.setQueryData(adminKeys.userDetail(created.id), created);
        void queryClient.invalidateQueries({ queryKey: adminKeys.allUsers() });
        void queryClient.invalidateQueries({ queryKey: adminKeys.audit() });
      }

      broadcastEntityChange({
        domain: 'admin',
        entityId: created.id,
        entityData: created as unknown as Record<string, unknown>,
      });

      return created;
    },
    invalidateQueries: [
      adminKeys.allUsers(),
      adminKeys.users(activeEntity),
      adminKeys.audit(),
    ],
  });
}

/**
 * Updates an existing user's details, role, departments, entities, or active status.
 * Supports Optimistic Concurrency Control (`expectedVersion` / `If-Match`) and resets
 * the blocking modal store on HTTP 409 conflicts so `<ConflictResolutionModal />` can take over.
 */
export async function updateUserAction(
  id: string,
  data: UpdateUserInput,
  activeEntity?: string | null,
  queryClient?: QueryClient
): Promise<AdminUser> {
  const normalizedPayload: UpdateUserInput = {
    ...data,
    ...(data.status !== undefined && data.isActive === undefined
      ? { isActive: data.status === 'Active' }
      : {}),
  };

  try {
    return await runBlockingAction<AdminUser>({
      title: 'Updating User Account',
      message: 'Saving changes to user profile and permissions...',
      actionName: 'Update User Account',
      successTitle: 'User Updated',
      successMessage: 'User account details and permissions have been updated.',
      apiCall: async () => {
        const headers: Record<string, string> = {};
        if (normalizedPayload.expectedVersion !== undefined) {
          headers['If-Match'] = String(normalizedPayload.expectedVersion);
        }

        const res = await apiRequest<{ data: AdminUser }>(`/admin/users/${id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(normalizedPayload),
        });
        const updated = normalizeAdminUser(res.data);

        const nextVersion =
          updated.version ??
          (normalizedPayload.expectedVersion !== undefined
            ? normalizedPayload.expectedVersion + 1
            : 1);
        registerLocalMutation('users', updated.id || id, nextVersion);

        if (queryClient) {
          queryClient.setQueriesData<AdminUser[]>(
            { queryKey: adminKeys.allUsers() },
            (old) => {
              if (!Array.isArray(old)) return old;
              return old.map((u) => (u.id === id ? { ...u, ...updated } : u));
            }
          );
          queryClient.setQueryData(adminKeys.userDetail(id), updated);
          void queryClient.invalidateQueries({ queryKey: adminKeys.allUsers() });
          void queryClient.invalidateQueries({ queryKey: adminKeys.audit() });
        }

        broadcastEntityChange({
          domain: 'admin',
          entityId: updated.id || id,
          entityData: updated as unknown as Record<string, unknown>,
        });

        return updated;
      },
      invalidateQueries: [
        adminKeys.allUsers(),
        adminKeys.users(activeEntity),
        adminKeys.userDetail(id),
        adminKeys.audit(),
      ],
    });
  } catch (err) {
    if (isConcurrencyConflictError(err)) {
      useBlockingModalStore.getState().reset();
    }
    throw err;
  }
}

/**
 * Soft-disables a user account (`DELETE /v1/admin/users/:id`).
 * Supports OCC `expectedVersion` and resets the blocking modal store on HTTP 409 conflicts.
 */
export async function disableUserAction(
  id: string,
  userNameOrOptions?: string | { userName?: string; expectedVersion?: number },
  activeEntity?: string | null,
  expectedVersionArg?: number,
  queryClient?: QueryClient
): Promise<void> {
  const userName =
    typeof userNameOrOptions === 'string'
      ? userNameOrOptions
      : userNameOrOptions?.userName;
  const expectedVersion =
    typeof userNameOrOptions === 'object' && userNameOrOptions !== null
      ? userNameOrOptions.expectedVersion
      : expectedVersionArg;

  try {
    await runBlockingAction<void>({
      title: 'Disabling User Account',
      message: `Deactivating account access for ${userName || id} and evicting active sessions...`,
      actionName: 'Disable User Account',
      successTitle: 'User Disabled',
      successMessage: `User account ${userName || ''} has been disabled.`,
      apiCall: async () => {
        const headers: Record<string, string> = {};
        if (expectedVersion !== undefined) {
          headers['If-Match'] = String(expectedVersion);
        }

        await apiRequest<void>(`/admin/users/${id}`, {
          method: 'DELETE',
          headers,
          body:
            expectedVersion !== undefined
              ? JSON.stringify({ expectedVersion })
              : undefined,
        });

        const nextVersion = expectedVersion !== undefined ? expectedVersion + 1 : 1;
        registerLocalMutation('users', id, nextVersion);

        if (queryClient) {
          queryClient.setQueriesData<AdminUser[]>(
            { queryKey: adminKeys.allUsers() },
            (old) => {
              if (!Array.isArray(old)) return old;
              return old.map((u) =>
                u.id === id
                  ? {
                      ...u,
                      isActive: false,
                      status: 'Disabled',
                      version: nextVersion,
                    }
                  : u
              );
            }
          );
          void queryClient.invalidateQueries({ queryKey: adminKeys.allUsers() });
          void queryClient.invalidateQueries({ queryKey: adminKeys.audit() });
        }

        broadcastEntityChange({
          domain: 'admin',
          entityId: id,
          entityData: { id, isActive: false, status: 'Disabled', version: nextVersion },
        });
      },
      invalidateQueries: [
        adminKeys.allUsers(),
        adminKeys.users(activeEntity),
        adminKeys.userDetail(id),
        adminKeys.audit(),
      ],
    });
  } catch (err) {
    if (isConcurrencyConflictError(err)) {
      useBlockingModalStore.getState().reset();
    }
    throw err;
  }
}

// ============================================================================
// 3. React Mutation Hook Wrapper
// ============================================================================

export function useUserMutations() {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const createUser = (data: CreateUserInput) =>
    createUserAction(data, activeEntity, queryClient);

  const updateUser = (id: string, data: UpdateUserInput) =>
    updateUserAction(id, data, activeEntity, queryClient);

  const disableUser = (
    id: string,
    userNameOrOptions?: string | { userName?: string; expectedVersion?: number },
    expectedVersion?: number
  ) =>
    disableUserAction(id, userNameOrOptions, activeEntity, expectedVersion, queryClient);

  return {
    createUser,
    updateUser,
    disableUser,
    createUserAction: createUser,
    updateUserAction: updateUser,
    disableUserAction: disableUser,
  };
}
