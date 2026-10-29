/**
 * Provision a dedicated pristine Work Request for testing
 * Billing <-> Transmittal <-> Disbursement linking workflows.
 */
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
require('dotenv').config({ path: '.env.staging' });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const ENTITY_ATA_ID = 'e83dc90b-d9b5-4854-8adf-7fe21c2e6822';
const CLIENT_ACME_ID = '5bd5e8b6-2ef2-4bb5-ac2b-6a6b7f36676b';
const LOVELYN_ID = '150f36d2-9755-48e5-85ec-44f65a1b16e1';
const ADMIN_ID = 'f4cf86ef-cca0-491e-827b-fcd9f0dd91ce';

const REA_ID = '220b7b26-b3ec-43dc-96d8-b12dd1c34411';
const LOIDA_ID = '455f521b-e301-4b98-9b01-870b67adbd49';
const TWINKLE_ID = '90d26ea3-633b-459f-b879-32499ca6e517';
const RACHEL_ID = '40684d1f-f39d-4e60-9716-d5864dc80960';
const JEN_ID = 'cdfd0b2a-8628-4e23-a0a5-85e79fab3880';

async function main() {
  const wrId = crypto.randomUUID();
  const task1Id = crypto.randomUUID();
  const task2Id = crypto.randomUUID();
  const task3Id = crypto.randomUUID();
  const task4Id = crypto.randomUUID();
  const task5Id = crypto.randomUUID();
  const task6Id = crypto.randomUUID();
  const task7Id = crypto.randomUUID();

  const now = new Date().toISOString();

  console.log(`Creating Dedicated Linking Test Work Request: ${wrId}...`);

  const wrPayload = {
    id: wrId,
    entity_id: ENTITY_ATA_ID,
    client_id: CLIENT_ACME_ID,
    title: 'E2E Dedicated Linking Test — Billing, Transmittal & Disbursement (2026)',
    description: 'Pristine dedicated Work Request for validating cross-domain linking across Invoices, Transmittals, and Disbursements with full OCC concurrency, Realtime CDC, Left Action Rail, and SOP 2.5 gates.',
    status: 'Draft',
    requested_by: ADMIN_ID,
    assigned_to: LOVELYN_ID,
    due_date: '2026-12-15T00:00:00.000Z',
    priority: 'High',
    archived: false,
    version: 1,
    co_assignees: [REA_ID, LOIDA_ID, TWINKLE_ID, RACHEL_ID, JEN_ID],
    phase: 'pre_processing',
    phase_entered_at: now,
    on_hold: false,
    creation_approval_status: 'approved',
    created_by: ADMIN_ID,
    reviewed_by: ADMIN_ID,
    reviewed_at: now,
    work_request_number: 'WR-ATA-2026-0004',
    created_at: now,
    updated_at: now,
  };

  const { error: wrErr } = await sb.from('work_requests').insert(wrPayload);
  if (wrErr) {
    console.error('Failed to create WR:', wrErr);
    process.exit(1);
  }
  console.log('Work Request created successfully: WR-ATA-2026-0004');

  const tasksPayload = [
    {
      id: task1Id,
      work_request_id: wrId,
      title: 'Client Intake & Statutory Document Verification',
      description: 'Upload client corporate documents and verify SEC, BIR, and Mayor’s permit requirements.',
      status: 'Assigned',
      assignee_id: REA_ID,
      assignee_name: 'Alejandria Solano',
      predecessors: [],
      due_date: '2026-11-15T00:00:00.000Z',
      display_order: 0,
      version: 1,
      required_link_type: null,
      phase: 'pre_processing',
      qa_status: 'none',
      assigned_by: ADMIN_ID,
      assigned_at: now,
      approval_status: 'approved',
      created_by: ADMIN_ID,
      reviewed_by: ADMIN_ID,
      reviewed_at: now,
      created_at: now,
      updated_at: now,
    },
    {
      id: task2Id,
      work_request_id: wrId,
      title: 'SEC & LGU Pre-Processing Filing Fees Disbursement',
      description: 'Mobilization disbursement voucher for initial registration filing and verification fees.',
      status: 'Assigned',
      assignee_id: LOIDA_ID,
      assignee_name: 'Loida Delgaco',
      predecessors: [],
      due_date: '2026-11-18T00:00:00.000Z',
      display_order: 1,
      version: 1,
      required_link_type: 'disbursement',
      phase: 'pre_processing',
      qa_status: 'none',
      assigned_by: ADMIN_ID,
      assigned_at: now,
      approval_status: 'approved',
      created_by: ADMIN_ID,
      reviewed_by: ADMIN_ID,
      reviewed_at: now,
      created_at: now,
      updated_at: now,
    },
    {
      id: task3Id,
      work_request_id: wrId,
      title: 'Original Corporate Records Pickup Transmittal',
      description: 'Official transmittal acknowledging receipt of client physical corporate books and dry seal.',
      status: 'Assigned',
      assignee_id: TWINKLE_ID,
      assignee_name: 'Twinkle Marquez',
      predecessors: [task1Id],
      due_date: '2026-11-20T00:00:00.000Z',
      display_order: 2,
      version: 1,
      required_link_type: 'transmittal',
      phase: 'pre_processing',
      qa_status: 'none',
      assigned_by: ADMIN_ID,
      assigned_at: now,
      approval_status: 'approved',
      created_by: ADMIN_ID,
      reviewed_by: ADMIN_ID,
      reviewed_at: now,
      created_at: now,
      updated_at: now,
    },
    {
      id: task4Id,
      work_request_id: wrId,
      title: 'Mobilization Retainer & Pre-Processing Billing',
      description: 'Initial engagement retainer and mobilization invoice for pre-processing phase with unbilled disbursements.',
      status: 'Assigned',
      assignee_id: RACHEL_ID,
      assignee_name: 'Rachel Baradas',
      predecessors: [task3Id],
      due_date: '2026-11-22T00:00:00.000Z',
      display_order: 3,
      version: 1,
      required_link_type: 'billing',
      phase: 'pre_processing',
      qa_status: 'none',
      assigned_by: ADMIN_ID,
      assigned_at: now,
      approval_status: 'approved',
      created_by: ADMIN_ID,
      reviewed_by: ADMIN_ID,
      reviewed_at: now,
      created_at: now,
      updated_at: now,
    },
    {
      id: task5Id,
      work_request_id: wrId,
      title: 'BIR Registration & Books of Accounts Stamping',
      description: 'Execution of statutory tax registration and manual books stamping at RDO.',
      status: 'Assigned',
      assignee_id: REA_ID,
      assignee_name: 'Alejandria Solano',
      predecessors: [],
      due_date: '2026-11-28T00:00:00.000Z',
      display_order: 4,
      version: 1,
      required_link_type: null,
      phase: 'processing',
      qa_status: 'none',
      assigned_by: ADMIN_ID,
      assigned_at: now,
      approval_status: 'approved',
      created_by: ADMIN_ID,
      reviewed_by: ADMIN_ID,
      reviewed_at: now,
      created_at: now,
      updated_at: now,
    },
    {
      id: task6Id,
      work_request_id: wrId,
      title: 'Documentary Stamp Tax & Statutory Fees Disbursement',
      description: 'Disbursement for payment of BIR documentary stamp tax and annual registration fees.',
      status: 'Assigned',
      assignee_id: LOIDA_ID,
      assignee_name: 'Loida Delgaco',
      predecessors: [task5Id],
      due_date: '2026-11-30T00:00:00.000Z',
      display_order: 5,
      version: 1,
      required_link_type: 'disbursement',
      phase: 'processing',
      qa_status: 'none',
      assigned_by: ADMIN_ID,
      assigned_at: now,
      approval_status: 'approved',
      created_by: ADMIN_ID,
      reviewed_by: ADMIN_ID,
      reviewed_at: now,
      created_at: now,
      updated_at: now,
    },
    {
      id: task7Id,
      work_request_id: wrId,
      title: 'Processing Milestone & Statutory Filing Billing',
      description: 'Milestone invoice for completion of BIR statutory registration and tax compliance filings.',
      status: 'Assigned',
      assignee_id: JEN_ID,
      assignee_name: 'Jen Andonga',
      predecessors: [task5Id],
      due_date: '2026-12-05T00:00:00.000Z',
      display_order: 6,
      version: 1,
      required_link_type: 'billing',
      phase: 'processing',
      qa_status: 'none',
      assigned_by: ADMIN_ID,
      assigned_at: now,
      approval_status: 'approved',
      created_by: ADMIN_ID,
      reviewed_by: ADMIN_ID,
      reviewed_at: now,
      created_at: now,
      updated_at: now,
    },
  ];

  const { error: tasksErr } = await sb.from('tasks').insert(tasksPayload);
  if (tasksErr) {
    console.error('Failed to create Tasks:', tasksErr);
    process.exit(1);
  }
  console.log('Created 7 tasks successfully.');

  const checklistPayload = [
    {
      id: crypto.randomUUID(),
      task_id: task1Id,
      text: 'SEC Certificate of Registration (2026)',
      category: 'document',
      completed: false,
      period_year: '2026',
      created_at: now,
      depends_on: [],
    },
    {
      id: crypto.randomUUID(),
      task_id: task1Id,
      text: 'Articles of Incorporation & By-Laws (2026)',
      category: 'document',
      completed: false,
      period_year: '2026',
      created_at: now,
      depends_on: [],
    },
    {
      id: crypto.randomUUID(),
      task_id: task1Id,
      text: "Mayor's Business Permit & Tax Order of Payment",
      category: 'document',
      completed: false,
      period_year: '2026',
      created_at: now,
      depends_on: [],
    },
    {
      id: crypto.randomUUID(),
      task_id: task1Id,
      text: 'Verify corporate TIN and registered address in SEC records',
      category: 'subtask',
      completed: false,
      created_at: now,
      depends_on: [],
    },
    {
      id: crypto.randomUUID(),
      task_id: task1Id,
      text: 'Perform client KYC and beneficial ownership verification',
      category: 'subtask',
      completed: false,
      created_at: now,
      depends_on: [],
    },
  ];

  const { error: clErr } = await sb.from('task_checklists').insert(checklistPayload);
  if (clErr) {
    console.error('Failed to create Task 1 checklist items:', clErr);
  } else {
    console.log('Created 5 checklist items for Task 1.');
  }

  console.log('\n--- PROVISIONING SUMMARY ---');
  console.log(`WR ID:    ${wrId}`);
  console.log(`WR No:    WR-ATA-2026-0004`);
  console.log(`Task 1:   ${task1Id} (Client Intake)`);
  console.log(`Task 2:   ${task2Id} (Disbursement)`);
  console.log(`Task 3:   ${task3Id} (Transmittal)`);
  console.log(`Task 4:   ${task4Id} (Billing)`);
  console.log(`Task 5:   ${task5Id} (BIR Books)`);
  console.log(`Task 6:   ${task6Id} (Disbursement Processing)`);
  console.log(`Task 7:   ${task7Id} (Billing Processing)`);
}

main().catch(console.error);
