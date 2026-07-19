-- Phase 7: Retainer templates

CREATE TABLE IF NOT EXISTS retainer_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  client_id UUID REFERENCES clients(id),
  schedule VARCHAR(50),
  pf_amount DECIMAL(15,2) DEFAULT 0,
  tasks JSONB DEFAULT '[]'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_retainer_templates_entity_id ON retainer_templates(entity_id);
