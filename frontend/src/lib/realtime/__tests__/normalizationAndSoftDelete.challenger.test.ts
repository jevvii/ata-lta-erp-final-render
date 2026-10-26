/**
 * Empirical Adversarial Challenger Test Suite: Normalization & Soft-Delete Stress
 *
 * Verifies:
 * 1. normalizeCdcPayload across edge cases:
 *    - null/undefined records, non-object inputs
 *    - conflicting snake_case vs camelCase inputs (database precedence, boolean/numeric 0 safety)
 *    - missing fields and structural defaults
 *    - prototype pollution resistance (__proto__, constructor, prototype)
 *    - extreme integers (MAX_SAFE_INTEGER, MIN_SAFE_INTEGER, 0, negative integers)
 * 2. Soft delete detection:
 *    - isSoftDeleteRecord with null vs string, empty strings, mixed casing, falsy values
 *    - handleRealtimePayload soft-delete classification across eventTypes (UPDATE, DELETE, INSERT)
 * 3. Cache eviction & phase container purging:
 *    - detail cache eviction across all entity tables
 *    - list query eviction for both Array and { data, meta } structures
 *    - meta.total boundary safety (non-negative floor at 0)
 *    - parent work request phase containers (both within list data and workRequestDetail cache)
 *    - resilience when targetWrId is in payload.old vs payload.new
 *    - resilience under malformed / sparse phase containers
 *
 * STRICT INVARIANT: ZERO PLAYWRIGHT, ZERO HARDCODED SECRETS.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  normalizeCdcPayload,
  normalizeCdcTask,
  normalizeCdcWorkRequest,
  normalizeCdcOperationsRequest,
  normalizeCdcNotification,
  isSoftDeleteRecord,
  handleRealtimePayload,
  clearChannelRegistryForTesting,
} from '../useEntityRealtimeSync';
import { useSessionStore } from '@/lib/session';
import { resetTabIdForTesting } from '@/lib/tabSync';
import { clearLocalMutationsForTesting } from '../loopPrevention';
import { operationsKeys } from '@/features/operations/api/queryKeys';
import { billingKeys } from '@/features/billing/api/queryKeys';
import { disbursementKeys } from '@/features/disbursements/api/queryKeys';

describe('Adversarial Challenger: Normalization & Soft-Delete Stress Harness', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    localStorage.clear();
    clearLocalMutationsForTesting();
    clearChannelRegistryForTesting();
    resetTabIdForTesting('tab-challenger-norm-del');
    useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: 'admin-1',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearChannelRegistryForTesting();
    queryClient.clear();
    localStorage.clear();
    clearLocalMutationsForTesting();
    resetTabIdForTesting();
  });

  // =========================================================================
  // Section 1: normalizeCdcPayload Edge Cases
  // =========================================================================
  describe('1. normalizeCdcPayload Edge Cases', () => {
    it('1.1 gracefully survives null, undefined, and non-object inputs', () => {
      // @ts-expect-error testing null input
      expect(normalizeCdcPayload('tasks', null)).toBeNull();
      // @ts-expect-error testing undefined input
      expect(normalizeCdcPayload('tasks', undefined)).toBeUndefined();
      // @ts-expect-error testing primitive input
      expect(normalizeCdcPayload('tasks', 'string-payload')).toBe('string-payload');
      // @ts-expect-error testing number input
      expect(normalizeCdcPayload('tasks', 42)).toBe(42);
      // @ts-expect-error testing boolean input
      expect(normalizeCdcPayload('tasks', false)).toBe(false);

      // Same across all other entity normalizers
      // @ts-expect-error testing null input
      expect(normalizeCdcWorkRequest(null)).toBeNull();
      // @ts-expect-error testing null input
      expect(normalizeCdcOperationsRequest(null)).toBeNull();
      // @ts-expect-error testing null input
      expect(normalizeCdcNotification(null)).toBeNull();
      // Unknown table pass-through
      expect(normalizeCdcPayload('unknown_entity', { foo: 'bar' })).toEqual({ foo: 'bar' });
    });

    it('1.2 resolves conflicting snake_case and camelCase with database precedence', () => {
      // Case A: qa_status vs qaStatus
      const conflictingTask = normalizeCdcTask({
        id: 't-1',
        qa_status: 'passed',
        qaStatus: 'failed',
      });
      // Database snake_case 'passed' MUST win
      expect(conflictingTask.qaStatus).toBe('passed');
      expect(conflictingTask.qa_status).toBe('passed');

      // Case B: display_order 0 (falsy number) vs displayOrder 99
      const zeroOrderTask = normalizeCdcTask({
        id: 't-2',
        display_order: 0,
        displayOrder: 99,
      });
      // 0 must NOT be treated as nullish!
      expect(zeroOrderTask.displayOrder).toBe(0);
      expect(zeroOrderTask.display_order).toBe(0);

      // Case C: work_request_id vs workRequestId
      const conflictingWr = normalizeCdcTask({
        id: 't-3',
        work_request_id: 'wr-from-db',
        workRequestId: 'wr-from-client',
      });
      expect(conflictingWr.workRequestId).toBe('wr-from-db');
      expect(conflictingWr.work_request_id).toBe('wr-from-db');

      // Case D: explicit null in snake_case unassigns lead (overrides camelCase string)
      const unassignedTask = normalizeCdcTask({
        id: 't-4',
        assignee_id: null,
        assigneeId: 'user-keep',
        assignee_name: null,
        assigneeName: 'Alice',
      });
      expect(unassignedTask.assigneeId).toBeNull();
      expect(unassignedTask.assignee_id).toBeNull();
      expect(unassignedTask.assigneeName).toBeNull();
      expect(unassignedTask.assignee_name).toBeNull();

      // Case E: Work Request on_hold boolean conflict: false (falsy) vs true
      const wrHoldFalse = normalizeCdcWorkRequest({
        id: 'wr-1',
        on_hold: false,
        onHold: true,
      });
      // false must NOT be treated as nullish!
      expect(wrHoldFalse.onHold).toBe(false);
      expect(wrHoldFalse.on_hold).toBe(false);

      const wrHoldTrue = normalizeCdcWorkRequest({
        id: 'wr-2',
        on_hold: true,
        onHold: false,
      });
      expect(wrHoldTrue.onHold).toBe(true);
      expect(wrHoldTrue.on_hold).toBe(true);

      // Case F: Operations Request request_type vs type
      const conflictingOpsReq = normalizeCdcOperationsRequest({
        id: 'req-1',
        request_type: 'cancellation',
        type: 'transition',
        work_request_id: 'wr-10',
        workRequestId: 'wr-99',
      });
      expect(conflictingOpsReq.type).toBe('cancellation');
      expect(conflictingOpsReq.request_type).toBe('cancellation');
      expect(conflictingOpsReq.workRequestId).toBe('wr-10');
      expect(conflictingOpsReq.work_request_id).toBe('wr-10');

      // Case G: Notification user_id vs userId
      const conflictingNotif = normalizeCdcNotification({
        id: 'notif-1',
        user_id: 'user-db',
        userId: 'user-client',
        read_at: '2026-10-10T10:00:00Z',
        readAt: '2026-10-10T12:00:00Z',
      });
      expect(conflictingNotif.userId).toBe('user-db');
      expect(conflictingNotif.user_id).toBe('user-db');
      expect(conflictingNotif.readAt).toBe('2026-10-10T10:00:00Z');
      expect(conflictingNotif.read_at).toBe('2026-10-10T10:00:00Z');
    });

    it('1.3 assigns proper structural defaults when fields are omitted', () => {
      const minimalTask = normalizeCdcTask({ id: 'task-minimal' });
      expect(minimalTask.qaStatus).toBe('none');
      expect(minimalTask.qa_status).toBe('none');
      expect(minimalTask.displayOrder).toBe(0);
      expect(minimalTask.display_order).toBe(0);
      expect(minimalTask.dueDate).toBeNull();
      expect(minimalTask.due_date).toBeNull();
      expect(minimalTask.assigneeId).toBeNull();
      expect(minimalTask.assignee_id).toBeNull();
      expect(minimalTask.assigneeName).toBeNull();
      expect(minimalTask.assignee_name).toBeNull();
      expect(minimalTask.requiredLinkType).toBeNull();
      expect(minimalTask.required_link_type).toBeNull();
      expect(minimalTask.phaseEnteredAt).toBeNull();
      expect(minimalTask.phase_entered_at).toBeNull();
      expect(minimalTask.assignedBy).toBeNull();
      expect(minimalTask.assigned_by).toBeNull();
      expect(minimalTask.assignedAt).toBeNull();
      expect(minimalTask.assigned_at).toBeNull();
      expect(minimalTask.deletedAt).toBeNull();
      expect(minimalTask.deleted_at).toBeNull();

      const minimalWr = normalizeCdcWorkRequest({ id: 'wr-minimal' });
      expect(minimalWr.onHold).toBe(false);
      expect(minimalWr.on_hold).toBe(false);
      expect(minimalWr.coAssignees).toEqual([]);
      expect(minimalWr.co_assignees).toEqual([]);
      expect(minimalWr.phaseEnteredAt).toBeNull();
      expect(minimalWr.phase_entered_at).toBeNull();
      expect(minimalWr.requestedBy).toBeNull();
      expect(minimalWr.requested_by).toBeNull();
      expect(minimalWr.assignedTo).toBeNull();
      expect(minimalWr.assigned_to).toBeNull();
      expect(minimalWr.dueDate).toBeNull();
      expect(minimalWr.due_date).toBeNull();
      expect(minimalWr.deletedAt).toBeNull();
      expect(minimalWr.deleted_at).toBeNull();
    });

    it('1.4 resists prototype pollution keys (__proto__, constructor, prototype)', () => {
      const pollutedInput = JSON.parse(
        '{"id": "task-proto", "__proto__": {"isAdmin": true}, "constructor": {"isSuper": true}, "qa_status": "passed"}'
      );

      const normalized = normalizeCdcTask(pollutedInput);

      // Verify Object prototype was NOT contaminated
      // @ts-expect-error checking polluted property on Object.prototype
      expect(Object.prototype.isAdmin).toBeUndefined();
      // @ts-expect-error checking polluted property on Object.constructor
      expect(Object.constructor.isSuper).toBeUndefined();

      // Normalization still succeeded cleanly
      expect(normalized.id).toBe('task-proto');
      expect(normalized.qaStatus).toBe('passed');
    });

    it('1.5 handles extreme integers without truncation or loss of precision', () => {
      const maxInt = Number.MAX_SAFE_INTEGER; // 9,007,199,254,740,991
      const minInt = Number.MIN_SAFE_INTEGER; // -9,007,199,254,740,991

      const taskWithMaxOrder = normalizeCdcTask({
        id: 'task-max-int',
        display_order: maxInt,
        version: maxInt,
      });

      expect(taskWithMaxOrder.displayOrder).toBe(maxInt);
      expect(taskWithMaxOrder.display_order).toBe(maxInt);

      const taskWithMinOrder = normalizeCdcTask({
        id: 'task-min-int',
        display_order: minInt,
      });

      expect(taskWithMinOrder.displayOrder).toBe(minInt);
      expect(taskWithMinOrder.display_order).toBe(minInt);

      const taskWithNegativeOrder = normalizeCdcTask({
        id: 'task-neg-int',
        display_order: -1,
      });
      expect(taskWithNegativeOrder.displayOrder).toBe(-1);
      expect(taskWithNegativeOrder.display_order).toBe(-1);
    });

    it('1.6 preserves already camelCase inputs when snake_case is omitted', () => {
      const camelOnlyTask = normalizeCdcTask({
        id: 'task-camel',
        workRequestId: 'wr-camel-1',
        qaStatus: 'passed',
        dueDate: '2026-12-31T23:59:59Z',
        displayOrder: 42,
        assigneeId: 'usr-42',
        assigneeName: 'Bob Builder',
        requiredLinkType: 'invoice',
        phaseEnteredAt: '2026-10-01T00:00:00Z',
        assignedBy: 'usr-admin',
        assignedAt: '2026-10-02T00:00:00Z',
      });

      expect(camelOnlyTask.work_request_id).toBe('wr-camel-1');
      expect(camelOnlyTask.qa_status).toBe('passed');
      expect(camelOnlyTask.due_date).toBe('2026-12-31T23:59:59Z');
      expect(camelOnlyTask.display_order).toBe(42);
      expect(camelOnlyTask.assignee_id).toBe('usr-42');
      expect(camelOnlyTask.assignee_name).toBe('Bob Builder');
      expect(camelOnlyTask.required_link_type).toBe('invoice');
      expect(camelOnlyTask.phase_entered_at).toBe('2026-10-01T00:00:00Z');
      expect(camelOnlyTask.assigned_by).toBe('usr-admin');
      expect(camelOnlyTask.assigned_at).toBe('2026-10-02T00:00:00Z');
    });

    it('1.7 preserves unknown auxiliary attributes (payload pass-through)', () => {
      const taskWithExtras = normalizeCdcTask({
        id: 'task-extra',
        custom_metadata: { priority: 'P0', tags: ['audit', 'urgent'] },
        estimated_hours: 12.5,
      });

      expect(taskWithExtras.custom_metadata).toEqual({ priority: 'P0', tags: ['audit', 'urgent'] });
      expect(taskWithExtras.estimated_hours).toBe(12.5);
    });
  });

  // =========================================================================
  // Section 2: Soft Delete Detection Stress
  // =========================================================================
  describe('2. Soft Delete Detection Stress', () => {
    it('2.1 accurately differentiates deleted_at / deletedAt presence vs null/falsy', () => {
      // 1. null on both -> active record (false)
      expect(isSoftDeleteRecord({ deleted_at: null, deletedAt: null })).toBe(false);

      // 2. undefined on both -> active record (false)
      expect(isSoftDeleteRecord({})).toBe(false);
      expect(isSoftDeleteRecord({ deleted_at: undefined, deletedAt: undefined })).toBe(false);

      // 3. empty strings -> active record (false)
      expect(isSoftDeleteRecord({ deleted_at: '', deletedAt: '' })).toBe(false);

      // 4. numeric zero / boolean false -> active record (false)
      expect(isSoftDeleteRecord({ deleted_at: 0, deletedAt: false })).toBe(false);

      // 5. valid timestamp strings -> soft deleted (true)
      expect(isSoftDeleteRecord({ deleted_at: '2026-10-10T12:00:00Z' })).toBe(true);
      expect(isSoftDeleteRecord({ deletedAt: '2026-10-10T12:00:00Z' })).toBe(true);
      expect(isSoftDeleteRecord({ deleted_at: '2026-10-10T12:00:00Z', deletedAt: null })).toBe(true);
      expect(isSoftDeleteRecord({ deleted_at: null, deletedAt: '2026-10-10T12:00:00Z' })).toBe(true);
      expect(isSoftDeleteRecord({ deleted_at: '2026-10-10T12:00:00Z', deletedAt: '2026-10-10T12:00:00Z' })).toBe(true);

      // 6. null / undefined record references
      expect(isSoftDeleteRecord(null)).toBe(false);
      expect(isSoftDeleteRecord(undefined)).toBe(false);
      // @ts-expect-error testing string
      expect(isSoftDeleteRecord('not-an-object')).toBe(false);
    });

    it('2.2 classifies UPDATE events with deleted_at timestamp as isDelete', () => {
      const taskId = 'task-del-classify-1';
      const wrId = 'wr-del-1';

      // Seed detail cache
      queryClient.setQueryData(operationsKeys.taskDetail(wrId, taskId), {
        id: taskId,
        workRequestId: wrId,
        title: 'Task To Delete',
        version: 1,
      });

      // CDC UPDATE event arrives carrying deleted_at
      const processed = handleRealtimePayload(
        queryClient,
        { table: 'tasks' },
        {
          eventType: 'UPDATE',
          new: {
            id: taskId,
            work_request_id: wrId,
            deleted_at: '2026-10-10T15:30:00Z',
            version: 2,
          },
          old: {
            id: taskId,
            work_request_id: wrId,
            version: 1,
          },
        }
      );

      expect(processed).toBe(true);
      // Verify detail cache was purged
      expect(queryClient.getQueryData(operationsKeys.taskDetail(wrId, taskId))).toBeUndefined();
    });

    it('2.3 classifies UPDATE events with deletedAt (camelCase) timestamp as isDelete', () => {
      const taskId = 'task-del-classify-2';
      const wrId = 'wr-del-2';

      queryClient.setQueryData(operationsKeys.taskDetail(wrId, taskId), {
        id: taskId,
        workRequestId: wrId,
        title: 'Task To Delete via CamelCase',
        version: 1,
      });

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'tasks' },
        {
          eventType: 'UPDATE',
          new: {
            id: taskId,
            workRequestId: wrId,
            deletedAt: '2026-10-10T15:30:00Z',
            version: 2,
          },
          old: {
            id: taskId,
            workRequestId: wrId,
            version: 1,
          },
        }
      );

      expect(processed).toBe(true);
      expect(queryClient.getQueryData(operationsKeys.taskDetail(wrId, taskId))).toBeUndefined();
    });

    it('2.4 classifies hard DELETE events as isDelete even if deleted_at is null', () => {
      const taskId = 'task-hard-del';
      const wrId = 'wr-hard-del';

      queryClient.setQueryData(operationsKeys.taskDetail(wrId, taskId), {
        id: taskId,
        workRequestId: wrId,
        title: 'Hard Deleted Task',
        version: 1,
      });

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'tasks' },
        {
          eventType: 'DELETE',
          new: null,
          old: {
            id: taskId,
            work_request_id: wrId,
            deleted_at: null,
            version: 1,
          },
        }
      );

      expect(processed).toBe(true);
      expect(queryClient.getQueryData(operationsKeys.taskDetail(wrId, taskId))).toBeUndefined();
    });

    it('2.5 does NOT treat UPDATE with deleted_at: null as a delete', () => {
      const taskId = 'task-active-update';
      const wrId = 'wr-active';

      queryClient.setQueryData(operationsKeys.taskDetail(wrId, taskId), {
        id: taskId,
        workRequestId: wrId,
        title: 'Active Task Before',
        version: 1,
      });

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'tasks' },
        {
          eventType: 'UPDATE',
          new: {
            id: taskId,
            work_request_id: wrId,
            title: 'Active Task After',
            deleted_at: null,
            version: 2,
          },
          old: {
            id: taskId,
            work_request_id: wrId,
            title: 'Active Task Before',
            version: 1,
          },
        }
      );

      expect(processed).toBe(true);
      const updated = queryClient.getQueryData<Record<string, unknown>>(
        operationsKeys.taskDetail(wrId, taskId)
      );
      expect(updated).toBeDefined();
      expect(updated?.title).toBe('Active Task After');
    });
  });

  // =========================================================================
  // Section 3: Detail Cache Eviction Across Domain Entities
  // =========================================================================
  describe('3. Detail Cache Eviction Across Domain Entities', () => {
    it('3.1 evicts work_requests detail cache on soft delete', () => {
      const wrId = 'wr-evict-1';
      queryClient.setQueryData(operationsKeys.workRequestDetail(wrId), {
        id: wrId,
        workRequestNo: 'WR-001',
        entity: 'ATA',
        version: 1,
      });

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'work_requests' },
        {
          eventType: 'UPDATE',
          new: {
            id: wrId,
            work_request_no: 'WR-001',
            entity: 'ATA',
            deleted_at: '2026-10-10T12:00:00Z',
            version: 2,
          },
          old: { id: wrId, version: 1 },
        }
      );

      expect(processed).toBe(true);
      expect(queryClient.getQueryData(operationsKeys.workRequestDetail(wrId))).toBeUndefined();
    });

    it('3.2 evicts invoices detail cache on soft delete', () => {
      const invId = 'inv-evict-1';
      queryClient.setQueryData(billingKeys.invoiceDetail(invId), {
        id: invId,
        invoiceNumber: 'INV-100',
        entity: 'ATA',
        version: 1,
      });

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'invoices' },
        {
          eventType: 'UPDATE',
          new: {
            id: invId,
            entity: 'ATA',
            deleted_at: '2026-10-10T12:00:00Z',
            version: 2,
          },
          old: { id: invId, version: 1 },
        }
      );

      expect(processed).toBe(true);
      expect(queryClient.getQueryData(billingKeys.invoiceDetail(invId))).toBeUndefined();
    });

    it('3.3 evicts disbursements detail cache on soft delete', () => {
      const disbId = 'disb-evict-1';
      queryClient.setQueryData(disbursementKeys.detail(disbId), {
        id: disbId,
        disbursementNumber: 'DSB-200',
        entity: 'ATA',
        version: 1,
      });

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'disbursements' },
        {
          eventType: 'UPDATE',
          new: {
            id: disbId,
            entity: 'ATA',
            deleted_at: '2026-10-10T12:00:00Z',
            version: 2,
          },
          old: { id: disbId, version: 1 },
        }
      );

      expect(processed).toBe(true);
      expect(queryClient.getQueryData(disbursementKeys.detail(disbId))).toBeUndefined();
    });

    it('3.4 evicts operations_requests detail cache on soft delete', () => {
      const reqId = 'op-req-evict-1';
      queryClient.setQueryData(operationsKeys.requestDetail(reqId), {
        id: reqId,
        type: 'transition',
        version: 1,
      });

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'operations_requests' },
        {
          eventType: 'UPDATE',
          new: {
            id: reqId,
            type: 'transition',
            deleted_at: '2026-10-10T12:00:00Z',
            version: 2,
          },
          old: { id: reqId, version: 1 },
        }
      );

      expect(processed).toBe(true);
      expect(queryClient.getQueryData(operationsKeys.requestDetail(reqId))).toBeUndefined();
    });

    it('3.5 evicts task detail cache when work_request_id is provided in payload.new', () => {
      const taskId = 'task-evict-detail-new';
      const wrId = 'wr-detail-new';

      queryClient.setQueryData(operationsKeys.taskDetail(wrId, taskId), {
        id: taskId,
        workRequestId: wrId,
        title: 'Task To Evict',
        version: 1,
      });

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'tasks' },
        {
          eventType: 'UPDATE',
          new: {
            id: taskId,
            work_request_id: wrId,
            deleted_at: '2026-10-10T12:00:00Z',
            version: 2,
          },
          old: { id: taskId, version: 1 },
        }
      );

      expect(processed).toBe(true);
      expect(queryClient.getQueryData(operationsKeys.taskDetail(wrId, taskId))).toBeUndefined();
    });

    it('3.6 stress-tests task detail cache behavior when work_request_id is ONLY in payload.old', () => {
      const taskId = 'task-evict-detail-old-only';
      const wrId = 'wr-detail-old-only';

      // Seed parent work request with phases containing this task
      queryClient.setQueryData(operationsKeys.workRequestDetail(wrId), {
        id: wrId,
        phases: {
          processing: {
            tasks: [{ id: taskId, title: 'Task in Phase' }],
          },
        },
      });

      // Partial CDC payload: work_request_id is omitted from new, present only in old
      handleRealtimePayload(
        queryClient,
        { table: 'tasks' },
        {
          eventType: 'UPDATE',
          new: {
            id: taskId,
            deleted_at: '2026-10-10T12:00:00Z',
            version: 2,
          },
          old: {
            id: taskId,
            work_request_id: wrId,
            version: 1,
          },
        }
      );

      // Verify that parent work request phase containers WERE successfully purged
      // because lines 730-737 check payloadObj.old?.work_request_id
      const wrCache = queryClient.getQueryData<{
        phases: { processing: { tasks: Array<{ id: string }> } };
      }>(operationsKeys.workRequestDetail(wrId));
      expect(wrCache?.phases.processing.tasks).toHaveLength(0);
    });
  });

  // =========================================================================
  // Section 4: List Queries Eviction & Metadata Math
  // =========================================================================
  describe('4. List Queries Eviction & Metadata Math', () => {
    it('4.1 purges soft-deleted item from plain array list caches', () => {
      const listKey = operationsKeys.workRequests();
      queryClient.setQueryData(listKey, [
        { id: 'wr-1', title: 'Work Request 1', entity: 'ATA' },
        { id: 'wr-2', title: 'Work Request 2', entity: 'ATA' },
        { id: 'wr-3', title: 'Work Request 3', entity: 'ATA' },
      ]);

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'work_requests' },
        {
          eventType: 'UPDATE',
          new: {
            id: 'wr-2',
            entity: 'ATA',
            deleted_at: '2026-10-10T12:00:00Z',
            version: 2,
          },
          old: { id: 'wr-2', version: 1 },
        }
      );

      expect(processed).toBe(true);
      const remaining = queryClient.getQueryData<Array<{ id: string }>>(listKey);
      expect(remaining).toHaveLength(2);
      expect(remaining?.map((r) => r.id)).toEqual(['wr-1', 'wr-3']);
    });

    it('4.2 purges soft-deleted item from { data, meta } structures and decrements meta.total', () => {
      const listKey = billingKeys.invoices();
      queryClient.setQueryData(listKey, {
        data: [
          { id: 'inv-1', invoiceNumber: 'INV-01', entity: 'ATA' },
          { id: 'inv-2', invoiceNumber: 'INV-02', entity: 'ATA' },
        ],
        meta: {
          total: 2,
          page: 1,
          limit: 10,
        },
      });

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'invoices' },
        {
          eventType: 'UPDATE',
          new: {
            id: 'inv-1',
            entity: 'ATA',
            deleted_at: '2026-10-10T12:00:00Z',
            version: 2,
          },
          old: { id: 'inv-1', version: 1 },
        }
      );

      expect(processed).toBe(true);
      const updated = queryClient.getQueryData<{
        data: Array<{ id: string }>;
        meta: { total: number };
      }>(listKey);
      expect(updated?.data).toHaveLength(1);
      expect(updated?.data[0]?.id).toBe('inv-2');
      expect(updated?.meta.total).toBe(1);
    });

    it('4.3 guards meta.total boundary at zero (never produces negative counts)', () => {
      const listKey = disbursementKeys.lists();
      queryClient.setQueryData(listKey, {
        data: [{ id: 'dsb-1', entity: 'ATA' }],
        meta: {
          total: 0, // Inconsistent / empty total boundary
        },
      });

      handleRealtimePayload(
        queryClient,
        { table: 'disbursements' },
        {
          eventType: 'UPDATE',
          new: {
            id: 'dsb-1',
            entity: 'ATA',
            deleted_at: '2026-10-10T12:00:00Z',
            version: 2,
          },
          old: { id: 'dsb-1', version: 1 },
        }
      );

      const updated = queryClient.getQueryData<{
        data: Array<{ id: string }>;
        meta: { total: number };
      }>(listKey);
      expect(updated?.data).toHaveLength(0);
      expect(updated?.meta.total).toBe(0); // Math.max(0, -1) => 0
    });
  });

  // =========================================================================
  // Section 5: Parent Work Request Phase Container Eviction
  // =========================================================================
  describe('5. Parent Work Request Phase Container Eviction', () => {
    it('5.1 purges task from embedded phases inside workRequestDetail cache', () => {
      const targetWrId = 'wr-phases-test';
      const taskIdToDelete = 'task-in-qa';
      const taskToKeep = 'task-in-processing';

      // Seed workRequestDetail with phase containers
      queryClient.setQueryData(operationsKeys.workRequestDetail(targetWrId), {
        id: targetWrId,
        title: 'Work Request with Phases',
        entity: 'ATA',
        phases: {
          intake: { tasks: [] },
          processing: {
            tasks: [{ id: taskToKeep, title: 'Keep Processing' }],
          },
          quality_assurance: {
            tasks: [{ id: taskIdToDelete, title: 'Delete from QA' }],
          },
        },
      });

      // Soft delete task-in-qa
      const processed = handleRealtimePayload(
        queryClient,
        { table: 'tasks' },
        {
          eventType: 'UPDATE',
          new: {
            id: taskIdToDelete,
            work_request_id: targetWrId,
            deleted_at: '2026-10-10T12:00:00Z',
            version: 2,
          },
          old: {
            id: taskIdToDelete,
            work_request_id: targetWrId,
            version: 1,
          },
        }
      );

      expect(processed).toBe(true);

      const wrCache = queryClient.getQueryData<{
        phases: Record<string, { tasks: Array<{ id: string }> }>;
      }>(operationsKeys.workRequestDetail(targetWrId));

      expect(wrCache).toBeDefined();
      expect(wrCache?.phases?.processing?.tasks).toHaveLength(1);
      expect(wrCache?.phases?.processing?.tasks?.[0]?.id).toBe(taskToKeep);
      expect(wrCache?.phases?.quality_assurance?.tasks).toHaveLength(0);
    });

    it('5.2 purges task from embedded phases inside workRequests list cache', () => {
      const targetWrId = 'wr-in-list';
      const taskId = 'task-embedded-del';

      queryClient.setQueryData(operationsKeys.workRequests(), {
        data: [
          {
            id: targetWrId,
            title: 'WR 1',
            entity: 'ATA',
            phases: {
              phase_a: {
                tasks: [{ id: taskId, title: 'Task to be purged' }],
              },
            },
          },
        ],
      });

      handleRealtimePayload(
        queryClient,
        { table: 'tasks' },
        {
          eventType: 'UPDATE',
          new: {
            id: taskId,
            work_request_id: targetWrId,
            deleted_at: '2026-10-10T12:00:00Z',
            version: 2,
          },
          old: { id: taskId, version: 1 },
        }
      );

      const listCache = queryClient.getQueryData<{
        data: Array<{ phases: Record<string, { tasks: Array<{ id: string }> }> }>;
      }>(operationsKeys.workRequests());

      expect(listCache?.data[0]?.phases?.phase_a?.tasks).toHaveLength(0);
    });

    it('5.3 resolves targetWrId from payload.old when payload.new omits it', () => {
      const targetWrId = 'wr-from-old-payload';
      const taskId = 'task-partial-update';

      queryClient.setQueryData(operationsKeys.workRequestDetail(targetWrId), {
        id: targetWrId,
        phases: {
          intake: {
            tasks: [{ id: taskId, title: 'Task Partial' }],
          },
        },
      });

      // Partial CDC payload where new only has id and deleted_at
      handleRealtimePayload(
        queryClient,
        { table: 'tasks' },
        {
          eventType: 'UPDATE',
          new: {
            id: taskId,
            deleted_at: '2026-10-10T12:00:00Z',
            version: 2,
          },
          old: {
            id: taskId,
            work_request_id: targetWrId,
            version: 1,
          },
        }
      );

      const wrCache = queryClient.getQueryData<{
        phases: Record<string, { tasks: Array<{ id: string }> }>;
      }>(operationsKeys.workRequestDetail(targetWrId));

      expect(wrCache?.phases?.intake?.tasks).toHaveLength(0);
    });

    it('5.4 gracefully survives malformed, null, and sparse phase structures', () => {
      const targetWrId = 'wr-malformed-phases';
      const taskId = 'task-sparse';

      // Seed with malformed phase containers
      queryClient.setQueryData(operationsKeys.workRequestDetail(targetWrId), {
        id: targetWrId,
        phases: {
          phase_null: null,
          phase_empty: {},
          phase_no_tasks: { status: 'open' },
          phase_sparse: {
            tasks: [{ id: taskId }, null, undefined, { id: 'other' }],
          },
        },
      });

      // Must not throw or crash
      expect(() => {
        handleRealtimePayload(
          queryClient,
          { table: 'tasks' },
          {
            eventType: 'UPDATE',
            new: {
              id: taskId,
              work_request_id: targetWrId,
              deleted_at: '2026-10-10T12:00:00Z',
              version: 2,
            },
            old: { id: taskId, version: 1 },
          }
        );
      }).not.toThrow();

      const wrCache = queryClient.getQueryData<{
        phases: Record<string, unknown>;
      }>(operationsKeys.workRequestDetail(targetWrId));

      expect(wrCache).toBeDefined();
    });
  });

  // =========================================================================
  // Section 6: Soft-Delete Co-Invalidation Triggers
  // =========================================================================
  describe('6. Soft-Delete Co-Invalidation Triggers', () => {
    it('6.1 invalidates workRequestDetail, workRequestCounts, and taskRelated on task soft delete', () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const targetWrId = 'wr-coinv';
      const taskId = 'task-coinv';

      handleRealtimePayload(
        queryClient,
        { table: 'tasks', activeEntity: 'ATA' },
        {
          eventType: 'UPDATE',
          new: {
            id: taskId,
            work_request_id: targetWrId,
            deleted_at: '2026-10-10T12:00:00Z',
            version: 2,
          },
          old: { id: taskId, version: 1 },
        }
      );

      // Verify workRequestDetail(targetWrId) was invalidated
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: operationsKeys.workRequestDetail(targetWrId),
        })
      );

      // Verify workRequestCounts('ATA') was invalidated
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: operationsKeys.workRequestCounts('ATA'),
        })
      );

      // Verify taskRelated(taskId) was invalidated
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: operationsKeys.taskRelated(taskId),
        })
      );
    });
  });
});
