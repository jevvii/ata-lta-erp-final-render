/**
 * Unit tests for notification dispatcher service (backend/src/services/notify.js).
 * Validates AC-2 (frozen types and payload schemas) and AC-3 (fault tolerance).
 */

jest.mock('../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('./fixtures/supabaseMock');
  return { supabaseAdmin };
});

const { notify, FROZEN_NOTIFICATION_TYPES } = require('../src/services/notify');
const { supabaseAdmin } = require('../src/services/supabaseClient');
const { mockTables, resetMock } = require('./fixtures/supabaseMock');
const logger = require('../src/lib/logger');
const AppError = require('../src/lib/AppError');

describe('notify service (notify.js)', () => {
  const USER_1 = '11111111-1111-1111-1111-111111111111';
  const USER_2 = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    resetMock();
    if (!mockTables.notifications) {
      mockTables.notifications = new Map();
    }
    mockTables.notifications.clear();
    jest.restoreAllMocks();
  });

  describe('AC-2: Frozen Types and Payload Schemas', () => {
    it('successfully emits pending_request.resolved notification', async () => {
      const payload = {
        request_id: 'req-001',
        table_name: 'disbursements',
        outcome: 'approved',
        reason: 'Authorized by Management',
        title: 'Disbursement Request Approved',
      };

      await notify([USER_1], 'pending_request.resolved', payload);

      const rows = Array.from(mockTables.notifications.values());
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(USER_1);
      expect(rows[0].type).toBe('pending_request.resolved');
      expect(rows[0].payload).toEqual(payload);
      expect(rows[0].read_at).toBeNull();
      expect(rows[0].created_at).toBeTruthy();
    });

    it('successfully emits wr.transition_request.received notification', async () => {
      const payload = {
        request_id: 'req-002',
        work_request_id: 'wr-100',
        wr_title: 'Annual SEC Compliance',
        from_phase: 'intake',
        to_phase: 'pre_processing',
        requested_by_name: 'Maria Clara',
      };

      await notify([USER_1], 'wr.transition_request.received', payload);

      const rows = Array.from(mockTables.notifications.values());
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(USER_1);
      expect(rows[0].type).toBe('wr.transition_request.received');
      expect(rows[0].payload).toEqual(payload);
    });

    it('successfully emits wr.transition_request.resolved notification', async () => {
      const payload = {
        request_id: 'req-003',
        work_request_id: 'wr-100',
        outcome: 'approved',
        reason: 'Documents verified',
        to_phase: 'processing',
      };

      await notify([USER_1], 'wr.transition_request.resolved', payload);

      const rows = Array.from(mockTables.notifications.values());
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(USER_1);
      expect(rows[0].type).toBe('wr.transition_request.resolved');
      expect(rows[0].payload).toEqual(payload);
    });

    it('successfully emits wr.qa_reroute notification', async () => {
      const payload = {
        work_request_id: 'wr-100',
        wr_title: 'Annual SEC Compliance',
        to_phase: 'processing',
        reason: 'Missing tax clearance certificate',
        failed_task_ids: ['task-01', 'task-02'],
      };

      await notify([USER_1], 'wr.qa_reroute', payload);

      const rows = Array.from(mockTables.notifications.values());
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(USER_1);
      expect(rows[0].type).toBe('wr.qa_reroute');
      expect(rows[0].payload).toEqual(payload);
    });

    it('rejects unknown notification type with HTTP 400 AppError', async () => {
      await expect(
        notify([USER_1], 'unknown.event_type', { foo: 'bar' })
      ).rejects.toThrow(AppError);

      try {
        await notify([USER_1], 'unknown.event_type', { foo: 'bar' });
      } catch (err) {
        expect(err.statusCode).toBe(400);
        expect(err.code).toBe('INVALID_NOTIFICATION_TYPE');
        expect(err.title).toBe('Invalid Notification Type');
        expect(err.detail).toContain('unknown.event_type');
      }

      // Assert no row was written
      expect(mockTables.notifications.size).toBe(0);
    });

    it('rejects non-object payload with HTTP 400 AppError', async () => {
      await expect(notify([USER_1], 'pending_request.resolved', 'not-an-object')).rejects.toThrow(
        AppError
      );
      await expect(notify([USER_1], 'pending_request.resolved', null)).rejects.toThrow(AppError);
      await expect(notify([USER_1], 'pending_request.resolved', [1, 2, 3])).rejects.toThrow(
        AppError
      );
    });

    it('exports the complete list of frozen notification types including disbursement.lifecycle', () => {
      expect(FROZEN_NOTIFICATION_TYPES).toEqual([
        'pending_request.resolved',
        'wr.transition_request.received',
        'wr.transition_request.resolved',
        'wr.qa_reroute',
        'disbursement.lifecycle',
      ]);
    });

    it('successfully emits disbursement.lifecycle notification', async () => {
      const payload = {
        action: 'approved',
        table_name: 'disbursements',
        request_id: 'disb-001',
        entity: 'ATA',
        disbursement_number: 'DISB-ATA-2026-0001',
        title: 'Disbursement Approved',
      };

      await notify([USER_1], 'disbursement.lifecycle', payload);

      const rows = Array.from(mockTables.notifications.values());
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(USER_1);
      expect(rows[0].type).toBe('disbursement.lifecycle');
      expect(rows[0].payload).toEqual(payload);
    });

    it('handles multiple recipients and deduplicates user IDs', async () => {
      const payload = {
        request_id: 'req-004',
        table_name: 'disbursements',
        outcome: 'approved',
        title: 'Batch Disbursement',
      };

      // Pass duplicate user IDs: USER_1 twice, USER_2 once
      await notify([USER_1, USER_1, USER_2], 'pending_request.resolved', payload);

      const rows = Array.from(mockTables.notifications.values());
      expect(rows).toHaveLength(2);
      const recipientIds = rows.map((r) => r.user_id);
      expect(recipientIds).toContain(USER_1);
      expect(recipientIds).toContain(USER_2);
    });

    it('resolves cleanly without writing when userIds is empty or null', async () => {
      await expect(notify([], 'pending_request.resolved', { title: 'No-op' })).resolves.toBeUndefined();
      await expect(notify(null, 'pending_request.resolved', { title: 'No-op' })).resolves.toBeUndefined();
      expect(mockTables.notifications.size).toBe(0);
    });
  });

  describe('AC-3: Database Fault Tolerance (Caller Business Operation Protection)', () => {
    it('leaves caller business operation succeeding when DB insert returns an error', async () => {
      const loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

      // Simulate a database failure returned from Supabase
      jest.spyOn(supabaseAdmin, 'from').mockReturnValue({
        insert: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'connection to server at "db.supabase.co" failed: timeout', code: '08006' },
        }),
      });

      // Simulated caller business operation (e.g., transition approval or payment disbursement)
      const executeBusinessOperation = async () => {
        const operationState = { completed: true, status: 'Approved' };
        await notify([USER_1], 'pending_request.resolved', {
          request_id: 'req-777',
          table_name: 'disbursements',
          outcome: 'approved',
          title: 'Operation Approved',
        });
        return operationState;
      };

      const result = await executeBusinessOperation();
      expect(result).toEqual({ completed: true, status: 'Approved' });
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        '[NOTIFY] Failed to write notifications',
        expect.objectContaining({
          type: 'pending_request.resolved',
          userIds: [USER_1],
        })
      );
    });

    it('leaves caller business operation succeeding when DB insert throws/rejects', async () => {
      const loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

      // Simulate unhandled rejection from network driver
      jest.spyOn(supabaseAdmin, 'from').mockReturnValue({
        insert: jest.fn().mockRejectedValue(new Error('PostgreSQL process killed')),
      });

      const executeBusinessOperation = async () => {
        await notify([USER_1], 'wr.qa_reroute', {
          work_request_id: 'wr-999',
          wr_title: 'Audit WR',
          to_phase: 'intake',
          reason: 'QA reroute reason',
          failed_task_ids: [],
        });
        return { success: true };
      };

      const result = await executeBusinessOperation();
      expect(result.success).toBe(true);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        '[NOTIFY] Failed to write notifications',
        expect.objectContaining({
          error: 'PostgreSQL process killed',
          type: 'wr.qa_reroute',
          userIds: [USER_1],
        })
      );
    });
  });
});
