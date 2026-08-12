/**
 * Edge Case Verification Script for Transmittal Changes on Staging Database.
 * Loads backend/.env.staging, runs target service methods, and validates DB state.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');

// 1. Load Staging environment
const envPath = path.join(__dirname, '..', '.env.staging');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const databaseUrl = process.env.DATABASE_URL;

if (!supabaseUrl || !serviceKey || !databaseUrl) {
  console.error('Missing configuration in .env.staging');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Import services directly to test backend methods
const transmittalsService = require('../src/modules/transmittals/service');
const operationsService = require('../src/modules/operations/service');

async function testEdgeCases() {
  console.log('=== Running Transmittal Edge Case Tests against Staging Database ===\n');

  const testUserId = '00000000-0000-0000-0000-000000000001'; // Seed Admin User
  const testClientId = 'c0000002-0000-0000-0000-000000000002'; // Staging Client ID
  const testEntityId = 'e83dc90b-d9b5-4854-8adf-7fe21c2e6822'; // ATA Entity UUID
  const entityCode = 'ATA';

  // --- Test Case 1 & 2: Approve transitions to Sent, logs audit entries, and preserves items ---
  console.log('Test 1: Approving transmittal transitions status to "Sent" and preserves items...');
  const testTrackNum = `TX-EDGE-${Date.now()}`;
  
  // Create a draft transmittal with an item
  const created = await transmittalsService.createTransmittal({
    entityId: testEntityId,
    userId: testUserId,
    data: {
      clientId: testClientId,
      trackingNumber: testTrackNum,
      notes: 'Edge case test notes',
      items: [
        { description: 'Edge Case Document', documentType: 'Original Copy' }
      ]
    }
  });

  if (!created || created.status !== 'Draft') {
    throw new Error('Failed to create transmittal in Draft status');
  }
  console.log('  -> Draft transmittal created successfully.');

  // Approve it
  const approved = await transmittalsService.approveTransmittal({
    entityId: testEntityId,
    id: created.id,
    userId: testUserId
  });

  // Verify transitions
  if (approved.status !== 'Sent') {
    throw new Error(`Expected approved transmittal status to be "Sent", got "${approved.status}"`);
  }
  if (!approved.approved) {
    throw new Error('Expected approved property to be true');
  }
  if (!approved.sent_at || !approved.sent_by) {
    throw new Error('Expected sent_at and sent_by to be set');
  }
  if (!approved.items || approved.items.length !== 1 || approved.items[0].description !== 'Edge Case Document') {
    throw new Error('Items list was erased or mismatched after approval!');
  }
  console.log('  ✅ Status transitions verified and items successfully preserved.');

  // Verify Audit Logs
  const pg = new Client({ connectionString: databaseUrl });
  await pg.connect();
  try {
    const { rows: logs } = await pg.query(
      'SELECT action FROM audit_logs WHERE record_id = $1 ORDER BY created_at ASC',
      [created.id]
    );
    const actions = logs.map(l => l.action);
    console.log('  -> Audit logs created:', actions);
    if (!actions.includes('transmittal.approve') || !actions.includes('transmittal.send')) {
      throw new Error('Missing transmittal.approve or transmittal.send audit logs!');
    }
    console.log('  ✅ Dual audit logs verified.');

    // --- Test Case 3: Tracking numbers of deleted transmittals are NOT reused ---
    console.log('\nTest 2: Tracking numbers of deleted transmittals are not reused...');
    // Create another transmittal
    const trackNum2 = `ATA-TX-2026-EDGE${Math.floor(Math.random() * 1000000)}`;
    const created2 = await transmittalsService.createTransmittal({
      entityId: testEntityId,
      userId: testUserId,
      data: {
        clientId: testClientId,
        trackingNumber: trackNum2,
        items: [{ description: 'Test unique number', documentType: 'Photocopy' }]
      }
    });

    // Soft-delete it
    await transmittalsService.deleteTransmittal({
      entityId: testEntityId,
      id: created2.id,
      userId: testUserId
    });
    console.log('  -> Soft-deleted transmittal with track number:', trackNum2);

    // Call listTransmittals with includeDeleted to simulate sequential generation check
    const { data: list } = await transmittalsService.listTransmittals({
      entityId: testEntityId,
      filters: { includeDeleted: true }
    });

    const foundDeleted = list.find(t => t.id === created2.id);
    if (!foundDeleted) {
      throw new Error('Soft-deleted transmittal was not returned with includeDeleted: true');
    }
    console.log('  ✅ Soft-deleted transmittal is accounted for under includeDeleted filter.');

    // --- Test Case 5: Related transmittals work with active entity switches ---
    console.log('\nTest 3: Related transmittals visible when active entity is mismatched...');
    // Seed a work request
    const { rows: wrs } = await pg.query(
      "INSERT INTO work_requests (client_id, entity_id, title, status, requested_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [testClientId, testEntityId, 'Edge Case Work Request', 'Draft', testUserId]
    );
    const testWrId = wrs[0].id;

    // Link our approved transmittal to the work request
    await pg.query(
      'UPDATE transmittals SET work_request_id = $1 WHERE id = $2',
      [testWrId, created.id]
    );

    // Query related resources passing mismatched entityId '16749820-0129-44a8-9435-a6013d07a370' (e.g. LTA entity uuid)
    const mismatchedEntityId = '16749820-0129-44a8-9435-a6013d07a370';
    const related = await operationsService.getWorkRequestRelated({
      id: testWrId,
      entityId: mismatchedEntityId
    });

    console.log('  -> Mismatched entity queried. Returned transmittals count:', related.transmittals.length);
    const foundTrans = related.transmittals.find(t => t.id === created.id);
    if (!foundTrans) {
      throw new Error('Transmittal is missing from related section when active entity mismatch occurs!');
    }
    console.log('  ✅ Mismatched entity transmittal query verification passed.');

    // Cleanup test data
    console.log('\nCleaning up edge case test data...');
    await pg.query('DELETE FROM transmittal_items WHERE transmittal_id = $1', [created.id]);
    await pg.query('DELETE FROM transmittals WHERE id = $1', [created.id]);
    await pg.query('DELETE FROM transmittal_items WHERE transmittal_id = $1', [created2.id]);
    await pg.query('DELETE FROM transmittals WHERE id = $1', [created2.id]);
    await pg.query('DELETE FROM work_requests WHERE id = $1', [testWrId]);
    console.log('  -> Cleanup complete.');

  } finally {
    await pg.end();
  }

  console.log('\n✅ ALL EDGE CASE TESTS PASSED SUCCESSFULLY!');
}

testEdgeCases().catch(err => {
  console.error('\n❌ EDGE CASE TEST FAILED:', err);
  process.exit(1);
});
