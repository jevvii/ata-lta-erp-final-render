-- Add funded columns to disbursements table
ALTER TABLE disbursements ADD COLUMN IF NOT EXISTS funded_by UUID;
ALTER TABLE disbursements ADD COLUMN IF NOT EXISTS funded_at TIMESTAMP WITH TIME ZONE;
