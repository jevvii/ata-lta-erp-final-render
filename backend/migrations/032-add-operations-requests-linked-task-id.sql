ALTER TABLE operations_requests ADD COLUMN linked_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX idx_operations_requests_linked_task_id ON operations_requests(linked_task_id);
