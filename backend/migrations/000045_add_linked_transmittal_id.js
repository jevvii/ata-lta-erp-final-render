/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS linked_transmittal_id UUID REFERENCES transmittals(id) ON DELETE SET NULL;
    ALTER TABLE disbursements ADD COLUMN IF NOT EXISTS linked_transmittal_id UUID REFERENCES transmittals(id) ON DELETE SET NULL;
    ALTER TABLE disbursement_templates ADD COLUMN IF NOT EXISTS linked_transmittal_id UUID REFERENCES transmittals(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_invoices_linked_transmittal_id ON invoices(linked_transmittal_id);
    CREATE INDEX IF NOT EXISTS idx_disbursements_linked_transmittal_id ON disbursements(linked_transmittal_id);
    CREATE INDEX IF NOT EXISTS idx_disbursement_templates_linked_transmittal_id ON disbursement_templates(linked_transmittal_id);
  `);
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_disbursement_templates_linked_transmittal_id;
    DROP INDEX IF EXISTS idx_disbursements_linked_transmittal_id;
    DROP INDEX IF EXISTS idx_invoices_linked_transmittal_id;

    ALTER TABLE disbursement_templates DROP COLUMN IF EXISTS linked_transmittal_id;
    ALTER TABLE disbursements DROP COLUMN IF EXISTS linked_transmittal_id;
    ALTER TABLE invoices DROP COLUMN IF EXISTS linked_transmittal_id;
  `);
};
