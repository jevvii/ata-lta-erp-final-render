// ============================================================================
// 1. User Management Types
// ============================================================================

export type DepartmentName =
  | 'Management'
  | 'Accounting'
  | 'Operations'
  | 'Documentation'
  | 'HR';

export type Department = DepartmentName;

export type UserRole =
  | 'Admin'
  | 'Manager'
  | 'Accounting'
  | 'Operations'
  | 'Documentation'
  | 'HR';

export type EntityCode = 'ATA' | 'LTA';

export type UserStatus = 'Active' | 'Disabled';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  departments: DepartmentName[];
  entities: EntityCode[];
  isActive: boolean;
  status?: UserStatus;
  version?: number;
  avatarUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  userNumber?: string | null;
  user_number?: string | null;
}

export type UserRecord = AdminUser;

export interface CreateUserInput {
  email: string;
  name: string;
  role: UserRole;
  departments?: DepartmentName[];
  entities: EntityCode[];
  isActive?: boolean;
  password?: string;
}

export interface UpdateUserInput {
  email?: string;
  name?: string;
  role?: UserRole;
  departments?: DepartmentName[];
  entities?: EntityCode[];
  isActive?: boolean;
  status?: UserStatus;
  password?: string;
  expectedVersion?: number;
}

// ============================================================================
// 2. Audit Log Types
// ============================================================================

export interface AuditLogEntry {
  id: string;
  action: string;
  tableName: string | null;
  table_name?: string | null;
  recordId: string | null;
  record_id?: string | null;
  entity: string | null;
  userId: string | null;
  user_id?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  actorAvatarUrl?: string | null;
  actor_avatar_url?: string | null;
  ipAddress?: string | null;
  ip_address?: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  created_at?: string;
  timestamp?: string;
  auditNumber?: string | null;
  audit_number?: string | null;
}

export interface AuditLogResponse {
  data: AuditLogEntry[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface AuditLogFilterParams {
  page?: number;
  limit?: number;
  offset?: number;
  module?: string;
  action?: string;
  table?: string;
  tableName?: string;
  userId?: string;
  actor?: string;
  search?: string;
  date?: string;
  from?: string;
  to?: string;
  sortOrder?: 'asc' | 'desc';
  entity?: string | null;
  enabled?: boolean;
}

// ============================================================================
// 3. RFC 7807 Problem Details Error Type
// ============================================================================

export interface ProblemDetailsError {
  type?: string;
  title: string;
  status: number;
  detail: string;
  code?: string;
  errors?: Record<string, string[]>;
}
