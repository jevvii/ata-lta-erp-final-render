-- Add linked_transmittal_id to invoices, disbursements, and disbursement_templates
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS linked_transmittal_id UUID REFERENCES transmittals(id) ON DELETE SET NULL;
ALTER TABLE disbursements ADD COLUMN IF NOT EXISTS linked_transmittal_id UUID REFERENCES transmittals(id) ON DELETE SET NULL;
ALTER TABLE disbursement_templates ADD COLUMN IF NOT EXISTS linked_transmittal_id UUID REFERENCES transmittals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_linked_transmittal_id ON invoices(linked_transmittal_id);
CREATE INDEX IF NOT EXISTS idx_disbursements_linked_transmittal_id ON disbursements(linked_transmittal_id);
CREATE INDEX IF NOT EXISTS idx_disbursement_templates_linked_transmittal_id ON disbursement_templates(linked_transmittal_id);
