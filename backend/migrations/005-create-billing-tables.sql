-- Phase 5: Billing tables — invoices, line items, payments, templates

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number VARCHAR(50) NOT NULL,
  client_id UUID NOT NULL REFERENCES clients(id),
  work_request_id UUID REFERENCES work_requests(id),
  entity_id UUID NOT NULL REFERENCES entities(id),
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(50) DEFAULT 'Draft',
  subtotal DECIMAL(15,2) DEFAULT 0,
  tax_amount DECIMAL(15,2) DEFAULT 0,
  total DECIMAL(15,2) DEFAULT 0,
  amount_paid DECIMAL(15,2) DEFAULT 0,
  balance DECIMAL(15,2) DEFAULT 0,
  notes TEXT,
  terms TEXT,
  archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  UNIQUE(entity_id, invoice_number)
);

CREATE INDEX idx_invoices_entity_id ON invoices(entity_id);
CREATE INDEX idx_invoices_client_id ON invoices(client_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_due_date ON invoices(due_date);
CREATE INDEX idx_invoices_entity_status ON invoices(entity_id, status) WHERE deleted_at IS NULL;

-- Invoice line items
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description VARCHAR(500) NOT NULL,
  amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  type VARCHAR(50) DEFAULT 'Professional Fee',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invoice_line_items_invoice_id ON invoice_line_items(invoice_id);

-- Invoice payments
CREATE TABLE IF NOT EXISTS invoice_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount DECIMAL(15,2) NOT NULL,
  method VARCHAR(50),
  reference VARCHAR(100),
  payment_date DATE NOT NULL,
  recorded_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invoice_payments_invoice_id ON invoice_payments(invoice_id);

-- Billing templates
CREATE TABLE IF NOT EXISTS billing_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  entity_id UUID NOT NULL REFERENCES entities(id),
  client_id UUID REFERENCES clients(id),
  schedule VARCHAR(50),
  pf_amount DECIMAL(15,2) DEFAULT 0,
  line_items JSONB DEFAULT '[]'::jsonb,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_billing_templates_entity_id ON billing_templates(entity_id);
