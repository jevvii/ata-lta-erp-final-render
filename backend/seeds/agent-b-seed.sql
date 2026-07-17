-- Seed data for Agent B modules (Phase 3, 5, 6, 7)
-- Depends on clients and work_requests being seeded first (Agent A)

-- ============================================================
-- Documents (Phase 3)
-- ============================================================

INSERT INTO documents (id, file_name, original_name, client_id, document_type, category, uploader_id, description, entity_id, document_lifecycle, status, file_size, content_type, s3_key, created_by) VALUES
  ('d0000001-0000-0000-0000-000000000001', 'contract-draft.pdf', 'Contract Draft.pdf', (SELECT id FROM clients WHERE name ILIKE '%sample%' LIMIT 1), 'Contract', 'CONTRACT', '00000000-0000-0000-0000-000000000001', 'Service agreement draft', 'ATA', 'collected', 'active', 102400, 'application/pdf', 'entities/ATA/general/documents/d0000001/contract-draft.pdf', '00000000-0000-0000-0000-000000000001'),
  ('d0000002-0000-0000-0000-000000000002', 'bir-form.pdf', 'BIR Form 2550Q.pdf', (SELECT id FROM clients WHERE name ILIKE '%sample%' LIMIT 1), 'BIR Form', 'BIR', '00000000-0000-0000-0000-000000000001', 'Quarterly VAT return', 'ATA', 'scanned', 'active', 51200, 'application/pdf', 'entities/ATA/general/documents/d0000002/bir-form.pdf', '00000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- ============================================================
-- Invoices (Phase 5)
-- ============================================================

INSERT INTO invoices (id, invoice_number, client_id, entity_id, issue_date, due_date, status, subtotal, total, amount_paid, balance, notes, created_by) VALUES
  ('i0000001-0000-0000-0000-000000000001', 'INV-ATA-2026-001', (SELECT id FROM clients WHERE name ILIKE '%sample%' LIMIT 1), 'ATA', '2026-07-01', '2026-08-01', 'Sent', 15000.00, 15000.00, 0.00, 15000.00, 'Monthly retainer for July 2026', '00000000-0000-0000-0000-000000000001'),
  ('i0000002-0000-0000-0000-000000000002', 'INV-ATA-2026-002', (SELECT id FROM clients WHERE name ILIKE '%sample%' LIMIT 1), 'ATA', '2026-06-01', '2026-07-01', 'Partially Paid', 20000.00, 20000.00, 10000.00, 10000.00, 'June services', '00000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

INSERT INTO invoice_line_items (invoice_id, description, amount, type, sort_order) VALUES
  ('i0000001-0000-0000-0000-000000000001', 'Professional Fee - July 2026', 12000.00, 'Professional Fee', 0),
  ('i0000001-0000-0000-0000-000000000001', 'SEC Annual Filing Fee', 3000.00, 'Government Fee', 1),
  ('i0000002-0000-0000-0000-000000000002', 'Professional Fee - June 2026', 15000.00, 'Professional Fee', 0),
  ('i0000002-0000-0000-0000-000000000002', 'BIR Filing Fee', 5000.00, 'Government Fee', 1)
ON CONFLICT DO NOTHING;

INSERT INTO invoice_payments (invoice_id, amount, method, reference, payment_date, recorded_by) VALUES
  ('i0000002-0000-0000-0000-000000000002', 10000.00, 'Bank Transfer', 'REF-20260615', '2026-06-15', '00000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- ============================================================
-- Disbursements (Phase 6)
-- ============================================================

INSERT INTO disbursements (id, disbursement_number, entity_id, category, description, amount, fund_source, status, requested_by, created_by) VALUES
  ('db000001-0000-0000-0000-000000000001', 'DISB-ATA-20260701-0001', 'ATA', 'Government Fee', 'SEC Annual Registration Fee', 5000.00, 'Client Fund', 'Approved', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
  ('db000002-0000-0000-0000-000000000002', 'DISB-ATA-20260701-0002', 'ATA', 'Transportation', 'Client visit - Makati', 500.00, 'Firm Fund', 'Draft', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- ============================================================
-- Transmittals (Phase 6b)
-- ============================================================

INSERT INTO transmittals (id, tracking_number, entity_id, client_id, status, recipient_name, notes, created_by) VALUES
  ('tr000001-0000-0000-0000-000000000001', 'TR-ATA-2026-001', 'ATA', (SELECT id FROM clients WHERE name ILIKE '%sample%' LIMIT 1), 'Sent', 'Juan Dela Cruz', 'Annual SEC documents transmittal', '00000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

INSERT INTO transmittal_items (transmittal_id, description, document_type, quantity, sort_order) VALUES
  ('tr000001-0000-0000-0000-000000000001', 'GIS 2025', 'SEC', 1, 0),
  ('tr000001-0000-0000-0000-000000000001', 'Audited FS 2025', 'SEC', 2, 1),
  ('tr000001-0000-0000-0000-000000000001', 'BIR Form 2550Q Q4 2025', 'BIR', 1, 2)
ON CONFLICT DO NOTHING;
