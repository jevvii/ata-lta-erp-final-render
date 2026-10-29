/** Persist editable voucher snapshots without changing approval/release identities. */
exports.up = (pgm) => {
  pgm.sql(
    "ALTER TABLE public.disbursements ADD COLUMN print_details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(print_details) = 'object');"
  );
};
exports.down = (pgm) => {
  pgm.sql('ALTER TABLE public.disbursements DROP COLUMN print_details;');
};
