-- Add receipt columns to disbursements table
ALTER TABLE disbursements ADD COLUMN IF NOT EXISTS receipt_s3_key VARCHAR(500);
ALTER TABLE disbursements ADD COLUMN IF NOT EXISTS receipt_filename VARCHAR(255);
