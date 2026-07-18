-- Phase 3: Documents / DMS table
-- Metadata only — file bytes live in S3.

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  work_request_id UUID REFERENCES work_requests(id),
  client_id UUID REFERENCES clients(id),
  document_type VARCHAR(100),
  category VARCHAR(50),
  uploader_id UUID NOT NULL,
  upload_date TIMESTAMPTZ DEFAULT NOW(),
  description TEXT,
  handover_log JSONB DEFAULT '[]'::jsonb,
  entity_id UUID NOT NULL REFERENCES entities(id),
  document_lifecycle VARCHAR(50) DEFAULT 'collected',
  scanned_by VARCHAR(255),
  envelope_id VARCHAR(100),
  stored_location VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending_upload',
  archived BOOLEAN DEFAULT FALSE,
  file_size BIGINT,
  content_type VARCHAR(100),
  s3_key VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_documents_entity_id ON documents(entity_id);
CREATE INDEX idx_documents_client_id ON documents(client_id);
CREATE INDEX idx_documents_work_request_id ON documents(work_request_id);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_category ON documents(category);
CREATE INDEX idx_documents_lifecycle ON documents(document_lifecycle);
CREATE INDEX idx_documents_deleted_at ON documents(deleted_at);
CREATE INDEX idx_documents_entity_status ON documents(entity_id, status) WHERE deleted_at IS NULL;
