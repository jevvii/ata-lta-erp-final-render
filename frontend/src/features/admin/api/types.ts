/**
 * TypeScript Domain Models & Interface Contracts for Admin & Retainer Templates (Module #6)
 *
 * Citations:
 * - Frozen API Contract rbac-matrix@2.0.0 (docs/api-contracts/rbac-matrix.md)
 * - Retainers API Contract retainers@2.0.0 (docs/api-contracts/retainers.md)
 * - Retainer Templates Contract retainer-templates@2.0.0 (docs/api-contracts/modules/retainer-templates.md)
 * - Me Profile Contract me@2.0.0 (docs/api-contracts/modules/me.md)
 *
 * Compliance:
 * - Strict TypeScript 5.7+
 * - noUncheckedIndexedAccess: true compliant
 * - Zero `any` types
 */

import type { ChecklistItemData } from '@/features/operations/api/types';

// ============================================================================
// 1. Roles, Departments & Primitive Enums
// ============================================================================

export type UserRole =
  | 'Admin'
  | 'Manager'
  | 'Accounting'
  | 'Operations'
  | 'Documentation'
  | 'HR';

export type DepartmentName =
  | 'Management'
  | 'Accounting'
  | 'Operations'
  | 'Documentation'
  | 'HR';

export type EntityCode = 'ATA' | 'LTA';

export type RecurrenceType = 'none' | 'annual';

export type CreatablePhase = 'pre_processing' | 'processing';

export type Priority = 'Low' | 'Normal' | 'High' | 'Urgent';

// ============================================================================
// 2. Admin User Entities & DTOs
// ============================================================================

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  departments: DepartmentName[];
  entities: EntityCode[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  email: string;
  name: string;
  role: UserRole;
  departments?: DepartmentName[];
  entities: EntityCode[];
  isActive?: boolean;
  password?: string;
}

export type UpdateUserInput = Partial<CreateUserInput>;

// ============================================================================
// 3. Retainer Template Entities & Task Blueprint
// ============================================================================

export interface RetainerTemplateTask {
  id?: string | null;
  local_id?: string | null;
  localId?: string | null;
  title: string;
  description?: string | null;
  phase: CreatablePhase;
  default_assignees?: string[];
  defaultAssignees?: string[];
  depends_on_local_id?: string | null;
  dependsOnLocalId?: string | null;
  requiredLinkType?: string | null;
  required_link_type?: string | null;
  dueDate?: string | null;
  checklist?: ChecklistItemData[];
}

export interface RetainerTemplate {
  id: string;
  entity_id: string;
  entity?: EntityCode;
  name: string;
  title?: string;
  description: string | null;
  client_id: string | null;
  clientId?: string | null;
  schedule: string | null;
  priority: Priority;
  default_priority?: Priority;
  defaultPriority?: Priority;
  pf_amount: number;
  pfAmount?: number;
  recurrence: RecurrenceType;
  tasks: RetainerTemplateTask[];
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  entities?: { code: EntityCode };
  clients?: { name: string };
}

export interface CreateRetainerTemplateInput {
  name: string;
  description?: string | null;
  clientId?: string | null;
  client_id?: string | null;
  schedule?: string | null;
  priority?: Priority;
  pfAmount?: number;
  pf_amount?: number;
  recurrence?: RecurrenceType;
  tasks?: RetainerTemplateTask[];
}

export type UpdateRetainerTemplateInput = Partial<CreateRetainerTemplateInput>;

export interface RetainerGenerateOverrides {
  title?: string;
  description?: string | null;
  clientId?: string | null;
  client_id?: string | null;
  priority?: Priority;
  assignedTo?: string | null;
  assigned_to?: string | null;
  coAssignees?: string[];
  co_assignees?: string[];
  dueDate?: string | null;
  due_date?: string | null;
}

export interface RetainerGenerateInput {
  period_label?: string | null;
  periodLabel?: string | null;
  overrides?: RetainerGenerateOverrides;
}

export interface RetainerGenerationRecord {
  id: string;
  template_id: string;
  work_request_id: string;
  period_label: string | null;
  generated_by: string;
  generated_at: string;
}

export interface RetainerGenerateResponse {
  id: string;
  title: string;
  phase: string;
  status: string;
  priority: string;
  clientId: string | null;
  generation: RetainerGenerationRecord;
}

// ============================================================================
// 4. Audit Log Entities & Retainer Generation Logs
// ============================================================================

export interface RetainerGenerationAuditDetails {
  templateId?: string;
  workRequestId?: string;
  periodLabel?: string | null;
  [key: string]: unknown;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  tableName: string;
  recordId: string;
  entity: EntityCode | string;
  userId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogMeta {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface AuditLogResponse {
  data: AuditLogEntry[];
  meta: AuditLogMeta;
}

export interface ListAuditQuery {
  table?: string;
  action?: string;
  userId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

// ============================================================================
// 5. RFC 7807 Problem Details
// ============================================================================

export interface ProblemDetails {
  status: number;
  title: string;
  detail: string;
  code?: string;
}

// ============================================================================
// 6. RBAC Matrix & Effective Permissions Helpers
// ============================================================================

export interface UserEffectivePermissions {
  user: AdminUser;
  effectivePermissions: string[];
  departmentSources: Record<string, DepartmentName[]>;
  isAdminSuperUser: boolean;
}
