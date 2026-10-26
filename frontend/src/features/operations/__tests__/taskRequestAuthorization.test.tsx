import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import type { UserProfile } from '@/lib/session';
import {
  canRequestInvoice,
  canRequestTransmittal,
  isTaskAssignee,
  isRoleAdmin,
} from '../lib/taskScope';
import type { Task, WorkRequest } from '../api/types';

const targetTask: Task = {
  id: '33333333-3333-4333-8333-333333333333',
  workRequestId: '22222222-2222-4222-8222-222222222222',
  title: 'Target Sub-Task',
  description: 'Work item requiring financial requests',
  status: 'In Progress',
  phase: 'processing',
  qaStatus: 'none',
  phaseEnteredAt: '2026-03-01T00:00:00Z',
  assigneeId: 'emp-lead-1',
  assigneeName: 'Target Lead',
  assignees: ['emp-lead-1', 'emp-co-1'],
  taskAssignees: [
    { taskId: '33333333-3333-4333-8333-333333333333', userId: 'emp-lead-1', userName: 'Target Lead', assignedBy: null, assignedAt: null },
    { taskId: '33333333-3333-4333-8333-333333333333', userId: 'emp-co-1', userName: 'Target Co-Staff', assignedBy: null, assignedAt: null },
  ],
  predecessors: [],
  dueDate: '2026-04-15T00:00:00Z',
  requiredLinkType: null,
  displayOrder: 1,
  version: 1,
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
};

const siblingTask: Task = {
  ...targetTask,
  id: '44444444-4444-4444-8444-444444444444',
  title: 'Sibling Task',
  assigneeId: 'emp-sibling-1',
  assignees: ['emp-sibling-1'],
  taskAssignees: [{ taskId: '44444444-4444-4444-8444-444444444444', userId: 'emp-sibling-1', userName: 'Sibling Staff', assignedBy: null, assignedAt: null }],
};

const baseWr: WorkRequest = {
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Shared Parent Work Request',
  description: 'Parent work request container',
  entity: 'ATA',
  clientId: 'client-1',
  clientName: 'Alpha Corp',
  phase: 'processing',
  status: 'In Progress',
  priority: 'High',
  archived: false,
  onHold: false,
  phaseEnteredAt: '2026-03-01T00:00:00Z',
  dueDate: '2026-04-30T00:00:00Z',
  requestedBy: 'user-req-1',
  assignedTo: 'mgr-lead-wr',
  assignedToName: 'WR Lead Manager',
  coAssignees: ['emp-sibling-1', 'emp-lead-1'],
  version: 1,
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
  tasks: [targetTask, siblingTask],
};

describe('F01 & F03: Operations Requests Assignment Scoping Unit Tests', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('denies sibling-task assigned users from requesting invoice and transmittal (No sibling fallback)', () => {
    const siblingOpsUser: UserProfile = {
      id: 'emp-sibling-1',
      email: 'sibling.ops@ata-lta.ph',
      name: 'Sibling Ops Staff',
      role: 'Staff',
      departments: ['Operations'],
      entities: ['ATA'],
    };
    // Sibling assignee is in WR, assigned to siblingTask, but NOT targetTask
    expect(isTaskAssignee(siblingOpsUser, targetTask)).toBe(false);
    expect(canRequestInvoice(siblingOpsUser, targetTask, baseWr, [targetTask, siblingTask])).toBe(false);
    expect(canRequestTransmittal(siblingOpsUser, targetTask, baseWr, [targetTask, siblingTask])).toBe(false);

    const siblingManagerUser: UserProfile = {
      id: 'emp-sibling-1',
      email: 'sibling.mgr@ata-lta.ph',
      name: 'Sibling Manager',
      role: 'Manager',
      departments: ['Management'],
      entities: ['ATA'],
    };
    expect(canRequestInvoice(siblingManagerUser, targetTask, baseWr, [targetTask, siblingTask])).toBe(false);
    expect(canRequestTransmittal(siblingManagerUser, targetTask, baseWr, [targetTask, siblingTask])).toBe(false);
  });

  it('denies WR lead manager who is not assigned to the target task (No parent WR fallback)', () => {
    const wrManagerUser: UserProfile = {
      id: 'mgr-lead-wr',
      email: 'wr.mgr@ata-lta.ph',
      name: 'WR Lead Manager',
      role: 'Manager',
      departments: ['Management'],
      entities: ['ATA'],
    };
    expect(isTaskAssignee(wrManagerUser, targetTask)).toBe(false);
    expect(canRequestInvoice(wrManagerUser, targetTask, baseWr, [targetTask, siblingTask])).toBe(false);
    expect(canRequestTransmittal(wrManagerUser, targetTask, baseWr, [targetTask, siblingTask])).toBe(false);
  });

  it('allows primary lead assignee and relational co-assignee for Operations and Manager', () => {
    // 1. Lead assignee
    const leadOpsUser: UserProfile = {
      id: 'emp-lead-1',
      email: 'lead.ops@ata-lta.ph',
      name: 'Lead Ops Staff',
      role: 'Staff',
      departments: ['Operations'],
      entities: ['ATA'],
    };
    expect(isTaskAssignee(leadOpsUser, targetTask)).toBe(true);
    expect(canRequestInvoice(leadOpsUser, targetTask, baseWr, [targetTask])).toBe(true);
    expect(canRequestTransmittal(leadOpsUser, targetTask, baseWr, [targetTask])).toBe(true);

    // 2. Relational co-assignee
    const coOpsUser: UserProfile = {
      id: 'emp-co-1',
      email: 'co.ops@ata-lta.ph',
      name: 'Co Ops Staff',
      role: 'Staff',
      departments: ['Operations'],
      entities: ['ATA'],
    };
    expect(isTaskAssignee(coOpsUser, targetTask)).toBe(true);
    expect(canRequestInvoice(coOpsUser, targetTask, baseWr, [targetTask])).toBe(true);
    expect(canRequestTransmittal(coOpsUser, targetTask, baseWr, [targetTask])).toBe(true);

    // 3. Manager assigned as lead
    const leadMgrUser: UserProfile = {
      id: 'emp-lead-1',
      email: 'lead.mgr@ata-lta.ph',
      name: 'Lead Manager',
      role: 'Manager',
      departments: ['Management'],
      entities: ['ATA'],
    };
    expect(canRequestInvoice(leadMgrUser, targetTask, baseWr, [targetTask])).toBe(true);
    expect(canRequestTransmittal(leadMgrUser, targetTask, baseWr, [targetTask])).toBe(true);
  });

  it('supports legacy role profiles and department profiles consistently', () => {
    const legacyOpsUser: UserProfile = {
      id: 'emp-lead-1',
      email: 'legacy.ops@ata-lta.ph',
      name: 'Legacy Ops',
      role: 'Operations',
      departments: [],
      entities: ['ATA'],
    };
    expect(canRequestInvoice(legacyOpsUser, targetTask, baseWr, [targetTask])).toBe(true);
    expect(canRequestTransmittal(legacyOpsUser, targetTask, baseWr, [targetTask])).toBe(true);

    const legacyMgrUser: UserProfile = {
      id: 'emp-lead-1',
      email: 'legacy.mgr@ata-lta.ph',
      name: 'Legacy Manager',
      role: 'Manager',
      departments: [],
      entities: ['ATA'],
    };
    expect(canRequestInvoice(legacyMgrUser, targetTask, baseWr, [targetTask])).toBe(true);
    expect(canRequestTransmittal(legacyMgrUser, targetTask, baseWr, [targetTask])).toBe(true);
  });

  it('preserves direct issuance and role exclusion boundaries', () => {
    // Admin links directly; does not request
    const adminUser: UserProfile = {
      id: 'emp-lead-1',
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      departments: ['Management'],
      entities: ['ATA'],
    };
    expect(canRequestInvoice(adminUser, targetTask, baseWr, [targetTask])).toBe(false);
    expect(canRequestTransmittal(adminUser, targetTask, baseWr, [targetTask])).toBe(false);

    // Accounting directly issues invoices; excluded from transmittal requests
    const acctUser: UserProfile = {
      id: 'emp-lead-1',
      email: 'acct@ata-lta.ph',
      name: 'Accounting',
      role: 'Accounting',
      departments: ['Accounting'],
      entities: ['ATA'],
    };
    expect(canRequestInvoice(acctUser, targetTask, baseWr, [targetTask])).toBe(false);
    expect(canRequestTransmittal(acctUser, targetTask, baseWr, [targetTask])).toBe(false);

    // Documentation directly issues transmittals; explicitly denied invoice requests
    const docUser: UserProfile = {
      id: 'emp-lead-1',
      email: 'doc@ata-lta.ph',
      name: 'Documentation',
      role: 'Documentation',
      departments: ['Documentation'],
      entities: ['ATA'],
    };
    expect(canRequestInvoice(docUser, targetTask, baseWr, [targetTask])).toBe(false);
    expect(canRequestTransmittal(docUser, targetTask, baseWr, [targetTask])).toBe(false);

    // Mixed Documentation + Operations user is STILL denied invoice requests
    const mixedDocOpsUser: UserProfile = {
      id: 'emp-lead-1',
      email: 'mixed@ata-lta.ph',
      name: 'Doc and Ops',
      role: 'Staff',
      departments: ['Operations', 'Documentation'],
      entities: ['ATA'],
    };
    expect(canRequestInvoice(mixedDocOpsUser, targetTask, baseWr, [targetTask])).toBe(false);
  });

  it('verifies isRoleAdmin rejects email-only privilege without Admin role', () => {
    const emailPrivilegeUser: UserProfile = {
      id: 'emp-lorein',
      email: 'lorein@ata-lta.ph',
      name: 'Lorein',
      role: 'Staff',
      departments: ['Operations'],
      entities: ['ATA'],
    };
    expect(isRoleAdmin(emailPrivilegeUser)).toBe(false);

    const actualAdminUser: UserProfile = {
      id: 'emp-admin',
      email: 'admin@ata-lta.ph',
      name: 'Admin User',
      role: 'Admin',
      departments: ['Management'],
      entities: ['ATA'],
    };
    expect(isRoleAdmin(actualAdminUser)).toBe(true);
  });
});
