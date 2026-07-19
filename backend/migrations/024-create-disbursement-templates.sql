-- Phase 7: Disbursement templates

CREATE TABLE IF NOT EXISTS disbursement_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  fund_source VARCHAR(50),
  schedule VARCHAR(50),
  description TEXT,
  linked_work_request_id UUID REFERENCES work_requests(id),
  linked_invoice_id UUID REFERENCES invoices(id),
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_disbursement_templates_entity_id ON disbursement_templates(entity_id);
