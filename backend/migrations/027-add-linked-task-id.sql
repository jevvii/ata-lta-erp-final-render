ALTER TABLE invoices ADD COLUMN linked_task_id UUID REFERENCES tasks(id);
ALTER TABLE disbursements ADD COLUMN linked_task_id UUID REFERENCES tasks(id);
ALTER TABLE documents ADD COLUMN linked_task_id UUID REFERENCES tasks(id);
CREATE INDEX idx_invoices_linked_task_id ON invoices(linked_task_id);
CREATE INDEX idx_disbursements_linked_task_id ON disbursements(linked_task_id);
CREATE INDEX idx_documents_linked_task_id ON documents(linked_task_id);
