/** Client master records are shared within an entity, independent of project membership. */
jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const { randomUUID } = require('crypto');
const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

const roles = ['Operations', 'Accounting', 'Documentation', 'HR', 'Manager'];
const viewers = [
  ...roles.map((role) => ({ label: role, role })),
  ...['Operations', 'Accounting', 'Documentation', 'HR', 'Management'].map((department) => ({
    label: `Staff / ${department}`,
    role: 'Staff',
    departments: [department],
  })),
];

describe('Shared, read-only client directory', () => {
  let standalone;
  let otherTeam;
  let archived;
  let lta;
  let workRequestId;

  beforeEach(() => {
    resetMock();
    seedDefaults();
    const seedClient = (name, entity = 'ATA', isArchived = false) => {
      const id = randomUUID();
      mockTables.clients.set(id, {
        id,
        name,
        entity_id: entity === 'ATA' ? 'ent-ata' : 'ent-lta',
        tin: id,
        status: isArchived ? 'Archived' : 'Active',
        deleted_at: isArchived ? new Date().toISOString() : null,
      });
      return id;
    };
    standalone = seedClient('Standalone Client');
    otherTeam = seedClient('Other Team Client');
    archived = seedClient('Archived Client', 'ATA', true);
    lta = seedClient('LTA Client', 'LTA');
    workRequestId = randomUUID();
    mockTables.work_requests.set(workRequestId, {
      id: workRequestId,
      entity_id: 'ent-ata',
      client_id: otherTeam,
      title: 'Other team project',
      assigned_to: randomUUID(),
      deleted_at: null,
    });
    const contactId = randomUUID();
    mockTables.client_contact_details.set(contactId, {
      id: contactId,
      client_id: standalone,
      type: 'email',
      value: 'contact@example.test',
    });
    const relatedId = randomUUID();
    mockTables.client_related_companies.set(relatedId, {
      id: relatedId,
      client_id: standalone,
      related_client_id: otherTeam,
      relationship: 'Affiliate',
    });
  });

  describe.each(viewers)('$label', (viewer) => {
    let token;
    const get = (path, entity = 'ATA') =>
      request(app)
        .get(`/v1/clients${path}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', entity);

    beforeEach(() => {
      token = registerUser({
        id: randomUUID(),
        email: `${viewer.label}@example.test`,
        name: viewer.label,
        role: viewer.role,
        departments: viewer.departments,
        entities: ['ATA', 'LTA'],
      });
    });

    it('lists and counts clients without assignments, including clients of other teams', async () => {
      const full = await get('?page=1&limit=50').expect(200);
      expect(full.body.meta).toMatchObject({ total: 2, totalPages: 1 });
      expect(full.body.data.map((client) => client.id).sort()).toEqual(
        [standalone, otherTeam].sort()
      );
      const list = await get('?page=1&limit=1&sortBy=name&sortOrder=asc').expect(200);
      expect(list.body.data.map((client) => client.id)).toEqual([otherTeam]);
      // The shared Supabase mock counts rows after range(); check the actual
      // page contents here and the full result count above.
      expect(list.body.meta).toMatchObject({ page: 1, limit: 1 });
      const next = await get('?page=2&limit=1&sortBy=name&sortOrder=asc').expect(200);
      expect(next.body.data.map((client) => client.id)).toEqual([standalone]);
      const search = await get('?search=Standalone').expect(200);
      expect(search.body.data.map((client) => client.id)).toEqual([standalone]);
      const counts = await get('/counts').expect(200);
      expect(counts.body.data).toEqual({ active: 2, archived: 1 });
    });

    it('reads client details, contacts, affiliates, and archives without project membership', async () => {
      const detail = await get(`/${standalone}`).expect(200);
      expect(detail.body.data.contactDetails).toEqual([
        expect.objectContaining({ value: 'contact@example.test' }),
      ]);
      expect(detail.body.data.relatedCompanies).toEqual([
        expect.objectContaining({ relatedClientId: otherTeam }),
      ]);
      await get(`/${otherTeam}`).expect(200);
      const list = await get('?archived=true').expect(200);
      expect(list.body.data.map((client) => client.id)).toEqual([archived]);
      await get(`/${archived}`).expect(404);
      await get(`/${archived}?includeArchived=true`).expect(200);
    });

    it('respects entity selection, including authorized consolidated reads', async () => {
      await get(`/${lta}`).expect(404);
      const list = await get('', 'LTA').expect(200);
      expect(list.body.data.map((client) => client.id)).toEqual([lta]);
      const all = await get('', 'ALL').expect(200);
      expect(all.body.data.map((client) => client.id).sort()).toEqual(
        [standalone, otherTeam, lta].sort()
      );
      const counts = await get('/counts', 'ALL').expect(200);
      expect(counts.body.data).toEqual({ active: 3, archived: 1 });
      await get(`/${lta}`, 'ALL').expect(200);
    });

    it('denies all client mutations and leaves stored records unchanged', async () => {
      const before = JSON.stringify(Array.from(mockTables.clients.entries()));
      for (const [method, path] of [
        ['post', ''],
        ['put', `/${standalone}`],
        ['delete', `/${standalone}`],
        ['post', `/${standalone}/archive`],
        ['post', `/${archived}/unarchive`],
      ]) {
        await request(app)
          [method](`/v1/clients${path}`)
          .set('Authorization', `Bearer ${token}`)
          .set('X-Active-Entity', 'ATA')
          .send({ name: 'Unauthorized edit' })
          .expect(403);
      }
      expect(JSON.stringify(Array.from(mockTables.clients.entries()))).toBe(before);
    });
  });

  it('keeps unassigned work requests hidden even when their client is visible', async () => {
    const token = registerUser({
      id: randomUUID(),
      email: 'unassigned@example.test',
      name: 'Unassigned Staff',
      role: 'Operations',
      entities: ['ATA'],
    });
    await request(app)
      .get(`/v1/clients/${otherTeam}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    await request(app)
      .get(`/v1/operations/${workRequestId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(404);
  });

  it('rejects unauthenticated, unpermitted, and unauthorized entity access', async () => {
    const token = registerUser({
      id: randomUUID(),
      email: 'single-entity@example.test',
      name: 'Single Entity',
      role: 'Operations',
      entities: ['ATA'],
    });
    const unpermitted = registerUser({
      id: randomUUID(),
      email: 'no-permission@example.test',
      name: 'No Permission',
      role: 'Staff',
      departments: [],
      entities: ['ATA'],
    });
    for (const path of ['', '/counts', `/${standalone}`]) {
      await request(app).get(`/v1/clients${path}`).expect(401);
      await request(app)
        .get(`/v1/clients${path}`)
        .set('Authorization', `Bearer ${unpermitted}`)
        .set('X-Active-Entity', 'ATA')
        .expect(403);
      for (const entity of ['LTA', 'ALL']) {
        await request(app)
          .get(`/v1/clients${path}`)
          .set('Authorization', `Bearer ${token}`)
          .set('X-Active-Entity', entity)
          .expect(403);
      }
    }
  });
});
