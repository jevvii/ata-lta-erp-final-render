/**
 * Migration 000078: Persistent Unique Item Numbers & Safety Triggers
 *
 * Enforces persistent, monotonically increasing human-readable identifiers
 * across all operational and administrative entities:
 * 1. audit_logs: audit_number (AUR-0001...) with sequence, trigger, NOT NULL, unique index
 * 2. users: user_number (USR-01...) with sequence, trigger, NOT NULL, unique index
 * 3. next_document_sequence(): overflow-safe formatting so sequences >= 10000 are not truncated by LPAD
 * 4. clients: client_number (CLI-{ENTITY}-{NNNN}) with sequence sync, trigger, NOT NULL, unique index
 * 5. work_requests: work_request_number (WR-{ENTITY}-{YYYY}-{NNNN}) with sequence sync, trigger, NOT NULL, unique index
 * 6. invoices, disbursements, transmittals: global unique indexes, NOT NULL, fallback auto-numbering triggers
 *
 * @type {import('node-pg-migrate').Migration}
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- ─── 1. AUDIT LOGS (AUR-0001...) ──────────────────────────────────────────
    DO $$
    BEGIN
      ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS audit_number VARCHAR(50);
    END $$;

    CREATE SEQUENCE IF NOT EXISTS public.audit_logs_number_seq AS bigint START WITH 1 INCREMENT BY 1;

    DO $$
    DECLARE
      v_max bigint := 0;
    BEGIN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(audit_number, '^AUR-0*', ''), '')::bigint), 0)
      INTO v_max
      FROM public.audit_logs
      WHERE audit_number ~ '^AUR-\\d+$';

      WITH to_update AS (
        SELECT id,
               v_max + ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
        FROM public.audit_logs
        WHERE audit_number IS NULL OR BTRIM(audit_number) = ''
      )
      UPDATE public.audit_logs a
      SET audit_number = 'AUR-' || CASE WHEN LENGTH(u.rn::text) < 4 THEN LPAD(u.rn::text, 4, '0') ELSE u.rn::text END
      FROM to_update u
      WHERE a.id = u.id;

      SELECT COALESCE(MAX(NULLIF(regexp_replace(audit_number, '^AUR-0*', ''), '')::bigint), 0)
      INTO v_max
      FROM public.audit_logs
      WHERE audit_number ~ '^AUR-\\d+$';

      PERFORM setval('public.audit_logs_number_seq', GREATEST(v_max, 1), v_max > 0);
    END $$;

    CREATE OR REPLACE FUNCTION public.assign_audit_log_number()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_seq bigint;
    BEGIN
      IF NEW.audit_number IS NULL OR BTRIM(NEW.audit_number) = '' THEN
        v_seq := nextval('public.audit_logs_number_seq');
        NEW.audit_number := 'AUR-' || CASE WHEN LENGTH(v_seq::text) < 4 THEN LPAD(v_seq::text, 4, '0') ELSE v_seq::text END;
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_audit_logs_assign_number ON public.audit_logs;
    CREATE TRIGGER trg_audit_logs_assign_number
    BEFORE INSERT ON public.audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.assign_audit_log_number();

    ALTER TABLE public.audit_logs ALTER COLUMN audit_number SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_logs_audit_number_unique ON public.audit_logs (audit_number);


    -- ─── 2. USERS (USR-01...) ─────────────────────────────────────────────────
    DO $$
    BEGIN
      ALTER TABLE public.users ADD COLUMN IF NOT EXISTS user_number VARCHAR(30);
    END $$;

    CREATE SEQUENCE IF NOT EXISTS public.users_number_seq AS bigint START WITH 1 INCREMENT BY 1;

    DO $$
    DECLARE
      v_max bigint := 0;
    BEGIN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(user_number, '^USR-0*', ''), '')::bigint), 0)
      INTO v_max
      FROM public.users
      WHERE user_number ~ '^USR-\\d+$';

      WITH to_update AS (
        SELECT id,
               v_max + ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
        FROM public.users
        WHERE user_number IS NULL OR BTRIM(user_number) = ''
      )
      UPDATE public.users u_table
      SET user_number = 'USR-' || CASE WHEN LENGTH(u.rn::text) < 2 THEN LPAD(u.rn::text, 2, '0') ELSE u.rn::text END
      FROM to_update u
      WHERE u_table.id = u.id;

      SELECT COALESCE(MAX(NULLIF(regexp_replace(user_number, '^USR-0*', ''), '')::bigint), 0)
      INTO v_max
      FROM public.users
      WHERE user_number ~ '^USR-\\d+$';

      PERFORM setval('public.users_number_seq', GREATEST(v_max, 1), v_max > 0);
    END $$;

    CREATE OR REPLACE FUNCTION public.assign_user_number()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_seq bigint;
    BEGIN
      IF NEW.user_number IS NULL OR BTRIM(NEW.user_number) = '' THEN
        v_seq := nextval('public.users_number_seq');
        NEW.user_number := 'USR-' || CASE WHEN LENGTH(v_seq::text) < 2 THEN LPAD(v_seq::text, 2, '0') ELSE v_seq::text END;
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_users_assign_number ON public.users;
    CREATE TRIGGER trg_users_assign_number
    BEFORE INSERT ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.assign_user_number();

    ALTER TABLE public.users ALTER COLUMN user_number SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_number_unique ON public.users (user_number);


    -- ─── 3. OVERFLOW-SAFE NEXT_DOCUMENT_SEQUENCE ───────────────────────────────
    CREATE OR REPLACE FUNCTION public.next_document_sequence(p_prefix text)
    RETURNS text
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_seq integer;
    BEGIN
      INSERT INTO document_sequences (prefix, current_val, updated_at)
      VALUES (p_prefix, 1, now())
      ON CONFLICT (prefix)
      DO UPDATE SET current_val = document_sequences.current_val + 1, updated_at = now()
      RETURNING current_val INTO v_seq;

      RETURN p_prefix || '-' || CASE WHEN LENGTH(v_seq::text) < 4 THEN LPAD(v_seq::text, 4, '0') ELSE v_seq::text END;
    END;
    $$;


    -- ─── 4. CLIENTS (CLI-{ENTITY}-{NNNN}) ──────────────────────────────────────
    DO $$
    BEGIN
      ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS client_number VARCHAR(50);
    END $$;

    DO $$
    DECLARE
      r RECORD;
      v_code text;
      v_max int;
    BEGIN
      FOR r IN SELECT DISTINCT c.entity_id, COALESCE(e.code, 'ATA') AS code
               FROM public.clients c
               LEFT JOIN public.entities e ON e.id = c.entity_id
      LOOP
        v_code := r.code;
        SELECT COALESCE(MAX(NULLIF(regexp_replace(client_number, '^CLI-' || v_code || '-0*', ''), '')::integer), 0)
        INTO v_max
        FROM public.clients
        WHERE client_number ~ ('^CLI-' || v_code || '-\\d+$');

        WITH to_update AS (
          SELECT c.id,
                 v_max + ROW_NUMBER() OVER (ORDER BY c.created_at ASC, c.id ASC) AS rn
          FROM public.clients c
          WHERE (c.client_number IS NULL OR BTRIM(c.client_number) = '')
            AND (c.entity_id = r.entity_id OR (c.entity_id IS NULL AND r.entity_id IS NULL))
        )
        UPDATE public.clients cli
        SET client_number = 'CLI-' || v_code || '-' || CASE WHEN LENGTH(u.rn::text) < 4 THEN LPAD(u.rn::text, 4, '0') ELSE u.rn::text END
        FROM to_update u
        WHERE cli.id = u.id;

        SELECT COALESCE(MAX(NULLIF(regexp_replace(client_number, '^CLI-' || v_code || '-0*', ''), '')::integer), 0)
        INTO v_max
        FROM public.clients
        WHERE client_number ~ ('^CLI-' || v_code || '-\\d+$');

        IF v_max > 0 THEN
          INSERT INTO public.document_sequences (prefix, current_val, updated_at)
          VALUES ('CLI-' || v_code, v_max, now())
          ON CONFLICT (prefix)
          DO UPDATE SET current_val = GREATEST(public.document_sequences.current_val, EXCLUDED.current_val),
                        updated_at = now();
        END IF;
      END LOOP;
    END $$;

    CREATE OR REPLACE FUNCTION public.assign_client_number()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_code text := 'ATA';
    BEGIN
      IF NEW.client_number IS NULL OR BTRIM(NEW.client_number) = '' THEN
        IF NEW.entity_id IS NOT NULL THEN
          SELECT COALESCE(code, 'ATA') INTO v_code
          FROM public.entities
          WHERE id = NEW.entity_id;
          IF v_code IS NULL THEN
            v_code := 'ATA';
          END IF;
        END IF;
        NEW.client_number := public.next_document_sequence('CLI-' || v_code);
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_clients_assign_number ON public.clients;
    CREATE TRIGGER trg_clients_assign_number
    BEFORE INSERT ON public.clients
    FOR EACH ROW
    EXECUTE FUNCTION public.assign_client_number();

    ALTER TABLE public.clients ALTER COLUMN client_number SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_client_number_unique ON public.clients (client_number);


    -- ─── 5. WORK REQUESTS (WR-{ENTITY}-{YYYY}-{NNNN}) ──────────────────────────
    DO $$
    BEGIN
      ALTER TABLE public.work_requests ADD COLUMN IF NOT EXISTS work_request_number VARCHAR(50);
    END $$;

    DO $$
    DECLARE
      r RECORD;
      v_code text;
      v_year int;
      v_prefix text;
      v_max int;
    BEGIN
      FOR r IN SELECT DISTINCT wr.entity_id,
                               COALESCE(e.code, 'ATA') AS code,
                               EXTRACT(YEAR FROM COALESCE(wr.created_at, now()))::int AS yr
               FROM public.work_requests wr
               LEFT JOIN public.entities e ON e.id = wr.entity_id
      LOOP
        v_code := r.code;
        v_year := r.yr;
        v_prefix := 'WR-' || v_code || '-' || v_year::text;

        SELECT COALESCE(MAX(NULLIF(regexp_replace(work_request_number, '^' || v_prefix || '-0*', ''), '')::integer), 0)
        INTO v_max
        FROM public.work_requests
        WHERE work_request_number ~ ('^' || v_prefix || '-\\d+$');

        WITH to_update AS (
          SELECT wr.id,
                 v_max + ROW_NUMBER() OVER (ORDER BY wr.created_at ASC, wr.id ASC) AS rn
          FROM public.work_requests wr
          WHERE (wr.work_request_number IS NULL OR BTRIM(wr.work_request_number) = '')
            AND (wr.entity_id = r.entity_id OR (wr.entity_id IS NULL AND r.entity_id IS NULL))
            AND EXTRACT(YEAR FROM COALESCE(wr.created_at, now()))::int = v_year
        )
        UPDATE public.work_requests wr_table
        SET work_request_number = v_prefix || '-' || CASE WHEN LENGTH(u.rn::text) < 4 THEN LPAD(u.rn::text, 4, '0') ELSE u.rn::text END
        FROM to_update u
        WHERE wr_table.id = u.id;

        SELECT COALESCE(MAX(NULLIF(regexp_replace(work_request_number, '^' || v_prefix || '-0*', ''), '')::integer), 0)
        INTO v_max
        FROM public.work_requests
        WHERE work_request_number ~ ('^' || v_prefix || '-\\d+$');

        IF v_max > 0 THEN
          INSERT INTO public.document_sequences (prefix, current_val, updated_at)
          VALUES (v_prefix, v_max, now())
          ON CONFLICT (prefix)
          DO UPDATE SET current_val = GREATEST(public.document_sequences.current_val, EXCLUDED.current_val),
                        updated_at = now();
        END IF;
      END LOOP;
    END $$;

    CREATE OR REPLACE FUNCTION public.assign_work_request_number()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_code text := 'ATA';
      v_year integer;
    BEGIN
      IF NEW.work_request_number IS NULL OR BTRIM(NEW.work_request_number) = '' THEN
        IF NEW.entity_id IS NOT NULL THEN
          SELECT COALESCE(code, 'ATA') INTO v_code
          FROM public.entities
          WHERE id = NEW.entity_id;
          IF v_code IS NULL THEN
            v_code := 'ATA';
          END IF;
        END IF;
        v_year := EXTRACT(YEAR FROM COALESCE(NEW.created_at, now()))::integer;
        NEW.work_request_number := public.next_document_sequence('WR-' || v_code || '-' || v_year::text);
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_work_requests_assign_number ON public.work_requests;
    CREATE TRIGGER trg_work_requests_assign_number
    BEFORE INSERT ON public.work_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.assign_work_request_number();

    ALTER TABLE public.work_requests ALTER COLUMN work_request_number SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_work_requests_work_request_number_unique ON public.work_requests (work_request_number);


    -- ─── 6. INVOICES, DISBURSEMENTS, TRANSMITTALS ─────────────────────────────
    -- Backfill invoices missing invoice_number
    DO $$
    DECLARE
      inv RECORD;
      v_code text;
      v_year text;
      v_prefix text;
      v_num text;
    BEGIN
      FOR inv IN SELECT i.id, i.issue_date, i.created_at, COALESCE(e.code, 'ATA') AS code
                 FROM public.invoices i
                 LEFT JOIN public.entities e ON e.id = i.entity_id
                 WHERE i.invoice_number IS NULL OR BTRIM(i.invoice_number) = ''
                 ORDER BY i.created_at ASC, i.id ASC
      LOOP
        v_code := inv.code;
        v_year := EXTRACT(YEAR FROM COALESCE(inv.issue_date::timestamptz, inv.created_at, now()))::text;
        v_prefix := v_code || '-SI-' || v_year;
        v_num := public.next_document_sequence(v_prefix);
        UPDATE public.invoices SET invoice_number = v_num WHERE id = inv.id;
      END LOOP;
    END $$;

    -- Backfill disbursements missing disbursement_number
    DO $$
    DECLARE
      d RECORD;
      v_code text;
      v_date_str text;
      v_prefix text;
      v_num text;
    BEGIN
      FOR d IN SELECT disb.id, disb.created_at, COALESCE(e.code, 'ATA') AS code
               FROM public.disbursements disb
               LEFT JOIN public.entities e ON e.id = disb.entity_id
               WHERE disb.disbursement_number IS NULL OR BTRIM(disb.disbursement_number) = ''
               ORDER BY disb.created_at ASC, disb.id ASC
      LOOP
        v_code := d.code;
        v_date_str := TO_CHAR(COALESCE(d.created_at, now()), 'YYYYMMDD');
        v_prefix := 'DISB-' || v_code || '-' || v_date_str;
        v_num := public.next_document_sequence(v_prefix);
        UPDATE public.disbursements SET disbursement_number = v_num WHERE id = d.id;
      END LOOP;
    END $$;

    -- Backfill transmittals missing tracking_number
    DO $$
    DECLARE
      tr RECORD;
      v_code text;
      v_year text;
      v_prefix text;
      v_num text;
    BEGIN
      FOR tr IN SELECT t.id, t.created_at, COALESCE(e.code, 'ATA') AS code
                FROM public.transmittals t
                LEFT JOIN public.entities e ON e.id = t.entity_id
                WHERE t.tracking_number IS NULL OR BTRIM(t.tracking_number) = ''
                ORDER BY t.created_at ASC, t.id ASC
      LOOP
        v_code := tr.code;
        v_year := EXTRACT(YEAR FROM COALESCE(tr.created_at, now()))::text;
        v_prefix := 'TR-' || v_code || '-' || v_year;
        v_num := public.next_document_sequence(v_prefix);
        UPDATE public.transmittals SET tracking_number = v_num WHERE id = tr.id;
      END LOOP;
    END $$;

    -- Sync document_sequences upwards
    DO $$
    DECLARE
      r RECORD;
    BEGIN
      -- invoices: (ATA|LTA)-SI-YYYY
      FOR r IN SELECT substring(invoice_number FROM '^([A-Z]+-SI-\\d{4})-\\d+$') AS prefix,
                      MAX(substring(invoice_number FROM '^[A-Z]+-SI-\\d{4}-(\\d+)$')::integer) AS max_val
               FROM public.invoices
               WHERE invoice_number ~ '^[A-Z]+-SI-\\d{4}-\\d+$'
               GROUP BY 1
      LOOP
        INSERT INTO public.document_sequences (prefix, current_val, updated_at)
        VALUES (r.prefix, r.max_val, now())
        ON CONFLICT (prefix)
        DO UPDATE SET current_val = GREATEST(public.document_sequences.current_val, EXCLUDED.current_val),
                      updated_at = now();
      END LOOP;

      -- invoices: INV-YYYY
      FOR r IN SELECT substring(invoice_number FROM '^(INV-\\d{4})-\\d+$') AS prefix,
                      MAX(substring(invoice_number FROM '^INV-\\d{4}-(\\d+)$')::integer) AS max_val
               FROM public.invoices
               WHERE invoice_number ~ '^INV-\\d{4}-\\d+$'
               GROUP BY 1
      LOOP
        INSERT INTO public.document_sequences (prefix, current_val, updated_at)
        VALUES (r.prefix, r.max_val, now())
        ON CONFLICT (prefix)
        DO UPDATE SET current_val = GREATEST(public.document_sequences.current_val, EXCLUDED.current_val),
                      updated_at = now();
      END LOOP;

      -- disbursements: DISB-CODE-YYYYMMDD
      FOR r IN SELECT substring(disbursement_number FROM '^(DISB-[A-Z]+-\\d{8})-\\d+$') AS prefix,
                      MAX(substring(disbursement_number FROM '^DISB-[A-Z]+-\\d{8}-(\\d+)$')::integer) AS max_val
               FROM public.disbursements
               WHERE disbursement_number ~ '^DISB-[A-Z]+-\\d{8}-\\d+$'
               GROUP BY 1
      LOOP
        INSERT INTO public.document_sequences (prefix, current_val, updated_at)
        VALUES (r.prefix, r.max_val, now())
        ON CONFLICT (prefix)
        DO UPDATE SET current_val = GREATEST(public.document_sequences.current_val, EXCLUDED.current_val),
                      updated_at = now();
      END LOOP;

      -- transmittals: TR-CODE-YYYY
      FOR r IN SELECT substring(tracking_number FROM '^(TR-[A-Z]+-\\d{4})-\\d+$') AS prefix,
                      MAX(substring(tracking_number FROM '^TR-[A-Z]+-\\d{4}-(\\d+)$')::integer) AS max_val
               FROM public.transmittals
               WHERE tracking_number ~ '^TR-[A-Z]+-\\d{4}-\\d+$'
               GROUP BY 1
      LOOP
        INSERT INTO public.document_sequences (prefix, current_val, updated_at)
        VALUES (r.prefix, r.max_val, now())
        ON CONFLICT (prefix)
        DO UPDATE SET current_val = GREATEST(public.document_sequences.current_val, EXCLUDED.current_val),
                      updated_at = now();
      END LOOP;
    END $$;

    -- Trigger: invoices
    CREATE OR REPLACE FUNCTION public.assign_invoice_number()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_code text := 'ATA';
      v_year integer;
    BEGIN
      IF NEW.invoice_number IS NULL OR BTRIM(NEW.invoice_number) = '' THEN
        IF NEW.entity_id IS NOT NULL THEN
          SELECT COALESCE(code, 'ATA') INTO v_code
          FROM public.entities
          WHERE id = NEW.entity_id;
          IF v_code IS NULL THEN
            v_code := 'ATA';
          END IF;
        END IF;
        v_year := EXTRACT(YEAR FROM COALESCE(NEW.issue_date::timestamptz, NEW.created_at, now()))::integer;
        NEW.invoice_number := public.next_document_sequence(v_code || '-SI-' || v_year::text);
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_invoices_assign_number ON public.invoices;
    CREATE TRIGGER trg_invoices_assign_number
    BEFORE INSERT ON public.invoices
    FOR EACH ROW
    EXECUTE FUNCTION public.assign_invoice_number();

    -- Trigger: disbursements
    CREATE OR REPLACE FUNCTION public.assign_disbursement_number()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_code text := 'ATA';
      v_date_str text;
    BEGIN
      IF NEW.disbursement_number IS NULL OR BTRIM(NEW.disbursement_number) = '' THEN
        IF NEW.entity_id IS NOT NULL THEN
          SELECT COALESCE(code, 'ATA') INTO v_code
          FROM public.entities
          WHERE id = NEW.entity_id;
          IF v_code IS NULL THEN
            v_code := 'ATA';
          END IF;
        END IF;
        v_date_str := TO_CHAR(COALESCE(NEW.created_at, now()), 'YYYYMMDD');
        NEW.disbursement_number := public.next_document_sequence('DISB-' || v_code || '-' || v_date_str);
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_disbursements_assign_number ON public.disbursements;
    CREATE TRIGGER trg_disbursements_assign_number
    BEFORE INSERT ON public.disbursements
    FOR EACH ROW
    EXECUTE FUNCTION public.assign_disbursement_number();

    -- Trigger: transmittals
    CREATE OR REPLACE FUNCTION public.assign_transmittal_tracking_number()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_code text := 'ATA';
      v_year integer;
    BEGIN
      IF NEW.tracking_number IS NULL OR BTRIM(NEW.tracking_number) = '' THEN
        IF NEW.entity_id IS NOT NULL THEN
          SELECT COALESCE(code, 'ATA') INTO v_code
          FROM public.entities
          WHERE id = NEW.entity_id;
          IF v_code IS NULL THEN
            v_code := 'ATA';
          END IF;
        END IF;
        v_year := EXTRACT(YEAR FROM COALESCE(NEW.created_at, now()))::integer;
        NEW.tracking_number := public.next_document_sequence('TR-' || v_code || '-' || v_year::text);
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_transmittals_assign_number ON public.transmittals;
    CREATE TRIGGER trg_transmittals_assign_number
    BEFORE INSERT ON public.transmittals
    FOR EACH ROW
    EXECUTE FUNCTION public.assign_transmittal_tracking_number();

    -- NOT NULL constraints
    ALTER TABLE public.invoices ALTER COLUMN invoice_number SET NOT NULL;
    ALTER TABLE public.disbursements ALTER COLUMN disbursement_number SET NOT NULL;
    ALTER TABLE public.transmittals ALTER COLUMN tracking_number SET NOT NULL;

    -- Global unique indexes
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_invoice_number_unique ON public.invoices (invoice_number);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_disbursements_disbursement_number_unique ON public.disbursements (disbursement_number);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transmittals_tracking_number_unique ON public.transmittals (tracking_number);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Drop global unique indexes
    DROP INDEX IF EXISTS public.idx_transmittals_tracking_number_unique;
    DROP INDEX IF EXISTS public.idx_disbursements_disbursement_number_unique;
    DROP INDEX IF EXISTS public.idx_invoices_invoice_number_unique;

    -- Drop triggers
    DROP TRIGGER IF EXISTS trg_transmittals_assign_number ON public.transmittals;
    DROP FUNCTION IF EXISTS public.assign_transmittal_tracking_number();

    DROP TRIGGER IF EXISTS trg_disbursements_assign_number ON public.disbursements;
    DROP FUNCTION IF EXISTS public.assign_disbursement_number();

    DROP TRIGGER IF EXISTS trg_invoices_assign_number ON public.invoices;
    DROP FUNCTION IF EXISTS public.assign_invoice_number();

    DROP TRIGGER IF EXISTS trg_work_requests_assign_number ON public.work_requests;
    DROP FUNCTION IF EXISTS public.assign_work_request_number();
    DROP INDEX IF EXISTS public.idx_work_requests_work_request_number_unique;
    ALTER TABLE public.work_requests DROP COLUMN IF EXISTS work_request_number;

    DROP TRIGGER IF EXISTS trg_clients_assign_number ON public.clients;
    DROP FUNCTION IF EXISTS public.assign_client_number();
    DROP INDEX IF EXISTS public.idx_clients_client_number_unique;
    ALTER TABLE public.clients DROP COLUMN IF EXISTS client_number;

    DROP TRIGGER IF EXISTS trg_users_assign_number ON public.users;
    DROP FUNCTION IF EXISTS public.assign_user_number();
    DROP INDEX IF EXISTS public.idx_users_user_number_unique;
    DROP SEQUENCE IF EXISTS public.users_number_seq;
    ALTER TABLE public.users DROP COLUMN IF EXISTS user_number;

    DROP TRIGGER IF EXISTS trg_audit_logs_assign_number ON public.audit_logs;
    DROP FUNCTION IF EXISTS public.assign_audit_log_number();
    DROP INDEX IF EXISTS public.idx_audit_logs_audit_number_unique;
    DROP SEQUENCE IF EXISTS public.audit_logs_number_seq;
    ALTER TABLE public.audit_logs DROP COLUMN IF EXISTS audit_number;
  `);
};
