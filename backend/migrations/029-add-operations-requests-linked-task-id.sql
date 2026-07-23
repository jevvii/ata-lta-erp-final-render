-- Add linked_task_id to operations_requests table
BEGIN;

ALTER TABLE operations_requests ADD COLUMN linked_task_id UUID REFERENCES tasks(id);
CREATE INDEX idx_operations_requests_linked_task_id ON operations_requests(linked_task_id);

COMMIT;
