-- Add receipt_filename column to disbursements table
ALTER TABLE disbursements ADD COLUMN IF NOT EXISTS receipt_filename VARCHAR(255);
