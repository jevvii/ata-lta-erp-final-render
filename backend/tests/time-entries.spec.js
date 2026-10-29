/**
 * Test Suite: Time Entries Module (/v1/time-entries)
 *
 * Asserts all Acceptance Criteria AC-1 through AC-4 for Parcel P0-F:
 * - AC-1 (R1-R2): Staff creates entry on assigned task -> 201; unassigned task -> 403; forged user_id ignored.
 * - AC-2 (R3): Future entry_date -> 400; duration 0 or >1440 -> 400; multiple entries same day same task -> 201.
 * - AC-3 (R4): Coworker edit/delete -> 403; creator and Admin edit/delete -> 200/204.
 * - AC-4 (R5): Summary endpoint returns correct daily total minutes and grouped task breakdown with WR linkage.
 */

jest.mock('../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('./fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('./helpers/testServer');
const {
  registerUser,
  seedDefaults,
  resetMock,
  mockTables,
} = require('./fixtures/supabaseMock');

describe('Time Entries Module (/v1/time-entries)', () => {
  const userAId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const userBId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const adminId = '11111111-1111-1111-1111-111111111111';
  const unprivId = '99999999-9999-9999-9999-999999999999';

  const wr1Id = '11111111-0001-4000-8000-000000000001';
  const wr2Id = '11111111-0002-4000-8000-000000000002';

  const task1Id = '22222222-0001-4000-8000-000000000001';
  const task2Id = '22222222-0002-4000-8000-000000000002';
  const task3Id = '22222222-0003-4000-8000-000000000003';
  const task4Id = '22222222-0004-4000-8000-000000000004';

  let tokenA;
  let tokenB;
  let tokenAdmin;
  let tokenUnpriv;

  const getTodayStr = () => new Date().toISOString().slice(0, 10);
  const getYesterdayStr = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  };
  const getTomorrowStr = () => {
    const d = new Date(Date.now() + 2 * 86400000);
    return d.toISOString().slice(0, 10);
  };

  beforeEach(() => {
    resetMock();
    seedDefaults();

    // Ensure mockTables has time_entries
    if (!mockTables.time_entries) {
      mockTables.time_entries = new Map();
    }
    mockTables.time_entries.clear();

    // Register test users
    tokenA = registerUser({
      id: userAId,
      email: 'staff.a@ata-lta.ph',
      name: 'Staff A (Accounting)',
      role: 'Accounting',
      departments: ['Accounting'],
      entities: ['ATA'],
    });

    tokenB = registerUser({
      id: userBId,
      email: 'staff.b@ata-lta.ph',
      name: 'Staff B (Operations)',
      role: 'Operations',
      departments: ['Operations'],
      entities: ['ATA'],
    });

    tokenAdmin = registerUser({
      id: adminId,
      email: 'admin@ata-lta.ph',
      name: 'Admin User',
      role: 'Admin',
      departments: ['Management'],
      entities: ['ATA'],
    });

    tokenUnpriv = registerUser({
      id: unprivId,
      email: 'client@external.ph',
      name: 'Unprivileged User',
      role: 'Client',
      departments: [],
      entities: ['ATA'],
    });

    // Seed Work Requests
    mockTables.work_requests.set(wr1Id, {
      id: wr1Id,
      title: 'Tax Compliance Project',
      entity_id: 'ent-ata',
    });

    mockTables.work_requests.set(wr2Id, {
      id: wr2Id,
      title: 'Audit Advisory Project',
      entity_id: 'ent-ata',
    });

    // Seed Tasks:
    // Task 1: assigned to User A via task_assignees
    mockTables.tasks.set(task1Id, {
      id: task1Id,
      work_request_id: wr1Id,
      title: 'Bank Reconciliation',
      required_link_type: 'billing', // Accounting staff may log legacy time only on assigned billing tasks.
      status: 'In Progress',
    });
    mockTables.task_assignees.set(`ta-${task1Id}-${userAId}`, {
      id: `ta-${task1Id}-${userAId}`,
      task_id: task1Id,
      user_id: userAId,
    });

    // Task 2: assigned to User A via legacy assignee_id
    mockTables.tasks.set(task2Id, {
      id: task2Id,
      work_request_id: wr2Id,
      title: 'Client Tax Preparation',
      assignee_id: userAId,
      status: 'In Progress',
    });

    // Task 3: assigned to User B via task_assignees
    mockTables.tasks.set(task3Id, {
      id: task3Id,
      work_request_id: wr1Id,
      title: 'Financial Statement Review',
      status: 'In Progress',
    });
    mockTables.task_assignees.set(`ta-${task3Id}-${userBId}`, {
      id: `ta-${task3Id}-${userBId}`,
      task_id: task3Id,
      user_id: userBId,
    });

    // Task 4: unassigned task
    mockTables.tasks.set(task4Id, {
      id: task4Id,
      work_request_id: wr2Id,
      title: 'General Filing',
      status: 'Draft',
    });
  });

  describe('AC-1 (R1-R2): Assignee Scope & Ownership Attribution', () => {
    it('allows staff to create time entry on assigned task via task_assignees (201 Created)', async () => {
      const res = await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task1Id,
          entry_date: getTodayStr(),
          duration_minutes: 60,
          note: 'Reconciled September statements',
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.task_id).toBe(task1Id);
      expect(res.body.data.user_id).toBe(userAId);
      expect(res.body.data.duration_minutes).toBe(60);
      expect(res.body.data.note).toBe('Reconciled September statements');
      expect(res.body.data.entry_date).toBe(getTodayStr());
    });

    it('allows staff to create time entry on assigned task via legacy tasks.assignee_id fallback (201 Created)', async () => {
      const res = await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task2Id,
          entry_date: getYesterdayStr(),
          duration_minutes: 45,
          note: 'Prepared preliminary tax sheets',
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.task_id).toBe(task2Id);
      expect(res.body.data.user_id).toBe(userAId);
      expect(res.body.data.duration_minutes).toBe(45);
    });

    it('rejects staff creating time entry on unassigned task (403 Forbidden)', async () => {
      // User A attempts to log time on Task 3 (assigned exclusively to User B)
      const res = await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task3Id,
          entry_date: getTodayStr(),
          duration_minutes: 30,
          note: 'Attempting to log on coworker task',
        });

      expect(res.status).toBe(403);
      expect(res.body.detail).toBe('You are not assigned to this task');
    });

    it('rejects staff creating time entry on completely unassigned task (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task4Id,
          entry_date: getTodayStr(),
          duration_minutes: 30,
        });

      expect(res.status).toBe(403);
      expect(res.body.detail).toBe('You are not assigned to this task');
    });

    it('ignores client-supplied user_id and forces caller identity (Rule R1)', async () => {
      const res = await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task1Id,
          user_id: userBId, // Attempt to forge entry for User B
          entry_date: getTodayStr(),
          duration_minutes: 90,
          note: 'Forged attribution test',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.user_id).toBe(userAId); // Confirms forged user_id was ignored
      expect(res.body.data.user_id).not.toBe(userBId);
    });

    it('returns 404 when attempting to log time against non-existent task', async () => {
      const nonExistentTaskId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: nonExistentTaskId,
          entry_date: getTodayStr(),
          duration_minutes: 60,
        });

      expect(res.status).toBe(404);
      expect(res.body.detail).toBe('Task not found');
    });
  });

  describe('AC-2 (R3): Date & Duration Bounds, Multiple Entries', () => {
    it('rejects future entry_date (400 Bad Request)', async () => {
      const res = await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task1Id,
          entry_date: getTomorrowStr(),
          duration_minutes: 60,
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/cannot be in the future/i);
    });

    it('rejects duration_minutes = 0 (400 Bad Request)', async () => {
      const res = await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task1Id,
          entry_date: getTodayStr(),
          duration_minutes: 0,
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/at least 1/i);
    });

    it('rejects duration_minutes < 0 (400 Bad Request)', async () => {
      const res = await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task1Id,
          entry_date: getTodayStr(),
          duration_minutes: -30,
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/at least 1/i);
    });

    it('rejects duration_minutes > 1440 (400 Bad Request)', async () => {
      const res = await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task1Id,
          entry_date: getTodayStr(),
          duration_minutes: 1500,
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/cannot exceed 1440/i);
    });

    it('rejects non-integer duration_minutes (400 Bad Request)', async () => {
      const res = await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task1Id,
          entry_date: getTodayStr(),
          duration_minutes: 45.5,
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/integer/i);
    });

    it('allows multiple entries on the same day for the same task (all 201 Created)', async () => {
      const today = getTodayStr();

      const res1 = await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task1Id,
          entry_date: today,
          duration_minutes: 60,
          note: 'Morning session',
        })
        .expect(201);

      const res2 = await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task1Id,
          entry_date: today,
          duration_minutes: 45,
          note: 'Afternoon session',
        })
        .expect(201);

      const res3 = await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task1Id,
          entry_date: today,
          duration_minutes: 30,
          note: 'End-of-day follow up',
        })
        .expect(201);

      expect(res1.body.data.id).toBeDefined();
      expect(res2.body.data.id).toBeDefined();
      expect(res3.body.data.id).toBeDefined();

      expect(res1.body.data.id).not.toBe(res2.body.data.id);
      expect(res2.body.data.id).not.toBe(res3.body.data.id);
    });
  });

  describe('AC-3 (R4): Edit & Delete Permissions (Coworker vs Creator vs Admin)', () => {
    let entryAId;

    beforeEach(async () => {
      // Create an entry owned by User A
      const res = await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task1Id,
          entry_date: getYesterdayStr(),
          duration_minutes: 120,
          note: 'Initial analysis',
        })
        .expect(201);

      entryAId = res.body.data.id;
    });

    it('rejects coworker attempting to PATCH another user time entry (403 Forbidden)', async () => {
      const res = await request(app)
        .patch(`/v1/time-entries/${entryAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          duration_minutes: 180,
          note: 'Coworker tampering attempt',
        });

      expect(res.status).toBe(403);
      expect(res.body.detail).toBe('You do not have permission to modify this time entry');
    });

    it('rejects coworker attempting to DELETE another user time entry (403 Forbidden)', async () => {
      const res = await request(app)
        .delete(`/v1/time-entries/${entryAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(403);
      expect(res.body.detail).toBe('You do not have permission to delete this time entry');
    });

    it('allows creator to PATCH own time entry (200 OK)', async () => {
      const res = await request(app)
        .patch(`/v1/time-entries/${entryAId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          duration_minutes: 150,
          note: 'Updated analysis note',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(entryAId);
      expect(res.body.data.duration_minutes).toBe(150);
      expect(res.body.data.note).toBe('Updated analysis note');
      expect(res.body.data.updated_at).toBeDefined();
    });

    it('allows Admin to PATCH coworker time entry via timelog:edit_all (200 OK)', async () => {
      const res = await request(app)
        .patch(`/v1/time-entries/${entryAId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          duration_minutes: 90,
          note: 'Admin adjusted duration',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(entryAId);
      expect(res.body.data.duration_minutes).toBe(90);
      expect(res.body.data.note).toBe('Admin adjusted duration');
    });

    it('allows creator to DELETE own time entry (204 No Content)', async () => {
      await request(app)
        .delete(`/v1/time-entries/${entryAId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .expect(204);

      // Verify row is deleted
      expect(mockTables.time_entries.has(entryAId)).toBe(false);
    });

    it('allows Admin to DELETE coworker time entry via timelog:edit_all (204 No Content)', async () => {
      await request(app)
        .delete(`/v1/time-entries/${entryAId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .set('X-Active-Entity', 'ATA')
        .expect(204);

      // Verify row is deleted
      expect(mockTables.time_entries.has(entryAId)).toBe(false);
    });

    it('rejects PATCH with future entry_date (400 Bad Request)', async () => {
      const res = await request(app)
        .patch(`/v1/time-entries/${entryAId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          entry_date: getTomorrowStr(),
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/cannot be in the future/i);
    });

    it('rejects PATCH with invalid duration (400 Bad Request)', async () => {
      const res = await request(app)
        .patch(`/v1/time-entries/${entryAId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          duration_minutes: 0,
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/at least 1/i);
    });

    it('returns 404 on PATCH for non-existent entry ID', async () => {
      const nonExistentId = '99999999-9999-9999-9999-999999999999';
      const res = await request(app)
        .patch(`/v1/time-entries/${nonExistentId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({ duration_minutes: 60 });

      expect(res.status).toBe(404);
      expect(res.body.detail).toBe('Time entry not found');
    });

    it('returns 404 on DELETE for non-existent entry ID', async () => {
      const nonExistentId = '99999999-9999-9999-9999-999999999999';
      const res = await request(app)
        .delete(`/v1/time-entries/${nonExistentId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(404);
      expect(res.body.detail).toBe('Time entry not found');
    });
  });

  describe('AC-4 (R5): Dashboard Summary Endpoint', () => {
    const targetDate = '2026-10-01';

    beforeEach(async () => {
      // User A logs 2 entries on Task 1 (60 min + 30 min)
      await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task1Id,
          entry_date: targetDate,
          duration_minutes: 60,
          note: 'Morning session on Task 1',
        })
        .expect(201);

      await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task1Id,
          entry_date: targetDate,
          duration_minutes: 30,
          note: 'Afternoon session on Task 1',
        })
        .expect(201);

      // User A logs 1 entry on Task 2 (45 min)
      await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task2Id,
          entry_date: targetDate,
          duration_minutes: 45,
          note: 'Tax work',
        })
        .expect(201);

      // User B logs 1 entry on Task 3 on the same date (100 min)
      await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task3Id,
          entry_date: targetDate,
          duration_minutes: 100,
          note: 'Reviewing audit docs',
        })
        .expect(201);
    });

    it('aggregates daily total minutes and grouped task breakdown with WR linkage for caller', async () => {
      const res = await request(app)
        .get(`/v1/time-entries/summary?date=${targetDate}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      // Check structure
      expect(res.body.date).toBe(targetDate);
      expect(res.body.total_minutes).toBe(135); // 60 + 30 + 45 = 135

      const byTask = res.body.by_task;
      expect(byTask).toHaveLength(2);

      const task1Item = byTask.find((t) => t.task_id === task1Id);
      expect(task1Item).toBeDefined();
      expect(task1Item.title).toBe('Bank Reconciliation');
      expect(task1Item.work_request_id).toBe(wr1Id);
      expect(task1Item.minutes).toBe(90); // 60 + 30 = 90 grouped

      const task2Item = byTask.find((t) => t.task_id === task2Id);
      expect(task2Item).toBeDefined();
      expect(task2Item.title).toBe('Client Tax Preparation');
      expect(task2Item.work_request_id).toBe(wr2Id);
      expect(task2Item.minutes).toBe(45);
    });

    it('does not include other users entries in callers summary', async () => {
      // User B summary on the same date should have total_minutes = 100
      const resB = await request(app)
        .get(`/v1/time-entries/summary?date=${targetDate}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(resB.body.total_minutes).toBe(100);
      expect(resB.body.by_task).toHaveLength(1);
      expect(resB.body.by_task[0].task_id).toBe(task3Id);
      expect(resB.body.by_task[0].minutes).toBe(100);
    });

    it('returns 0 total minutes and empty by_task array when no entries exist for date', async () => {
      const emptyDate = '2026-09-15';
      const res = await request(app)
        .get(`/v1/time-entries/summary?date=${emptyDate}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.date).toBe(emptyDate);
      expect(res.body.total_minutes).toBe(0);
      expect(res.body.by_task).toEqual([]);
    });

    it('allows Admin to view summary for a specific user via user_id query param', async () => {
      const res = await request(app)
        .get(`/v1/time-entries/summary?date=${targetDate}&user_id=${userAId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.total_minutes).toBe(135);
      expect(res.body.by_task).toHaveLength(2);
    });

    it('rejects summary request without required date parameter (400 Bad Request)', async () => {
      const res = await request(app)
        .get('/v1/time-entries/summary')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(400);
    });

    it('rejects summary request with malformed date parameter (400 Bad Request)', async () => {
      const res = await request(app)
        .get('/v1/time-entries/summary?date=invalid-date-format')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(400);
    });
  });

  describe('List & Filtering Endpoints (GET /v1/time-entries)', () => {
    beforeEach(async () => {
      // User A creates 2 entries
      await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task1Id,
          entry_date: '2026-09-20',
          duration_minutes: 60,
          note: 'September work',
        });

      await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task2Id,
          entry_date: '2026-09-25',
          duration_minutes: 90,
          note: 'Late September work',
        });

      // User B creates 1 entry
      await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task3Id,
          entry_date: '2026-09-22',
          duration_minutes: 45,
          note: 'User B work',
        });
    });

    it('includes only the logger name and role from the authoritative profile', async () => {
      const res = await request(app).get('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenAdmin}`).set('X-Active-Entity', 'ATA').expect(200);
      expect(res.body.data).toHaveLength(3);
      for (const entry of res.body.data) {
        expect(entry).toMatchObject(entry.user_id === userAId
          ? { user_name: 'Staff A (Accounting)', user_role: 'Accounting' }
          : { user_name: 'Staff B (Operations)', user_role: 'Operations' });
        expect(entry).not.toHaveProperty('email');
        expect(entry.created_at).toBeDefined();
      }
    });

    it('enriches legacy logs and retains their timestamp, note and duration', async () => {
      mockTables.task_time_logs.set('legacy-profile', { id: 'legacy-profile', task_id: task1Id,
        user_id: userAId, worker_name: 'Outdated Name', date: '2026-09-20', hours: 1,
        note: 'First line\nFull second line', created_at: '2026-09-21T01:30:00Z' });
      const res = await request(app).get(`/v1/time-entries?task_id=${task1Id}`)
        .set('Authorization', `Bearer ${tokenA}`).set('X-Active-Entity', 'ATA').expect(200);
      expect(res.body.data.find((entry) => entry.id === 'legacy-profile')).toMatchObject({
        user_name: 'Staff A (Accounting)', user_role: 'Accounting', duration_minutes: 60,
        entry_date: '2026-09-20', created_at: '2026-09-21T01:30:00Z', note: 'First line\nFull second line',
      });
    });

    it('keeps entries readable when the logger profile no longer exists', async () => {
      mockTables.users.delete(userAId);
      mockTables.task_time_logs.set('legacy-missing', { id: 'legacy-missing', task_id: task1Id,
        user_id: userAId, worker_name: 'Historical Name', date: '2026-09-20', hours: 1 });
      const res = await request(app).get('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenAdmin}`).set('X-Active-Entity', 'ATA').expect(200);
      expect(res.body.data.find((entry) => entry.id === 'legacy-missing')).toMatchObject({
        user_name: 'Historical Name', user_role: null,
      });
      expect(res.body.data.find((entry) => entry.task_id === task2Id)).toMatchObject({
        user_name: null, user_role: null,
      });
    });

    it('returns only callers own entries for standard staff user', async () => {
      const res = await request(app)
        .get('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((e) => e.user_id === userAId)).toBe(true);
      expect(res.body.data.every((e) => e.user_name === 'Staff A (Accounting)' && e.user_role === 'Accounting')).toBe(true);
    });

    it('ignores client-supplied user_id filter when caller is non-admin', async () => {
      const res = await request(app)
        .get(`/v1/time-entries?user_id=${userBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((e) => e.user_id === userAId)).toBe(true);
    });

    it('filters entries by date range (from and to)', async () => {
      const res = await request(app)
        .get('/v1/time-entries?from=2026-09-21&to=2026-09-26')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].entry_date).toBe('2026-09-25');
    });

    it('filters entries by task_id', async () => {
      const res = await request(app)
        .get(`/v1/time-entries?task_id=${task1Id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].task_id).toBe(task1Id);
    });

    it('allows Admin to see all entries across users when user_id is omitted', async () => {
      const res = await request(app)
        .get('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data).toHaveLength(3);
    });

    it('allows Admin to filter entries for a specific user via user_id', async () => {
      const res = await request(app)
        .get(`/v1/time-entries?user_id=${userBId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].user_id).toBe(userBId);
    });
  });

  describe('Authentication and RBAC Permission Enforcement', () => {
    it('rejects unauthenticated requests (401 Unauthorized)', async () => {
      await request(app)
        .get('/v1/time-entries')
        .expect(401);

      await request(app)
        .post('/v1/time-entries')
        .send({ task_id: task1Id, entry_date: getTodayStr(), duration_minutes: 60 })
        .expect(401);
    });

    it('rejects requests from users lacking timelog:create permission (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenUnpriv}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          task_id: task1Id,
          entry_date: getTodayStr(),
          duration_minutes: 60,
        });

      expect(res.status).toBe(403);
    });

    it('rejects requests from users lacking timelog:view permission (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/v1/time-entries')
        .set('Authorization', `Bearer ${tokenUnpriv}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(403);
    });
  });
  describe('Time logging audit regressions', () => {
    const call = (method, path, token = tokenA) => request(app)[method](path)
      .set('Authorization', `Bearer ${token}`).set('X-Active-Entity', 'ATA');
    const payload = () => ({ task_id: task1Id, entry_date: getTodayStr(), duration_minutes: 30 });

    it('rejects impossible dates and reversed ranges before database writes', async () => {
      expect((await call('post', '/v1/time-entries').send({ ...payload(), entry_date: '2026-02-31' })).status).toBe(400);
      expect((await call('get', '/v1/time-entries?from=2026-04-02&to=2026-04-01')).status).toBe(400);
      expect((await call('get', '/v1/time-entries/summary?date=2026-02-31')).status).toBe(400);
      expect(mockTables.time_entries.size).toBe(0);
    });

    it('uses the Manila calendar even when the server is still on the prior UTC day', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-10T16:15:00Z'));
      try {
        const { getMaxAllowedDate, createTimeEntrySchema } = require('../src/modules/timeEntries/schema');
        expect(getMaxAllowedDate()).toBe('2026-10-11');
        expect(createTimeEntrySchema.safeParse({ ...payload(), entry_date: '2026-10-11' }).success).toBe(true);
        expect(createTimeEntrySchema.safeParse({ ...payload(), entry_date: '2026-10-12' }).success).toBe(false);
      } finally { jest.useRealTimers(); }
    });

    it('rejects deleted tasks even when the join-table assignment survives', async () => {
      mockTables.tasks.get(task1Id).deleted_at = new Date().toISOString();
      expect((await call('post', '/v1/time-entries').send(payload())).status).toBe(404);
    });

    it('enforces selected entity for list, summary, create, edit and delete', async () => {
      const created = await call('post', '/v1/time-entries').send(payload());
      const id = created.body.data.id;
      mockTables.work_requests.get(wr1Id).entity_id = 'ent-lta';
      expect((await call('get', '/v1/time-entries')).body.data).toEqual([]);
      expect((await call('get', `/v1/time-entries/summary?date=${getTodayStr()}`)).body.total_minutes).toBe(0);
      expect((await call('post', '/v1/time-entries').send(payload())).status).toBe(404);
      expect((await call('patch', `/v1/time-entries/${id}`).send({ note: 'No access' })).status).toBe(404);
      expect((await call('delete', `/v1/time-entries/${id}`)).status).toBe(404);
      expect(mockTables.time_entries.has(id)).toBe(true);
    });

    it('requires the entry owner to be assigned when an admin moves their entry', async () => {
      const created = await call('post', '/v1/time-entries').send(payload());
      expect((await call('patch', `/v1/time-entries/${created.body.data.id}`, tokenAdmin)
        .send({ task_id: task3Id })).status).toBe(403);
    });

    it('legacy endpoint requires assignment and ignores forged worker identity', async () => {
      const path = `/v1/operations/work-requests/${wr1Id}/tasks/${task1Id}/time-logs`;
      const body = { logs: [{ date: getTodayStr(), hours: 0.5, userId: userBId, workerName: 'Forged' }] };
      expect((await call('post', path, tokenB).send(body)).status).toBe(403);
      const result = await call('post', path).send(body);
      expect(result.status).toBe(201);
      const rows = [...mockTables.task_time_logs.values()];
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(userAId);
      expect(rows[0].worker_name).not.toBe('Forged');
    });

    it('combines legacy and canonical time, with owner-safe edit/delete of legacy rows', async () => {
      const id = '33333333-0001-4000-8000-000000000001';
      mockTables.task_time_logs.set(id, { id, task_id: task1Id, user_id: userAId,
        date: getTodayStr(), hours: 1.5, created_at: new Date().toISOString() });
      await call('post', '/v1/time-entries').send(payload());
      expect((await call('get', '/v1/time-entries')).body.data).toHaveLength(2);
      expect((await call('get', `/v1/time-entries/summary?date=${getTodayStr()}`)).body.total_minutes).toBe(120);
      expect((await call('patch', `/v1/time-entries/${id}`, tokenB).send({ duration_minutes: 60 })).status).toBe(403);
      expect((await call('patch', `/v1/time-entries/${id}`).send({ duration_minutes: 60 })).body.data.duration_minutes).toBe(60);
      expect(mockTables.task_time_logs.get(id).hours).toBe(1);
      expect((await call('delete', `/v1/time-entries/${id}`)).status).toBe(204);
      expect(mockTables.task_time_logs.has(id)).toBe(false);
    });

    it('preserves time history on checklist edits/removal and ignores embedded time replacements', async () => {
      const checklistId = '44444444-0001-4000-8000-000000000001';
      const logId = '55555555-0001-4000-8000-000000000001';
      mockTables.task_checklists.set(checklistId, { id: checklistId, task_id: task1Id, text: 'Original' });
      mockTables.task_time_logs.set(logId, { id: logId, task_id: task1Id, user_id: userAId,
        checklist_item_id: checklistId, date: getTodayStr(), hours: 1 });
      const path = `/v1/operations/work-requests/${wr1Id}/tasks/${task1Id}`;
      const edited = await call('patch', path, tokenAdmin).send({ timeLogs: [],
        checklist: [{ id: checklistId, text: 'Edited', timeLogs: [{ date: getTodayStr(), hours: 9, userId: userBId }] }] });
      expect(edited.status).toBe(200);
      expect(mockTables.task_time_logs.get(logId).hours).toBe(1);
      expect(mockTables.task_checklists.get(checklistId).text).toBe('Edited');
      expect((await call('patch', path, tokenAdmin).send({ checklist: [] })).status).toBe(200);
      expect(mockTables.task_time_logs.get(logId).checklist_item_id).toBeNull();
      expect(mockTables.task_time_logs.get(logId).hours).toBe(1);
    });

    it('revokes a former primary assignee and allows the replacement to log', async () => {
      mockTables.tasks.get(task1Id).assignee_id = userAId;
      const path = `/v1/operations/work-requests/${wr1Id}/tasks/${task1Id}`;
      expect((await call('patch', path, tokenAdmin).send({ assigneeId: userBId })).status).toBe(200);
      expect((await call('post', '/v1/time-entries').send(payload())).status).toBe(403);
      expect((await call('post', '/v1/time-entries', tokenB).send(payload())).status).toBe(201);
    });

    it('rejects a checklist item belonging to another task', async () => {
      const result = await call('post', `/v1/operations/work-requests/${wr1Id}/tasks/${task1Id}/time-logs`)
        .send({ logs: [{ date: getTodayStr(), hours: 1, checklistItemId: '44444444-0001-4000-8000-000000000099' }] });
      expect(result.status).toBe(400);
      expect(mockTables.task_time_logs.size).toBe(0);
    });

    it('includes canonical duration entries in the operations task projection', async () => {
      await call('post', '/v1/time-entries').send(payload());
      const result = await call('get', `/v1/operations/work-requests/${wr1Id}/tasks/${task1Id}`, tokenAdmin);
      expect(result.status).toBe(200);
      expect(result.body.data.timeLogs).toHaveLength(1);
      expect(result.body.data.timeLogs[0].hours).toBe(0.5);
    });

    it('includes entries past the default database row limit in daily totals', async () => {
      for (let n = 0; n < 1005; n++) {
        const id = `entry-${String(n).padStart(5, '0')}`;
        mockTables.time_entries.set(id, { id, task_id: task1Id, user_id: userAId,
          entry_date: getTodayStr(), duration_minutes: 1 });
      }
      const result = await call('get', `/v1/time-entries/summary?date=${getTodayStr()}`);
      expect(result.status).toBe(200);
      expect(result.body.total_minutes).toBe(1005);
    });
  });

});
