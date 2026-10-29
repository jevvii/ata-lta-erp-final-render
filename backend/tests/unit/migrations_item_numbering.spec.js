/**
 * Unit tests for Migration 000078: Persistent Unique Item Numbers & Safety Triggers
 */

const migration = require('../../migrations/000078_persistent_unique_item_numbers');

describe('Migration 000078: Persistent Unique Item Numbers', () => {
  it('exports up and down migration functions', () => {
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });

  describe('up migration', () => {
    let sqlCaptured = '';
    const pgm = {
      sql: (sql) => {
        sqlCaptured = sql;
      },
    };

    beforeAll(() => {
      migration.up(pgm);
    });

    it('creates dedicated sequences for audit_logs and users', () => {
      expect(sqlCaptured).toContain('CREATE SEQUENCE IF NOT EXISTS public.audit_logs_number_seq');
      expect(sqlCaptured).toContain('CREATE SEQUENCE IF NOT EXISTS public.users_number_seq');
    });

    it('updates public.next_document_sequence to be overflow-safe without truncation', () => {
      expect(sqlCaptured).toContain('CREATE OR REPLACE FUNCTION public.next_document_sequence');
      expect(sqlCaptured).toContain('CASE WHEN LENGTH(v_seq::text) < 4 THEN LPAD(v_seq::text, 4, \'0\') ELSE v_seq::text END');
    });

    it('adds persistent item number columns where missing', () => {
      expect(sqlCaptured).toContain('ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS audit_number VARCHAR(50)');
      expect(sqlCaptured).toContain('ALTER TABLE public.users ADD COLUMN IF NOT EXISTS user_number VARCHAR(30)');
      expect(sqlCaptured).toContain('ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS client_number VARCHAR(50)');
      expect(sqlCaptured).toContain('ALTER TABLE public.work_requests ADD COLUMN IF NOT EXISTS work_request_number VARCHAR(50)');
    });

    it('contains backfill queries with sequence sync for all tables', () => {
      expect(sqlCaptured).toContain('UPDATE public.audit_logs');
      expect(sqlCaptured).toContain('UPDATE public.users');
      expect(sqlCaptured).toContain('UPDATE public.clients');
      expect(sqlCaptured).toContain('UPDATE public.work_requests');
      expect(sqlCaptured).toContain('UPDATE public.invoices');
      expect(sqlCaptured).toContain('UPDATE public.disbursements');
      expect(sqlCaptured).toContain('UPDATE public.transmittals');
    });

    it('uses scalar substring aggregate queries for document_sequences sync to avoid set-returning errors', () => {
      expect(sqlCaptured).not.toContain('MAX(((regexp_matches(');
      expect(sqlCaptured).toContain('substring(invoice_number FROM');
      expect(sqlCaptured).toContain('substring(disbursement_number FROM');
      expect(sqlCaptured).toContain('substring(tracking_number FROM');
    });

    it('defines triggers for automatic default sequence number assignment', () => {
      expect(sqlCaptured).toContain('trg_audit_logs_assign_number');
      expect(sqlCaptured).toContain('trg_users_assign_number');
      expect(sqlCaptured).toContain('trg_clients_assign_number');
      expect(sqlCaptured).toContain('trg_work_requests_assign_number');
      expect(sqlCaptured).toContain('trg_invoices_assign_number');
      expect(sqlCaptured).toContain('trg_disbursements_assign_number');
      expect(sqlCaptured).toContain('trg_transmittals_assign_number');
    });

    it('enforces NOT NULL on all item number columns', () => {
      expect(sqlCaptured).toContain('ALTER TABLE public.audit_logs ALTER COLUMN audit_number SET NOT NULL');
      expect(sqlCaptured).toContain('ALTER TABLE public.users ALTER COLUMN user_number SET NOT NULL');
      expect(sqlCaptured).toContain('ALTER TABLE public.clients ALTER COLUMN client_number SET NOT NULL');
      expect(sqlCaptured).toContain('ALTER TABLE public.work_requests ALTER COLUMN work_request_number SET NOT NULL');
      expect(sqlCaptured).toContain('ALTER TABLE public.invoices ALTER COLUMN invoice_number SET NOT NULL');
      expect(sqlCaptured).toContain('ALTER TABLE public.disbursements ALTER COLUMN disbursement_number SET NOT NULL');
      expect(sqlCaptured).toContain('ALTER TABLE public.transmittals ALTER COLUMN tracking_number SET NOT NULL');
    });

    it('creates global unique indexes across all 6 tables', () => {
      expect(sqlCaptured).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_logs_audit_number_unique ON public.audit_logs (audit_number)');
      expect(sqlCaptured).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_number_unique ON public.users (user_number)');
      expect(sqlCaptured).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_client_number_unique ON public.clients (client_number)');
      expect(sqlCaptured).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_work_requests_work_request_number_unique ON public.work_requests (work_request_number)');
      expect(sqlCaptured).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_invoice_number_unique ON public.invoices (invoice_number)');
      expect(sqlCaptured).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_disbursements_disbursement_number_unique ON public.disbursements (disbursement_number)');
      expect(sqlCaptured).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_transmittals_tracking_number_unique ON public.transmittals (tracking_number)');
    });
  });

  describe('down migration', () => {
    let sqlCaptured = '';
    const pgm = {
      sql: (sql) => {
        sqlCaptured = sql;
      },
    };

    beforeAll(() => {
      migration.down(pgm);
    });

    it('drops all global unique indexes cleanly', () => {
      expect(sqlCaptured).toContain('DROP INDEX IF EXISTS public.idx_transmittals_tracking_number_unique');
      expect(sqlCaptured).toContain('DROP INDEX IF EXISTS public.idx_disbursements_disbursement_number_unique');
      expect(sqlCaptured).toContain('DROP INDEX IF EXISTS public.idx_invoices_invoice_number_unique');
      expect(sqlCaptured).toContain('DROP INDEX IF EXISTS public.idx_work_requests_work_request_number_unique');
      expect(sqlCaptured).toContain('DROP INDEX IF EXISTS public.idx_clients_client_number_unique');
      expect(sqlCaptured).toContain('DROP INDEX IF EXISTS public.idx_users_user_number_unique');
      expect(sqlCaptured).toContain('DROP INDEX IF EXISTS public.idx_audit_logs_audit_number_unique');
    });

    it('drops all triggers, functions, and sequences', () => {
      expect(sqlCaptured).toContain('DROP TRIGGER IF EXISTS trg_transmittals_assign_number');
      expect(sqlCaptured).toContain('DROP TRIGGER IF EXISTS trg_disbursements_assign_number');
      expect(sqlCaptured).toContain('DROP TRIGGER IF EXISTS trg_invoices_assign_number');
      expect(sqlCaptured).toContain('DROP TRIGGER IF EXISTS trg_work_requests_assign_number');
      expect(sqlCaptured).toContain('DROP TRIGGER IF EXISTS trg_clients_assign_number');
      expect(sqlCaptured).toContain('DROP TRIGGER IF EXISTS trg_users_assign_number');
      expect(sqlCaptured).toContain('DROP TRIGGER IF EXISTS trg_audit_logs_assign_number');
      expect(sqlCaptured).toContain('DROP SEQUENCE IF EXISTS public.users_number_seq');
      expect(sqlCaptured).toContain('DROP SEQUENCE IF EXISTS public.audit_logs_number_seq');
    });
  });
});
