/**
 * Repair the missing invoice address snapshot used by invoice_update_transactional.
 * NULL preserves the existing fallback to clients.address; no client data is changed.
 */
exports.up = (pgm) => {
  pgm.sql('ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS address text;');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE public.invoices DROP COLUMN IF EXISTS address;');
};
