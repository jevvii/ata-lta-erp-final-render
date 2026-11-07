/**
 * /v1/clients integration tests.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

const validClient = {
  name: 'Acme Corp',
  tin: '123-456-789-00001',
  rdoCode: '034A',
  address: 'Makati City',
  entity: 'ATA',
  retainer: true,
  retainerFee: 5000.5,
  tradeName: 'Acme',
  contactDetails: [{ type: 'email', value: 'info@acme.test', label: 'Main' }],
  relatedCompanies: [],
};

describe('/v1/clients', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
  });

  it('creates a client when user has clients:edit', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    const res = await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validClient)
      .expect(201);

    expect(res.body.data.name).toBe('Acme Corp');
    expect(res.body.data.entity).toBe('ATA');
    expect(res.body.data.retainer).toBe(true);
    expect(res.body.data.retainerFee).toBe(5000.5);
    expect(res.body.data.contactDetails).toHaveLength(1);

    const audit = Array.from(mockTables.audit_logs.values());
    expect(audit.some((a) => a.action === 'client.created' && a.table_name === 'clients')).toBe(
      true
    );
  });

  it('lists clients scoped to the active entity', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(validClient)
      .expect(201);

    await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'LTA')
      .send({ ...validClient, tin: '123-456-789-00002', entity: 'LTA' })
      .expect(201);

    const res = await request(app)
      .get('/v1/clients')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].entity).toBe('ATA');
  });

  it('forbids clients:edit for users without the permission', async () => {
    const token = registerUser({
      email: 'ops@ata-lta.ph',
      name: 'Operations Staff',
      role: 'Operations',
      entities: ['ATA'],
    });

    const res = await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validClient)
      .expect(403);

    expect(res.body.title).toMatch(/forbidden/i);
  });

  it('returns 404 for a client outside the active entity', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    const created = await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(validClient)
      .expect(201);

    const res = await request(app)
      .get(`/v1/clients/${created.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'LTA')
      .expect(404);

    expect(res.body.title).toMatch(/not found/i);
  });

  it('soft deletes a client and writes an audit log', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(validClient)
      .expect(201);

    await request(app)
      .delete(`/v1/clients/${created.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(204);

    await request(app)
      .get(`/v1/clients/${created.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(404);

    const archivedRes = await request(app)
      .get(`/v1/clients/${created.body.data.id}?includeArchived=true`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(archivedRes.body.data.id).toBe(created.body.data.id);
    expect(archivedRes.body.data.status).toBe('Archived');

    const audit = Array.from(mockTables.audit_logs.values());
    expect(audit.some((a) => a.action === 'client.archived')).toBe(true);
  });

  it('returns client counts for the active entity', async () => {
    const admin = registerUser({
      email: 'admin-counts@ata-lta.ph',
      name: 'Admin Counts',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    const res = await request(app)
      .get('/v1/clients/counts')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data).toHaveProperty('active');
    expect(res.body.data).toHaveProperty('archived');
  });

  it('correctly partitions archived clients with null deleted_at into archived counts and lists', async () => {
    const admin = registerUser({
      email: 'admin-partition@ata-lta.ph',
      name: 'Admin Partition',
      role: 'Admin',
      entities: ['ATA'],
    });

    const activeClientRes = await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validClient, name: 'Active Client 1', tin: '111-222-333-00001' })
      .expect(201);

    // Insert a legacy record into mockTables directly: status 'Archived' with deleted_at null
    const legacyArchivedId = 'legacy-archived-1';
    mockTables.clients.set(legacyArchivedId, {
      id: legacyArchivedId,
      name: 'Legacy Archived Client',
      entity_id: 'ent-ata',
      entity_code: 'ATA',
      status: 'Archived',
      deleted_at: null,
      version: 1,
    });

    const countsRes = await request(app)
      .get('/v1/clients/counts')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(countsRes.body.data.active).toBe(1);
    expect(countsRes.body.data.archived).toBe(1);

    const listActiveRes = await request(app)
      .get('/v1/clients')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(listActiveRes.body.data.some((c) => c.id === legacyArchivedId)).toBe(false);
    expect(listActiveRes.body.data.some((c) => c.id === activeClientRes.body.data.id)).toBe(true);

    const listArchivedRes = await request(app)
      .get('/v1/clients?status=Archived')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(listArchivedRes.body.data.some((c) => c.id === legacyArchivedId)).toBe(true);
  });

  it('unarchives a client successfully and returns 409 if active client with same TIN exists', async () => {
    const admin = registerUser({
      email: 'admin-unarchive@ata-lta.ph',
      name: 'Admin Unarchive',
      role: 'Admin',
      entities: ['ATA'],
    });

    // 1. Create client 1 and archive it
    const client1 = await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validClient, name: 'Client 1', tin: '777-888-999-00001' })
      .expect(201);

    await request(app)
      .post(`/v1/clients/${client1.body.data.id}/archive`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    // 2. Unarchive client 1 when no active client has that TIN -> succeeds
    const unarchiveRes = await request(app)
      .post(`/v1/clients/${client1.body.data.id}/unarchive`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(unarchiveRes.body.data.status).toBe('Active');

    // 3. Unarchive again -> idempotent, returns Active client
    const idempotentRes = await request(app)
      .post(`/v1/clients/${client1.body.data.id}/unarchive`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(idempotentRes.body.data.status).toBe('Active');

    // 4. Archive client 1 again
    await request(app)
      .post(`/v1/clients/${client1.body.data.id}/archive`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    // 5. Create client 2 with the same TIN (allowed because client 1 is archived)
    await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validClient, name: 'Client 2', tin: '777-888-999-00001' })
      .expect(201);

    // 6. Try to unarchive client 1 -> 409 Conflict with DUPLICATE_TIN
    const conflictRes = await request(app)
      .post(`/v1/clients/${client1.body.data.id}/unarchive`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(409);

    expect(conflictRes.body.code).toBe('DUPLICATE_TIN');
    expect(conflictRes.body.detail).toContain('777-888-999-00001');

    // 7. Insert an additional active client with the same TIN directly into mock (simulating dirty legacy data)
    mockTables.clients.set('client-extra-dup', {
      id: 'client-extra-dup',
      name: 'Client 2 Duplicate',
      entity_id: 'ent-ata',
      entity_code: 'ATA',
      tin: '777-888-999-00001',
      status: 'Active',
      deleted_at: null,
      version: 1,
    });

    // Unarchive client 1 must still return 409 Conflict with DUPLICATE_TIN (not fail or throw PGRST116)
    const multiDupRes = await request(app)
      .post(`/v1/clients/${client1.body.data.id}/unarchive`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(409);

    expect(multiDupRes.body.code).toBe('DUPLICATE_TIN');
    expect(multiDupRes.body.detail).toContain('777-888-999-00001');
  });

  describe('Client Sorting & Ordering via API', () => {
    let token;
    beforeEach(() => {
      resetMock();
      seedDefaults();
      token = registerUser({
        email: 'admin-sort@ata-lta.ph',
        name: 'Admin Sort',
        role: 'Admin',
        entities: ['ATA'],
      });

      mockTables.clients.set('c-zebra', {
        id: 'c-zebra',
        name: 'Zebra Corp',
        client_number: 'CLI-ATA-0002',
        tin: '999-000-111-000',
        rdo_code: '047',
        created_at: '2026-01-01T00:00:00Z',
        entity_id: 'ent-ata',
        entity_code: 'ATA',
        deleted_at: null,
        status: 'Active',
      });
      mockTables.clients.set('c-alpha', {
        id: 'c-alpha',
        name: 'Alpha Logistics',
        client_number: 'CLI-ATA-0001',
        tin: '111-222-333-000',
        rdo_code: '034A',
        created_at: '2026-02-01T00:00:00Z',
        entity_id: 'ent-ata',
        entity_code: 'ATA',
        deleted_at: null,
        status: 'Active',
      });
      mockTables.clients.set('c-middle', {
        id: 'c-middle',
        name: 'Middle Enterprises',
        client_number: 'CLI-ATA-0010',
        tin: '555-666-777-000',
        rdo_code: '044',
        created_at: '2026-03-01T00:00:00Z',
        entity_id: 'ent-ata',
        entity_code: 'ATA',
        deleted_at: null,
        status: 'Active',
      });
      mockTables.clients.set('c-beta', {
        id: 'c-beta',
        name: 'Beta Technologies',
        client_number: null,
        tin: '333-444-555-000',
        rdo_code: null,
        created_at: '2026-01-15T00:00:00Z',
        entity_id: 'ent-ata',
        entity_code: 'ATA',
        deleted_at: null,
        status: 'Active',
      });
    });

    it('defaults to client_number ascending with nulls last', async () => {
      const res = await request(app)
        .get('/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const ids = res.body.data.map((c) => c.id);
      expect(ids).toEqual(['c-alpha', 'c-zebra', 'c-middle', 'c-beta']);
    });

    it('sorts by client_number descending with nulls last', async () => {
      const res = await request(app)
        .get('/v1/clients?sortBy=client_number&sortOrder=desc')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const ids = res.body.data.map((c) => c.id);
      expect(ids).toEqual(['c-middle', 'c-zebra', 'c-alpha', 'c-beta']);
    });

    it('sorts by name ascending and descending', async () => {
      const ascRes = await request(app)
        .get('/v1/clients?sortBy=name&sortOrder=asc')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(ascRes.body.data.map((c) => c.id)).toEqual(['c-alpha', 'c-beta', 'c-middle', 'c-zebra']);

      const descRes = await request(app)
        .get('/v1/clients?sortBy=name&sortOrder=desc')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(descRes.body.data.map((c) => c.id)).toEqual(['c-zebra', 'c-middle', 'c-beta', 'c-alpha']);
    });

    it('sorts by tin ascending and descending', async () => {
      const ascRes = await request(app)
        .get('/v1/clients?sortBy=tin&sortOrder=asc')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(ascRes.body.data.map((c) => c.id)).toEqual(['c-alpha', 'c-beta', 'c-middle', 'c-zebra']);

      const descRes = await request(app)
        .get('/v1/clients?sortBy=tin&sortOrder=desc')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(descRes.body.data.map((c) => c.id)).toEqual(['c-zebra', 'c-middle', 'c-beta', 'c-alpha']);
    });

    it('sorts by created_at descending', async () => {
      const res = await request(app)
        .get('/v1/clients?sortBy=created_at&sortOrder=desc')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(res.body.data.map((c) => c.id)).toEqual(['c-middle', 'c-alpha', 'c-beta', 'c-zebra']);
    });

    it('sorts by rdo_code ascending and descending with nulls last', async () => {
      const ascRes = await request(app)
        .get('/v1/clients?sortBy=rdo_code&sortOrder=asc')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(ascRes.body.data.map((c) => c.id)).toEqual(['c-alpha', 'c-middle', 'c-zebra', 'c-beta']);

      const descRes = await request(app)
        .get('/v1/clients?sortBy=rdo_code&sortOrder=desc')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(descRes.body.data.map((c) => c.id)).toEqual(['c-zebra', 'c-middle', 'c-alpha', 'c-beta']);
    });

    it.each(['asc', 'desc'])('sorts RDO globally before pagination (%s)', async (direction) => {
      mockTables.clients.get('c-alpha').rdo_code = '2';
      mockTables.clients.get('c-middle').rdo_code = '10';
      mockTables.clients.get('c-zebra').rdo_code = '3';
      const expected = direction === 'asc'
        ? ['c-alpha', 'c-zebra', 'c-middle', 'c-beta']
        : ['c-middle', 'c-zebra', 'c-alpha', 'c-beta'];
      const ids = [];
      const metas = [];
      for (let page = 1; page <= 4; page++) {
        const res = await request(app)
          .get(`/v1/clients?sortBy=rdo_code&sortOrder=${direction}&page=${page}&limit=1`)
          .set('Authorization', `Bearer ${token}`)
          .set('X-Active-Entity', 'ATA')
          .expect(200);
        ids.push(...res.body.data.map((client) => client.id));
        metas.push(res.body.meta);
      }
      expect(ids).toEqual(expected);
      metas.forEach((meta, index) => expect(meta).toMatchObject({ total: 4, page: index + 1, limit: 1, totalPages: 4 }));
    });

    it('keeps RDO pagination complete and entity-scoped beyond 1,000 clients', async () => {
      mockTables.clients.clear();
      for (let index = 1; index <= 1001; index++) {
        mockTables.clients.set(`rdo-${index}`, {
          id: `rdo-${index}`, name: `Client ${index}`, rdo_code: String(index),
          entity_id: 'ent-ata', status: 'Active', deleted_at: null,
        });
      }
      mockTables.clients.set('other-entity', {
        id: 'other-entity', name: 'Foreign client', rdo_code: '9999',
        entity_id: 'ent-lta', status: 'Active', deleted_at: null,
      });
      const res = await request(app)
        .get('/v1/clients?sortBy=rdo_code&sortOrder=asc&page=1001&limit=1')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(res.body.data.map((client) => client.id)).toEqual(['rdo-1001']);
      expect(res.body.meta).toMatchObject({ total: 1001, page: 1001, limit: 1, totalPages: 1001 });
    });

    it('sorts by rdoCode alias identically to rdo_code', async () => {
      const ascRes = await request(app)
        .get('/v1/clients?sortBy=rdoCode&sortOrder=asc')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(ascRes.body.data.map((c) => c.id)).toEqual(['c-alpha', 'c-middle', 'c-zebra', 'c-beta']);

      const descRes = await request(app)
        .get('/v1/clients?sortBy=rdoCode&sortOrder=desc')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(descRes.body.data.map((c) => c.id)).toEqual(['c-zebra', 'c-middle', 'c-alpha', 'c-beta']);
    });
  });
});
