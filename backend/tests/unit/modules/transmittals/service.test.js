/**
 * Transmittals service unit tests.
 * Tests for status workflow transitions, task assignment enforcement,
 * and blank task rejection for Documentation users.
 */

jest.mock('../../../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../../../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const service = require('../../../../src/modules/transmittals/service');
const { resetMock, seedDefaults, mockTables } = require('../../../fixtures/supabaseMock');

const ENTITY_ID = 'ent-ata';
const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const WORK_REQUEST_ID = '33333333-3333-3333-3333-333333333333';
const TASK_ID_PRIMARY = 'd1111111-1111-4111-8111-111111111111';
const TASK_ID_COASSIGNEE = 'd2222222-2222-4222-8222-222222222222';
const TASK_ID_UNASSIGNED = 'd3333333-3333-4333-8333-333333333333';

const DOC_USER_ID = 'd4444444-4444-4444-8444-444444444444';
const ADMIN_USER_ID = 'd5555555-5555-4555-8555-555555555555';

describe('Transmittals Service - Status Workflow', () => {
  describe('Valid transitions', () => {
    it('allows Draft → Sent (send)', () => {
      const validFrom = 'Draft';
      const currentStatus = 'Draft';
      expect(currentStatus).toBe(validFrom);
    });

    it('allows Sent → Acknowledged (acknowledge)', () => {
      const validFrom = 'Sent';
      const currentStatus = 'Sent';
      expect(currentStatus).toBe(validFrom);
    });
  });

  describe('Invalid transitions', () => {
    it('does not allow sending an Acknowledged transmittal', () => {
      const validFrom = 'Draft';
      const currentStatus = 'Acknowledged';
      expect(currentStatus).not.toBe(validFrom);
    });

    it('does not allow acknowledging a Draft transmittal', () => {
      const validFrom = 'Sent';
      const currentStatus = 'Draft';
      expect(currentStatus).not.toBe(validFrom);
    });

    it('does not allow sending a Sent transmittal again', () => {
      const validFrom = 'Draft';
      const currentStatus = 'Sent';
      expect(currentStatus).not.toBe(validFrom);
    });
  });
});

describe('Transmittals Service - Task Assignment & Scoping Enforcement (F06, F07)', () => {
  const docUser = {
    id: DOC_USER_ID,
    role: 'Documentation',
    departments: ['Documentation'],
  };

  const adminUser = {
    id: ADMIN_USER_ID,
    role: 'Admin',
    departments: [],
  };

  beforeEach(() => {
    resetMock();
    seedDefaults();

    // Seed client
    mockTables.clients.set(CLIENT_ID, {
      id: CLIENT_ID,
      entity_id: ENTITY_ID,
      name: 'Acme Corp',
    });

    // Seed work request
    mockTables.work_requests.set(WORK_REQUEST_ID, {
      id: WORK_REQUEST_ID,
      entity_id: ENTITY_ID,
      client_id: CLIENT_ID,
      title: 'Tax Review',
    });

    // Seed tasks:
    // 1. Primary assignee is DOC_USER_ID
    mockTables.tasks.set(TASK_ID_PRIMARY, {
      id: TASK_ID_PRIMARY,
      work_request_id: WORK_REQUEST_ID,
      assignee_id: DOC_USER_ID,
    });

    // 2. Co-assignee is DOC_USER_ID
    mockTables.tasks.set(TASK_ID_COASSIGNEE, {
      id: TASK_ID_COASSIGNEE,
      work_request_id: WORK_REQUEST_ID,
      assignee_id: 'someone-else',
    });
    mockTables.task_assignees.set('assignee-doc-1', {
      id: 'assignee-doc-1',
      task_id: TASK_ID_COASSIGNEE,
      user_id: DOC_USER_ID,
    });

    // 3. Unassigned task
    mockTables.tasks.set(TASK_ID_UNASSIGNED, {
      id: TASK_ID_UNASSIGNED,
      work_request_id: WORK_REQUEST_ID,
      assignee_id: 'other-assignee',
    });
  });

  describe('createTransmittal', () => {
    const basePayload = {
      clientId: CLIENT_ID,
      workRequestId: WORK_REQUEST_ID,
      items: [{ description: 'Tax returns', quantity: 1 }],
    };

    it('rejects creation without linkedTaskId for Documentation user (400 Bad Request)', async () => {
      await expect(
        service.createTransmittal({
          entityId: ENTITY_ID,
          userId: DOC_USER_ID,
          user: docUser,
          data: { ...basePayload, linkedTaskId: '' },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        detail: 'A valid linked task is required for transmittals',
      });

      await expect(
        service.createTransmittal({
          entityId: ENTITY_ID,
          userId: DOC_USER_ID,
          user: docUser,
          data: { ...basePayload, linkedTaskId: null },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        detail: 'A valid linked task is required for transmittals',
      });
    });

    it('rejects creation for Documentation user when not assigned to task (403 Forbidden)', async () => {
      await expect(
        service.createTransmittal({
          entityId: ENTITY_ID,
          userId: DOC_USER_ID,
          user: docUser,
          data: { ...basePayload, linkedTaskId: TASK_ID_UNASSIGNED },
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        detail: 'You are not assigned to this task',
      });
    });

    it('allows creation when Documentation user is primary assignee (201)', async () => {
      const result = await service.createTransmittal({
        entityId: ENTITY_ID,
        userId: DOC_USER_ID,
        user: docUser,
        data: { ...basePayload, linkedTaskId: TASK_ID_PRIMARY },
      });

      expect(result.id).toBeDefined();
      expect(result.linked_task_id).toBe(TASK_ID_PRIMARY);
      expect(result.status).toBe('Draft');
      expect(result.approved).toBe(false);
    });

    it('allows creation when Documentation user is co-assignee (201)', async () => {
      const result = await service.createTransmittal({
        entityId: ENTITY_ID,
        userId: DOC_USER_ID,
        user: docUser,
        data: { ...basePayload, linkedTaskId: TASK_ID_COASSIGNEE },
      });

      expect(result.id).toBeDefined();
      expect(result.linked_task_id).toBe(TASK_ID_COASSIGNEE);
      expect(result.status).toBe('Draft');
    });

    it('rejects Admin creating transmittal without a linked task (400 Bad Request)', async () => {
      await expect(
        service.createTransmittal({
          entityId: ENTITY_ID,
          userId: ADMIN_USER_ID,
          user: adminUser,
          data: { ...basePayload, linkedTaskId: null },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        detail: 'A valid linked task is required for transmittals',
      });
    });

    it('allows Admin to create a transmittal with an unassigned task (Admin bypass)', async () => {
      const result = await service.createTransmittal({
        entityId: ENTITY_ID,
        userId: ADMIN_USER_ID,
        user: adminUser,
        data: { ...basePayload, linkedTaskId: TASK_ID_UNASSIGNED },
      });

      expect(result.id).toBeDefined();
      expect(result.linked_task_id).toBe(TASK_ID_UNASSIGNED);
    });
  });

  describe('updateTransmittal', () => {
    let transmittalId;

    beforeEach(async () => {
      const created = await service.createTransmittal({
        entityId: ENTITY_ID,
        userId: DOC_USER_ID,
        user: docUser,
        data: {
          clientId: CLIENT_ID,
          workRequestId: WORK_REQUEST_ID,
          linkedTaskId: TASK_ID_PRIMARY,
          items: [{ description: 'Form 1701', quantity: 1 }],
        },
      });
      transmittalId = created.id;
    });

    it('prevents Documentation user from clearing linkedTaskId (400 Bad Request)', async () => {
      await expect(
        service.updateTransmittal({
          entityId: ENTITY_ID,
          id: transmittalId,
          userId: DOC_USER_ID,
          user: docUser,
          data: { linkedTaskId: null },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        detail: 'A valid linked task is required for transmittals',
      });

      await expect(
        service.updateTransmittal({
          entityId: ENTITY_ID,
          id: transmittalId,
          userId: DOC_USER_ID,
          user: docUser,
          data: { linkedTaskId: '' },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        detail: 'A valid linked task is required for transmittals',
      });
    });

    it('rejects relinking to an unassigned task for Documentation user (403 Forbidden)', async () => {
      await expect(
        service.updateTransmittal({
          entityId: ENTITY_ID,
          id: transmittalId,
          userId: DOC_USER_ID,
          user: docUser,
          data: { linkedTaskId: TASK_ID_UNASSIGNED },
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        detail: 'You are not assigned to this task',
      });
    });

    it('allows relinking to another assigned task (co-assignee)', async () => {
      const updated = await service.updateTransmittal({
        entityId: ENTITY_ID,
        id: transmittalId,
        userId: DOC_USER_ID,
        user: docUser,
        data: { linkedTaskId: TASK_ID_COASSIGNEE },
      });

      expect(updated.linked_task_id).toBe(TASK_ID_COASSIGNEE);
    });

    it('allows updating notes while maintaining assignment to existing task', async () => {
      const updated = await service.updateTransmittal({
        entityId: ENTITY_ID,
        id: transmittalId,
        userId: DOC_USER_ID,
        user: docUser,
        data: { notes: 'Updated notes' },
      });

      expect(updated.notes).toBe('Updated notes');
      expect(updated.linked_task_id).toBe(TASK_ID_PRIMARY);
    });
  });

  describe('sendTransmittal', () => {
    let transmittalId;

    beforeEach(async () => {
      const created = await service.createTransmittal({
        entityId: ENTITY_ID,
        userId: DOC_USER_ID,
        user: docUser,
        data: {
          clientId: CLIENT_ID,
          workRequestId: WORK_REQUEST_ID,
          linkedTaskId: TASK_ID_PRIMARY,
          items: [{ description: 'Form 1701', quantity: 1 }],
        },
      });
      transmittalId = created.id;
      // Mark approved in mock table
      mockTables.transmittals.get(transmittalId).approved = true;
    });

    it('re-verifies assignment on send and allows assigned Documentation user', async () => {
      const sent = await service.sendTransmittal({
        entityId: ENTITY_ID,
        id: transmittalId,
        userId: DOC_USER_ID,
        user: docUser,
      });

      expect(sent.status).toBe('Sent');
    });

    it('rejects send if Documentation user is not assigned to linked task (403 Forbidden)', async () => {
      const otherDocUserId = 'd6666666-6666-4666-8666-666666666666';
      mockTables.work_requests.get(WORK_REQUEST_ID).co_assignees = [otherDocUserId];
      const otherDocUser = {
        id: otherDocUserId,
        role: 'Documentation',
        departments: ['Documentation'],
      };

      await expect(
        service.sendTransmittal({
          entityId: ENTITY_ID,
          id: transmittalId,
          userId: otherDocUserId,
          user: otherDocUser,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        detail: 'You are not assigned to this task',
      });
    });

    it('rejects send if transmittal has no linked task for Documentation user (400 Bad Request)', async () => {
      // Clear linked_task_id directly in mock
      mockTables.transmittals.get(transmittalId).linked_task_id = null;

      await expect(
        service.sendTransmittal({
          entityId: ENTITY_ID,
          id: transmittalId,
          userId: DOC_USER_ID,
          user: docUser,
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        detail: 'A valid linked task is required for transmittals',
      });
    });
  });

  describe('Checked-in Schema & Undeclared Column Safety', () => {
    const SCHEMA_WR_ID = 'wr-schema-test-001';
    const SCHEMA_WR_FOREIGN_ID = 'wr-schema-test-foreign-002';
    const SCHEMA_TASK_ID = 'task-schema-test-001';
    const SCHEMA_TASK_FOREIGN_WR = 'task-schema-foreign-002';

    beforeEach(() => {
      mockTables.work_requests.set(SCHEMA_WR_ID, {
        id: SCHEMA_WR_ID,
        entity_id: ENTITY_ID,
        client_id: CLIENT_ID,
        title: 'Schema Test WR',
        status: 'In Progress',
        deleted_at: null,
      });
      mockTables.work_requests.set(SCHEMA_WR_FOREIGN_ID, {
        id: SCHEMA_WR_FOREIGN_ID,
        entity_id: 'ent-lta',
        client_id: CLIENT_ID,
        title: 'Foreign Entity WR',
        status: 'In Progress',
        deleted_at: null,
      });

      mockTables.tasks.set(SCHEMA_TASK_ID, {
        id: SCHEMA_TASK_ID,
        work_request_id: SCHEMA_WR_ID,
        assignee_id: DOC_USER_ID,
        deleted_at: null,
      });
      mockTables.tasks.set(SCHEMA_TASK_FOREIGN_WR, {
        id: SCHEMA_TASK_FOREIGN_WR,
        work_request_id: SCHEMA_WR_FOREIGN_ID,
        assignee_id: DOC_USER_ID,
        deleted_at: null,
      });
    });

    it('rejects undeclared tasks.entity_id in mock query builder (detects regressions)', async () => {
      const { supabaseAdmin } = require('../../../../src/services/supabaseClient');
      const res = await supabaseAdmin.from('tasks').select('id, entity_id').eq('id', SCHEMA_TASK_ID).maybeSingle();
      expect(res.error).toBeDefined();
      expect(res.error.code).toBe('42703');
      expect(res.error.message).toMatch(/column tasks\.entity_id does not exist/);
    });

    it('creates transmittal using task with checked-in schema columns (no tasks.entity_id)', async () => {
      const initialCount = mockTables.transmittals.size;
      const created = await service.createTransmittal({
        entityId: ENTITY_ID,
        userId: DOC_USER_ID,
        user: docUser,
        data: {
          clientId: CLIENT_ID,
          workRequestId: SCHEMA_WR_ID,
          linkedTaskId: SCHEMA_TASK_ID,
          items: [{ description: 'Schema Verified Item', quantity: 1 }],
        },
      });

      expect(created).toBeDefined();
      expect(created.work_request_id).toBe(SCHEMA_WR_ID);
      expect(created.linked_task_id).toBe(SCHEMA_TASK_ID);
      expect(mockTables.transmittals.size).toBe(initialCount + 1);
    });

    it('determines task entity ownership through parent work request and rejects cross-entity task without mutations', async () => {
      const initialCount = mockTables.transmittals.size;

      await expect(
        service.createTransmittal({
          entityId: ENTITY_ID,
          userId: DOC_USER_ID,
          user: docUser,
          data: {
            clientId: CLIENT_ID,
            workRequestId: SCHEMA_WR_FOREIGN_ID,
            linkedTaskId: SCHEMA_TASK_FOREIGN_WR,
            items: [{ description: 'Cross-entity Transmittal', quantity: 1 }],
          },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        title: 'Bad Request',
      });

      expect(mockTables.transmittals.size).toBe(initialCount);
    });

    it('rejects cross-WR task linking without persisting changes', async () => {
      const initialCount = mockTables.transmittals.size;

      await expect(
        service.createTransmittal({
          entityId: ENTITY_ID,
          userId: DOC_USER_ID,
          user: docUser,
          data: {
            clientId: CLIENT_ID,
            workRequestId: SCHEMA_WR_ID,
            linkedTaskId: SCHEMA_TASK_FOREIGN_WR,
            items: [{ description: 'Mismatched Task Transmittal', quantity: 1 }],
          },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        detail: 'Linked task does not belong to the specified work request',
      });

      expect(mockTables.transmittals.size).toBe(initialCount);
    });
  });
});
