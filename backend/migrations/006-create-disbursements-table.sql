-- Phase 6: Disbursements table

CREATE TABLE IF NOT EXISTS disbursements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disbursement_number VARCHAR(50),
  entity_id UUID NOT NULL REFERENCES entities(id),
  category VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  fund_source VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT 'Draft',
  linked_invoice_id UUID REFERENCES invoices(id),
  linked_work_request_id UUID REFERENCES work_requests(id),
  client_id UUID REFERENCES clients(id),
  employee_id UUID,
  requested_by UUID,
  due_date DATE,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  released_by UUID,
  released_at TIMESTAMPTZ,
  rejected_by UUID,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  payment_method VARCHAR(50),
  payment_reference VARCHAR(100),
  payment_bank VARCHAR(100),
  payment_date DATE,
  payment_processed_by UUID,
  receipt_s3_key VARCHAR(500),
  archived BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_disbursements_entity_id ON disbursements(entity_id);
CREATE INDEX idx_disbursements_status ON disbursements(status);
CREATE INDEX idx_disbursements_category ON disbursements(category);
CREATE INDEX idx_disbursements_fund_source ON disbursements(fund_source);
CREATE INDEX idx_disbursements_client_id ON disbursements(client_id);
CREATE INDEX idx_disbursements_entity_status ON disbursements(entity_id, status) WHERE deleted_at IS NULL;
