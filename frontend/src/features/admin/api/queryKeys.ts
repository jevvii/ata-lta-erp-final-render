export const adminKeys = {
  all: ['admin'] as const,

  // Users
  allUsers: () => [...adminKeys.all, 'users'] as const,
  users: (entity?: string | null) =>
    [...adminKeys.all, 'users', { entity: entity ?? 'ALL' }] as const,
  userDetail: (id: string) => [...adminKeys.all, 'users', 'detail', id] as const,

  // Audit Logs
  audit: () => [...adminKeys.all, 'audit'] as const,
  auditLogs: (params?: Record<string, unknown>) =>
    [...adminKeys.all, 'audit', params ?? {}] as const,
  auditCount: (entity?: string | null) =>
    [...adminKeys.all, 'audit', 'count', { entity: entity ?? 'ALL' }] as const,
};
