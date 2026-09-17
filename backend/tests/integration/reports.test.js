/**
 * /v1/reports/dashboard integration tests.
 *
 * Verifies the dashboard calendar payload is visibility-filtered per user:
 * - Staff only see work requests they are concerned with (assignee, requester,
 *   submitter) — not unassigned or other people's work requests.
 * - Non-accounting staff only see Released/Funded/Rejected disbursements that
 *   are linked to one of their concerned work requests.
 * - The 30-second entity-keyed analytics cache must never serve one user's
 *   calendar to another user.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

let seq = 0;
const nextTestId = (prefix) => `${prefix}-${++seq}`;

const DAYS = 24 * 60 * 60 * 1000;
const futureStr = (days = 10) => new Date(Date.now() + days * DAYS).toISOString().slice(0, 10);
const pastStr = (days = 5) => new Date(Date.now() - days * DAYS).toISOString().slice(0, 10);

const seedWorkRequest = (overrides = {}) => {
  const wr = {
    id: nextTestId('wr'),
    entity_id: 'ent-ata',
    title: 'Work Request',
    status: 'In Progress',
    due_date: futureStr(),
    client_id: null,
    assigned_to: null,
    requested_by: null,
    submitted_by: null,
    archived: false,
    deleted_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  mockTables.work_requests.set(wr.id, wr);
  return wr;
};

const seedTask = (workRequestId, overrides = {}) => {
  const task = {
    id: nextTestId('task'),
    work_request_id: workRequestId,
    title: 'Task',
    status: 'In Progress',
    assignee_id: null,
    assignee_name: null,
    due_date: futureStr(),
    display_order: 1,
    deleted_at: null,
    ...overrides,
  };
  mockTables.tasks.set(task.id, task);
  return task;
};

const seedDisbursement = (overrides = {}) => {
  const disb = {
    id: nextTestId('db'),
    entity_id: 'ent-ata',
    disbursement_number: `DB-${seq}`,
    status: 'Draft',
    due_date: futureStr(),
    amount: 1000,
    client_id: null,
    linked_work_request_id: null,
    archived: false,
    deleted_at: null,
    ...overrides,
  };
  mockTables.disbursements.set(disb.id, disb);
  return disb;
};

const getDashboard = (token, entity = 'ATA') =>
  request(app)
    .get('/v1/reports/dashboard')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Active-Entity', entity);

const calendarIds = (res, type) =>
  (res.body.data?.calendar || []).filter((i) => i.type === type).map((i) => i.id);

describe('/v1/reports/dashboard visibility', () => {
  let adminToken;
  let staffToken;
  let accountingToken;
  const staffId = 'user-staff-1';
  const accountingId = 'user-acct-1';

  beforeEach(() => {
    resetMock();
    seedDefaults();
    adminToken = registerUser({
      id: 'user-admin-1',
      email: 'admin@ata-lta.ph',
      name: 'Admin User',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });
    staffToken = registerUser({
      id: staffId,
      email: 'staff@ata-lta.ph',
      name: 'Staff User',
      role: 'Operations',
      entities: ['ATA', 'LTA'],
    });
    accountingToken = registerUser({
      id: accountingId,
      email: 'acct@ata-lta.ph',
      name: 'Accounting User',
      role: 'Accounting',
      entities: ['ATA', 'LTA'],
    });
  });

  it('admin sees every work request in the calendar', async () => {
    const assignedToNobody = seedWorkRequest({ title: 'Unassigned WR' });
    seedTask(assignedToNobody.id, { assignee_id: 'user-someone-else' });

    const res = await getDashboard(adminToken).expect(200);
    expect(calendarIds(res, 'wr')).toContain(assignedToNobody.id);
  });

  it('staff only see work requests they are assigned to, requested, or submitted', async () => {
    const mineByTask = seedWorkRequest({ title: 'Assigned to staff' });
    seedTask(mineByTask.id, { assignee_id: staffId });

    const mineByRequester = seedWorkRequest({ title: 'Requested by staff', requested_by: staffId });
    const mineBySubmitter = seedWorkRequest({ title: 'Submitted by staff', submitted_by: staffId });

    const otherAssigned = seedWorkRequest({ title: 'Assigned to someone else' });
    seedTask(otherAssigned.id, { assignee_id: 'user-someone-else' });

    const noAssignee = seedWorkRequest({ title: 'No assignee at all' });
    seedTask(noAssignee.id, {});

    const res = await getDashboard(staffToken).expect(200);
    const ids = calendarIds(res, 'wr');

    expect(ids).toContain(mineByTask.id);
    expect(ids).toContain(mineByRequester.id);
    expect(ids).toContain(mineBySubmitter.id);
    expect(ids).not.toContain(otherAssigned.id);
    expect(ids).not.toContain(noAssignee.id);
  });

  it('staff are matched by assignee_name as well as assignee_id', async () => {
    const byName = seedWorkRequest({ title: 'Name-matched' });
    seedTask(byName.id, { assignee_name: 'Staff User' });

    const res = await getDashboard(staffToken).expect(200);
    expect(calendarIds(res, 'wr')).toContain(byName.id);
  });

  it('non-accounting users only see released-type disbursements linked to their work requests', async () => {
    const myWr = seedWorkRequest({});
    seedTask(myWr.id, { assignee_id: staffId });

    const myReleased = seedDisbursement({ status: 'Released', linked_work_request_id: myWr.id });
    const myDraft = seedDisbursement({ status: 'Draft', linked_work_request_id: myWr.id });
    const otherReleased = seedDisbursement({ status: 'Released', linked_work_request_id: null });

    const res = await getDashboard(staffToken).expect(200);
    const ids = calendarIds(res, 'db');

    expect(ids).toContain(myReleased.id);
    expect(ids).not.toContain(myDraft.id);
    expect(ids).not.toContain(otherReleased.id);
  });

  it('accounting users see all disbursements but only their own work requests', async () => {
    const draft = seedDisbursement({ status: 'Draft' });
    const otherWr = seedWorkRequest({ title: 'Someone else WR' });

    const res = await getDashboard(accountingToken).expect(200);
    expect(calendarIds(res, 'db')).toContain(draft.id);
    expect(calendarIds(res, 'wr')).not.toContain(otherWr.id);
  });

  it("a second user's request does not receive the first user's cached calendar", async () => {
    const staffWr = seedWorkRequest({ title: 'Staff WR' });
    seedTask(staffWr.id, { assignee_id: staffId });
    const unassignedWr = seedWorkRequest({ title: 'Unassigned WR' });

    // Admin first — populates the shared 30s analytics cache for the entity.
    const adminRes = await getDashboard(adminToken).expect(200);
    expect(calendarIds(adminRes, 'wr')).toEqual(
      expect.arrayContaining([staffWr.id, unassignedWr.id])
    );

    // Staff immediately after — must NOT inherit the admin's calendar.
    const staffRes = await getDashboard(staffToken).expect(200);
    const staffIds = calendarIds(staffRes, 'wr');
    expect(staffIds).toContain(staffWr.id);
    expect(staffIds).not.toContain(unassignedWr.id);
  });

  it('consolidated (ALL) mode enforces managerial gate and returns all for admin', async () => {
    const staffWrAta = seedWorkRequest({ title: 'ATA mine' });
    seedTask(staffWrAta.id, { assignee_id: staffId });
    const otherWrAta = seedWorkRequest({ title: 'ATA not mine' });
    const staffWrLta = seedWorkRequest({ title: 'LTA mine', entity_id: 'ent-lta' });
    seedTask(staffWrLta.id, { assignee_id: staffId });
    const otherWrLta = seedWorkRequest({ title: 'LTA not mine', entity_id: 'ent-lta' });

    // Non-managerial staff cannot request consolidated 'ALL' view
    await getDashboard(staffToken, 'ALL').expect(403);

    // And admin in ALL mode still sees everything.
    const adminRes = await getDashboard(adminToken, 'ALL').expect(200);
    expect(calendarIds(adminRes, 'wr')).toEqual(
      expect.arrayContaining([staffWrAta.id, otherWrAta.id, staffWrLta.id, otherWrLta.id])
    );
  });

  it('overdue open work requests respect the same visibility filter', async () => {
    const myOverdue = seedWorkRequest({ due_date: pastStr(), status: 'In Progress' });
    seedTask(myOverdue.id, { assignee_id: staffId });
    const otherOverdue = seedWorkRequest({ due_date: pastStr(), status: 'In Progress' });
    const completedOverdue = seedWorkRequest({ due_date: pastStr(), status: 'Completed' });
    seedTask(completedOverdue.id, { assignee_id: staffId });

    const staffRes = await getDashboard(staffToken).expect(200);
    const staffIds = calendarIds(staffRes, 'wr');
    expect(staffIds).toContain(myOverdue.id);
    expect(staffIds).not.toContain(otherOverdue.id);
    expect(staffIds).not.toContain(completedOverdue.id);

    const adminRes = await getDashboard(adminToken).expect(200);
    const adminIds = calendarIds(adminRes, 'wr');
    expect(adminIds).toContain(myOverdue.id);
    expect(adminIds).toContain(otherOverdue.id);
  });
});
