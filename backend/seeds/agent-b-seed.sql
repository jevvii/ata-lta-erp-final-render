-- Seed data for modules (Phases 3, 5, 6, 6b, 7)
-- This seed is self-contained and idempotent; it creates placeholder dev users,
-- sample clients, work requests, and representative records for DMS, billing,
-- disbursements, and transmittals.

-- ============================================================
-- Helpers: entity UUIDs
-- ============================================================

DO $$
BEGIN
  -- Ensure placeholder dev users exist so foreign keys are satisfied.
  -- These users are NOT real Supabase Auth users; replace their auth_user_id
  -- values with real Supabase UUIDs before using them in production/UAT auth.
  INSERT INTO users (id, auth_user_id, email, name, role, entities, is_active)
  VALUES
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'dev-admin@ata-lta.ph', 'Dev Administrator', 'Admin', ARRAY['ATA','LTA'], true),
    ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'dev-accounting@ata-lta.ph', 'Dev Accounting', 'Accounting', ARRAY['ATA'], true),
    ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', 'dev-docs@ata-lta.ph', 'Dev Documentation', 'Documentation', ARRAY['ATA','LTA'], true)
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ============================================================
-- Sample clients
-- ============================================================

INSERT INTO clients (id, entity_id, name, tin, rdo_code, address, status, created_by, updated_by)
SELECT
  'c0000001-0000-0000-0000-000000000001',
  e.id,
  'Sample Client ATA',
  '123-456-789-00001',
  '001',
  'Makati City',
  'Active',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001'
FROM entities e WHERE e.code = 'ATA'
ON CONFLICT (id) DO NOTHING;

INSERT INTO clients (id, entity_id, name, tin, rdo_code, address, status, created_by, updated_by)
SELECT
  'c0000002-0000-0000-0000-000000000002',
  e.id,
  'Sample Client LTA',
  '123-456-789-00002',
  '002',
  'Taguig City',
  'Active',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001'
FROM entities e WHERE e.code = 'LTA'
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Sample work requests
-- ============================================================

INSERT INTO work_requests (id, entity_id, client_id, title, description, status, requested_by, assigned_to, due_date)
SELECT
  '00000001-0000-0000-0000-000000000001',
  e.id,
  c.id,
  'Annual Tax Filing 2025',
  'Prepare and file 2025 annual tax returns',
  'In Progress',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '2026-04-15'
FROM entities e, clients c
WHERE e.code = 'ATA' AND c.name = 'Sample Client ATA'
ON CONFLICT (id) DO NOTHING;

INSERT INTO work_requests (id, entity_id, client_id, title, description, status, requested_by, assigned_to, due_date)
SELECT
  '00000002-0000-0000-0000-000000000002',
  e.id,
  c.id,
  'Monthly Bookkeeping Q2 2026',
  'Monthly bookkeeping and financial statements',
  'Draft',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '2026-07-31'
FROM entities e, clients c
WHERE e.code = 'ATA' AND c.name = 'Sample Client ATA'
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Documents (Phase 3)
-- ============================================================

INSERT INTO documents (id, file_name, original_name, client_id, work_request_id, document_type, category, uploader_id, description, entity_id, document_lifecycle, status, file_size, content_type, storage_path, created_by)
SELECT
  '00000011-0000-0000-0000-000000000001',
  'contract-draft.pdf',
  'Contract Draft.pdf',
  c.id,
  wr.id,
  'Contract',
  'CONTRACT',
  '00000000-0000-0000-0000-000000000001',
  'Service agreement draft',
  e.id,
  'collected',
  'active',
  102400,
  'application/pdf',
  'entities/ATA/general/documents/d0000001/contract-draft.pdf',
  '00000000-0000-0000-0000-000000000001'
FROM entities e, clients c, work_requests wr
WHERE e.code = 'ATA' AND c.name = 'Sample Client ATA' AND wr.title = 'Annual Tax Filing 2025'
ON CONFLICT (id) DO NOTHING;

INSERT INTO documents (id, file_name, original_name, client_id, work_request_id, document_type, category, uploader_id, description, entity_id, document_lifecycle, status, file_size, content_type, storage_path, created_by)
SELECT
  '00000012-0000-0000-0000-000000000002',
  'bir-form.pdf',
  'BIR Form 2550Q.pdf',
  c.id,
  wr.id,
  'BIR Form',
  'BIR',
  '00000000-0000-0000-0000-000000000001',
  'Quarterly VAT return',
  e.id,
  'scanned',
  'active',
  51200,
  'application/pdf',
  'entities/ATA/general/documents/d0000002/bir-form.pdf',
  '00000000-0000-0000-0000-000000000001'
FROM entities e, clients c, work_requests wr
WHERE e.code = 'ATA' AND c.name = 'Sample Client ATA' AND wr.title = 'Annual Tax Filing 2025'
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Invoices (Phase 5)
-- ============================================================

INSERT INTO invoices (id, invoice_number, client_id, work_request_id, entity_id, issue_date, due_date, status, subtotal, tax_amount, total, amount_paid, balance, notes, created_by)
SELECT
  '00000021-0000-0000-0000-000000000001',
  'INV-ATA-2026-001',
  c.id,
  wr.id,
  e.id,
  '2026-07-01',
  '2026-08-01',
  'Sent',
  15000.00,
  0.00,
  15000.00,
  0.00,
  15000.00,
  'Monthly retainer for July 2026',
  '00000000-0000-0000-0000-000000000001'
FROM entities e, clients c, work_requests wr
WHERE e.code = 'ATA' AND c.name = 'Sample Client ATA' AND wr.title = 'Annual Tax Filing 2025'
ON CONFLICT (id) DO NOTHING;

INSERT INTO invoices (id, invoice_number, client_id, work_request_id, entity_id, issue_date, due_date, status, subtotal, tax_amount, total, amount_paid, balance, notes, created_by)
SELECT
  '00000022-0000-0000-0000-000000000002',
  'INV-ATA-2026-002',
  c.id,
  wr.id,
  e.id,
  '2026-06-01',
  '2026-07-01',
  'Partially Paid',
  20000.00,
  0.00,
  20000.00,
  10000.00,
  10000.00,
  'June services',
  '00000000-0000-0000-0000-000000000001'
FROM entities e, clients c, work_requests wr
WHERE e.code = 'ATA' AND c.name = 'Sample Client ATA' AND wr.title = 'Annual Tax Filing 2025'
ON CONFLICT (id) DO NOTHING;

INSERT INTO invoice_line_items (invoice_id, description, amount, type, sort_order) VALUES
  ('00000021-0000-0000-0000-000000000001', 'Professional Fee - July 2026', 12000.00, 'Professional Fee', 0),
  ('00000021-0000-0000-0000-000000000001', 'SEC Annual Filing Fee', 3000.00, 'Government Fee', 1),
  ('00000022-0000-0000-0000-000000000002', 'Professional Fee - June 2026', 15000.00, 'Professional Fee', 0),
  ('00000022-0000-0000-0000-000000000002', 'BIR Filing Fee', 5000.00, 'Government Fee', 1)
ON CONFLICT DO NOTHING;

INSERT INTO invoice_payments (invoice_id, amount, method, reference, payment_date, recorded_by) VALUES
  ('00000022-0000-0000-0000-000000000002', 10000.00, 'Bank Transfer', 'REF-20260615', '2026-06-15', '00000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- ============================================================
-- Disbursements (Phase 6)
-- ============================================================

INSERT INTO disbursements (id, disbursement_number, entity_id, category, description, amount, fund_source, status, requested_by, created_by)
SELECT
  '00000031-0000-0000-0000-000000000001',
  'DISB-ATA-20260701-0001',
  e.id,
  'Government Fee',
  'SEC Annual Registration Fee',
  5000.00,
  'Client Fund',
  'Approved',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001'
FROM entities e WHERE e.code = 'ATA'
ON CONFLICT (id) DO NOTHING;

INSERT INTO disbursements (id, disbursement_number, entity_id, category, description, amount, fund_source, status, requested_by, created_by)
SELECT
  '00000032-0000-0000-0000-000000000002',
  'DISB-ATA-20260701-0002',
  e.id,
  'Transportation',
  'Client visit - Makati',
  500.00,
  'Firm Fund',
  'Draft',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001'
FROM entities e WHERE e.code = 'ATA'
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Transmittals (Phase 6b)
-- ============================================================

INSERT INTO transmittals (id, tracking_number, entity_id, client_id, status, recipient_name, notes, created_by)
SELECT
  '00000041-0000-0000-0000-000000000001',
  'TR-ATA-2026-001',
  e.id,
  c.id,
  'Sent',
  'Juan Dela Cruz',
  'Annual SEC documents transmittal',
  '00000000-0000-0000-0000-000000000001'
FROM entities e, clients c
WHERE e.code = 'ATA' AND c.name = 'Sample Client ATA'
ON CONFLICT (id) DO NOTHING;

INSERT INTO transmittal_items (transmittal_id, description, document_type, quantity, sort_order) VALUES
  ('00000041-0000-0000-0000-000000000001', 'GIS 2025', 'SEC', 1, 0),
  ('00000041-0000-0000-0000-000000000001', 'Audited FS 2025', 'SEC', 2, 1),
  ('00000041-0000-0000-0000-000000000001', 'BIR Form 2550Q Q4 2025', 'BIR', 1, 2)
ON CONFLICT DO NOTHING;
