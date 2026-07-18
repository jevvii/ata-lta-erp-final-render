-- Phase 6b: Transmittals tables

CREATE TABLE IF NOT EXISTS transmittals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_number VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL REFERENCES entities(id),
  client_id UUID NOT NULL REFERENCES clients(id),
  work_request_id UUID REFERENCES work_requests(id),
  status VARCHAR(50) DEFAULT 'Draft',
  notes TEXT,
  recipient_name VARCHAR(255),
  recipient_details TEXT,
  sent_at TIMESTAMPTZ,
  sent_by UUID,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID,
  archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  UNIQUE(entity_id, tracking_number)
);

CREATE INDEX idx_transmittals_entity_id ON transmittals(entity_id);
CREATE INDEX idx_transmittals_status ON transmittals(status);
CREATE INDEX idx_transmittals_client_id ON transmittals(client_id);
CREATE INDEX idx_transmittals_entity_status ON transmittals(entity_id, status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS transmittal_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transmittal_id UUID NOT NULL REFERENCES transmittals(id) ON DELETE CASCADE,
  description VARCHAR(255) NOT NULL,
  document_type VARCHAR(50),
  quantity INT DEFAULT 1,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transmittal_items_transmittal_id ON transmittal_items(transmittal_id);
