/**
 * Unit tests for avatar mapping, work request number resolution, and disbursement counts logic.
 */

jest.mock('../../../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../../../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const disbursementsService = require('../../../../src/modules/disbursements/service');
const adminService = require('../../../../src/modules/admin/service');
const timeEntriesService = require('../../../../src/modules/timeEntries/service');
const { resetMock, seedDefaults, mockTables } = require('../../../fixtures/supabaseMock');

describe('Avatar and Disbursement Counts Unit Tests', () => {
  const ENTITY_ID = 'aaaaaaaa-1111-4111-8111-111111111101';
  const WR_ID = 'bbbbbbbb-1111-4111-8111-111111111102';
  const TASK_ID = 'cccccccc-1111-4111-8111-111111111103';

  const adminUser = {
    id: 'dddddddd-1111-4111-8111-111111111101',
    role: 'Admin',
    departments: ['Management'],
    entities: ['ATA'],
  };
  const accountingUser = {
    id: 'dddddddd-1111-4111-8111-111111111102',
    role: 'Staff',
    departments: ['Accounting'],
    entities: ['ATA'],
  };
  const staffUser = {
    id: 'dddddddd-1111-4111-8111-111111111103',
    role: 'Operations',
    departments: ['Operations'],
    entities: ['ATA'],
  };
  const outsideUser = {
    id: 'dddddddd-1111-4111-8111-111111111104',
    role: 'Documentation',
    departments: ['Documentation'],
    entities: ['ATA'],
  };

  const actorUser1 = {
    id: 'eeeeeeee-1111-4111-8111-111111111101',
    name: 'Actor One',
    role: 'Admin',
    avatar_url: 'https://cdn.example.com/avatars/actor1.jpg',
  };
  const actorUser2 = {
    id: 'eeeeeeee-1111-4111-8111-111111111102',
    name: 'Actor Two',
    role: 'Operations',
    avatar_url: 'https://cdn.example.com/avatars/actor2.jpg',
  };

  beforeEach(() => {
    resetMock();
    seedDefaults();

    // Seed Entity
    mockTables.entities.set(ENTITY_ID, {
      id: ENTITY_ID,
      code: 'ATA',
      name: 'ATA Entity',
    });

    // Seed Work Request
    mockTables.work_requests.set(WR_ID, {
      id: WR_ID,
      entity_id: ENTITY_ID,
      title: 'Project Alpha',
      work_request_number: 'WR-ATA-2026-0001',
      status: 'In Progress',
      creation_approval_status: 'approved',
      assigned_to: staffUser.id,
      co_assignees: [accountingUser.id],
      deleted_at: null,
    });

    // Seed Task
    mockTables.tasks.set(TASK_ID, {
      id: TASK_ID,
      work_request_id: WR_ID,
      title: 'Phase 1 Task',
      assignee_id: staffUser.id,
      deleted_at: null,
    });

    // Seed Users for avatar checks
    mockTables.users.set(actorUser1.id, actorUser1);
    mockTables.users.set(actorUser2.id, actorUser2);
  });

  describe('disbursementsService.getDisbursementCounts', () => {
    beforeEach(() => {
      // 1. Initial Requests: v2 Draft, review_ready = true
      mockTables.disbursements.set('disb-init-1', {
        id: 'disb-init-1',
        entity_id: ENTITY_ID,
        lifecycle_version: 2,
        status: 'Draft',
        review_ready: true,
        archived: false,
        created_by: staffUser.id,
        linked_work_request_id: WR_ID,
        linked_task_id: TASK_ID,
        deleted_at: null,
      });

      // 2. Ready for Funding: v2 Approved
      mockTables.disbursements.set('disb-ready-1', {
        id: 'disb-ready-1',
        entity_id: ENTITY_ID,
        lifecycle_version: 2,
        status: 'Approved',
        archived: false,
        created_by: staffUser.id,
        linked_work_request_id: WR_ID,
        linked_task_id: TASK_ID,
        deleted_at: null,
      });

      // 3. Payment Releases: v2 Funded
      mockTables.disbursements.set('disb-release-1', {
        id: 'disb-release-1',
        entity_id: ENTITY_ID,
        lifecycle_version: 2,
        status: 'Funded',
        archived: false,
        created_by: staffUser.id,
        linked_work_request_id: WR_ID,
        linked_task_id: TASK_ID,
        deleted_at: null,
      });

      // 4. Needs Correction: v2 Draft, review_ready = false
      mockTables.disbursements.set('disb-corr-1', {
        id: 'disb-corr-1',
        entity_id: ENTITY_ID,
        lifecycle_version: 2,
        status: 'Draft',
        review_ready: false,
        archived: false,
        created_by: staffUser.id,
        linked_work_request_id: WR_ID,
        linked_task_id: TASK_ID,
        deleted_at: null,
      });

      // 5. Rejected record
      mockTables.disbursements.set('disb-rej-1', {
        id: 'disb-rej-1',
        entity_id: ENTITY_ID,
        lifecycle_version: 2,
        status: 'Rejected',
        archived: false,
        created_by: staffUser.id,
        linked_work_request_id: WR_ID,
        linked_task_id: TASK_ID,
        deleted_at: null,
      });

      // 6. Archived record
      mockTables.disbursements.set('disb-arch-1', {
        id: 'disb-arch-1',
        entity_id: ENTITY_ID,
        lifecycle_version: 2,
        status: 'Draft',
        archived: true,
        created_by: staffUser.id,
        linked_work_request_id: WR_ID,
        linked_task_id: TASK_ID,
        deleted_at: null,
      });
    });

    it('correctly calculates counts across all queues for Admin', async () => {
      const counts = await disbursementsService.getDisbursementCounts({
        entityId: ENTITY_ID,
        user: adminUser,
      });

      expect(counts.initialRequests).toBe(1);
      expect(counts.readyForFunding).toBe(1);
      expect(counts.paymentReleases).toBe(1);
      expect(counts.awaitingRelease).toBe(1);
      expect(counts.needsCorrection).toBe(1);
      expect(counts.rejected).toBe(1);
      expect(counts.archived).toBe(1);
      expect(counts.active).toBe(5); // 5 non-archived non-cancelled
    });

    it('correctly calculates counts across all queues for Accounting', async () => {
      const counts = await disbursementsService.getDisbursementCounts({
        entityId: ENTITY_ID,
        user: accountingUser,
      });

      expect(counts.initialRequests).toBe(1);
      expect(counts.readyForFunding).toBe(1);
      expect(counts.paymentReleases).toBe(1);
      expect(counts.awaitingRelease).toBe(1);
      expect(counts.needsCorrection).toBe(0); // Only shows correction drafts created by the user
      expect(counts.rejected).toBe(1);
      expect(counts.archived).toBe(1);
      expect(counts.active).toBe(5);
    });

    it('project team member sees counts for their concerned work requests', async () => {
      const counts = await disbursementsService.getDisbursementCounts({
        entityId: ENTITY_ID,
        user: staffUser,
      });

      expect(counts.initialRequests).toBe(1);
      expect(counts.readyForFunding).toBe(1);
      expect(counts.paymentReleases).toBe(1);
      expect(counts.needsCorrection).toBe(1); // staffUser is the creator of disb-corr-1
      expect(counts.active).toBe(5);
    });

    it('outside user with no linked work requests sees zero counts', async () => {
      const counts = await disbursementsService.getDisbursementCounts({
        entityId: ENTITY_ID,
        user: outsideUser,
      });

      expect(counts.active).toBe(0);
      expect(counts.initialRequests).toBe(0);
      expect(counts.readyForFunding).toBe(0);
      expect(counts.paymentReleases).toBe(0);
      expect(counts.needsCorrection).toBe(0);
      expect(counts.archived).toBe(0);
      expect(counts.rejected).toBe(0);
    });
  });

  describe('disbursementsService.enrichDisbursementExtras', () => {
    it('enriches user avatar URLs and work request numbers cleanly', async () => {
      // Seed status history
      mockTables.status_history.set('hist-1', {
        id: 'hist-1',
        table_name: 'disbursements',
        record_id: 'disb-enrich-1',
        old_status: 'Draft',
        new_status: 'Approved',
        actor_id: actorUser1.id,
        details: { action: 'approve' },
        created_at: '2026-10-25T10:00:00Z',
      });

      const rawRows = [
        {
          id: 'disb-enrich-1',
          entity_id: ENTITY_ID,
          linked_work_request_id: WR_ID,
          created_by: actorUser2.id,
          requested_by: actorUser2.id,
          approved_by: actorUser1.id,
          employee_id: actorUser2.id,
          status: 'Approved',
        },
      ];

      const enriched = await disbursementsService.enrichDisbursementExtras(rawRows);
      expect(enriched).toHaveLength(1);

      const row = enriched[0];
      // Work request number mappings
      expect(row.work_request_number).toBe('WR-ATA-2026-0001');
      expect(row.workRequestNumber).toBe('WR-ATA-2026-0001');
      expect(row.linked_work_request_order_number).toBe('WR-ATA-2026-0001');
      expect(row.linked_work_request_name).toBe('Project Alpha');

      // Avatar mappings
      expect(row.created_by_avatar_url).toBe(actorUser2.avatar_url);
      expect(row.createdByAvatarUrl).toBe(actorUser2.avatar_url);
      expect(row.requester_avatar_url).toBe(actorUser2.avatar_url);
      expect(row.requesterAvatarUrl).toBe(actorUser2.avatar_url);
      expect(row.approved_by_avatar_url).toBe(actorUser1.avatar_url);
      expect(row.approvedByAvatarUrl).toBe(actorUser1.avatar_url);
      expect(row.employee_avatar_url).toBe(actorUser2.avatar_url);
      expect(row.employeeAvatarUrl).toBe(actorUser2.avatar_url);

      // Lifecycle history and audit trail avatars
      expect(row.lifecycle_history).toHaveLength(1);
      expect(row.lifecycle_history[0].actor_avatar_url).toBe(actorUser1.avatar_url);
      expect(row.lifecycle_history[0].actorAvatarUrl).toBe(actorUser1.avatar_url);
      expect(row.audit_trail).toEqual(row.lifecycle_history);
    });
  });

  describe('adminService.toApiUser and getAuditLogs avatar mappings', () => {
    it('toApiUser preserves avatarUrl and avatar_url', () => {
      const userRow = {
        id: 'user-av-1',
        user_number: 'USR-0001',
        email: 'user@example.com',
        name: 'Avatar User',
        role: 'Admin',
        avatar_url: 'https://cdn.example.com/avatar.png',
        is_active: true,
      };

      const apiUser = adminService.toApiUser(userRow, ['Management']);
      expect(apiUser.avatarUrl).toBe('https://cdn.example.com/avatar.png');
      expect(apiUser.avatar_url).toBe('https://cdn.example.com/avatar.png');
    });

    it('toApiUser defaults missing avatar_url to null', () => {
      const userRow = {
        id: 'user-av-2',
        email: 'user2@example.com',
        name: 'No Avatar User',
        role: 'Staff',
      };

      const apiUser = adminService.toApiUser(userRow);
      expect(apiUser.avatarUrl).toBeNull();
      expect(apiUser.avatar_url).toBeNull();
    });
  });

  describe('timeEntriesService.withLoggerProfiles avatar mappings', () => {
    it('enriches time entries with user_avatar_url and userAvatarUrl', async () => {
      const entries = [
        {
          id: 'time-entry-1',
          user_id: actorUser1.id,
          task_id: TASK_ID,
          duration_minutes: 120,
        },
        {
          id: 'time-entry-2',
          user_id: 'unknown-user-id',
          task_id: TASK_ID,
          duration_minutes: 60,
        },
      ];

      const enriched = await timeEntriesService.withLoggerProfiles(entries);
      expect(enriched).toHaveLength(2);

      // Entry 1 has profile with avatar
      expect(enriched[0].user_avatar_url).toBe(actorUser1.avatar_url);
      expect(enriched[0].userAvatarUrl).toBe(actorUser1.avatar_url);
      expect(enriched[0].user_name).toBe(actorUser1.name);

      // Entry 2 has unknown profile
      expect(enriched[1].user_avatar_url).toBeNull();
      expect(enriched[1].userAvatarUrl).toBeNull();
    });
  });
});
