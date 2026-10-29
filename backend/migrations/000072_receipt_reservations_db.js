/**
 * Receipt reservations database schema and atomic RPC procedures.
 *
 * Provides PostgreSQL persistence for receipt reservations without requiring local disk storage.
 * All mutations use row-level locks and atomic state transitions in PostgreSQL.
 * Private table and procedures: access is revoked from PUBLIC, anon, and authenticated;
 * granted strictly to service_role with RLS enabled.
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- Supabase API roles must already exist; local tests provision their own roles.

    -- 2. Dedicated receipt reservations table
    CREATE TABLE IF NOT EXISTS public.receipt_reservations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      upload_id text UNIQUE NOT NULL,
      object_key text UNIQUE NOT NULL,
      user_id uuid NOT NULL,
      entity_id uuid NOT NULL,
      entity_code text,
      filename text NOT NULL,
      content_type text NOT NULL,
      size bigint NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'completed', 'claimed', 'consumed', 'deleting', 'cleanup_failed'
      )),
      claim_id text,
      claimed_by uuid,
      claimed_at timestamptz,
      consumed_at timestamptz,
      voucher_id uuid,
      expires_at timestamptz NOT NULL,
      retry_count integer NOT NULL DEFAULT 0,
      last_cleanup_error text,
      last_cleanup_attempt_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );

    CREATE INDEX IF NOT EXISTS idx_receipt_reservations_object_key
      ON public.receipt_reservations(object_key);
    CREATE INDEX IF NOT EXISTS idx_receipt_reservations_status_expires
      ON public.receipt_reservations(status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_receipt_reservations_user_entity
      ON public.receipt_reservations(user_id, entity_id);

    -- 3. Strict security: Deny browser/public roles, grant only service_role
    REVOKE ALL ON TABLE public.receipt_reservations FROM PUBLIC, anon, authenticated;
    GRANT ALL ON TABLE public.receipt_reservations TO service_role;
    ALTER TABLE public.receipt_reservations ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS receipt_reservations_service_role ON public.receipt_reservations;
    CREATE POLICY receipt_reservations_service_role ON public.receipt_reservations
      FOR ALL TO service_role USING (true) WITH CHECK (true);

    -- 4. Atomic Procedure: receipt_reservation_create
    CREATE OR REPLACE FUNCTION public.receipt_reservation_create(
      p_upload_id text,
      p_user_id uuid,
      p_entity_id uuid,
      p_entity_code text,
      p_object_key text,
      p_filename text,
      p_content_type text,
      p_size bigint,
      p_expires_in_seconds integer DEFAULT 900
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_expires_at timestamptz;
      v_row receipt_reservations%ROWTYPE;
    BEGIN
      IF p_upload_id IS NULL OR p_user_id IS NULL OR p_entity_id IS NULL OR
         p_object_key IS NULL OR p_filename IS NULL OR p_content_type IS NULL OR p_size IS NULL THEN
        RETURN jsonb_build_object('error', 'INVALID_ARGUMENTS');
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.receipt_reservations
        WHERE upload_id = p_upload_id OR object_key = p_object_key
      ) THEN
        RETURN jsonb_build_object('error', 'RECEIPT_RESERVATION_EXISTS');
      END IF;

      v_expires_at := clock_timestamp() + (COALESCE(p_expires_in_seconds, 900) * interval '1 second');

      INSERT INTO public.receipt_reservations (
        upload_id, user_id, entity_id, entity_code, object_key,
        filename, content_type, size, status, expires_at, created_at, updated_at
      ) VALUES (
        p_upload_id, p_user_id, p_entity_id, p_entity_code, p_object_key,
        p_filename, p_content_type, p_size, 'pending', v_expires_at, clock_timestamp(), clock_timestamp()
      )
      RETURNING * INTO v_row;

      RETURN jsonb_build_object(
        'data', jsonb_build_object(
          'uploadId', v_row.upload_id,
          'userId', v_row.user_id,
          'entityId', v_row.entity_id,
          'entityCode', v_row.entity_code,
          'objectKey', v_row.object_key,
          'filename', v_row.filename,
          'contentType', v_row.content_type,
          'size', v_row.size,
          'status', v_row.status,
          'expiresAt', to_char(v_row.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'createdAt', to_char(v_row.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
      );
    EXCEPTION
      WHEN unique_violation THEN
        RETURN jsonb_build_object('error', 'RECEIPT_RESERVATION_EXISTS');
    END;
    $$;

    -- 5. Atomic Procedure: receipt_reservation_get
    CREATE OR REPLACE FUNCTION public.receipt_reservation_get(
      p_upload_id text
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_row receipt_reservations%ROWTYPE;
    BEGIN
      IF p_upload_id IS NULL THEN
        RETURN NULL;
      END IF;

      SELECT * INTO v_row
      FROM public.receipt_reservations
      WHERE upload_id = p_upload_id;

      IF NOT FOUND THEN
        RETURN NULL;
      END IF;

      IF v_row.status <> 'consumed' AND v_row.expires_at < clock_timestamp() THEN
        RETURN NULL;
      END IF;

      RETURN jsonb_build_object(
        'uploadId', v_row.upload_id,
        'userId', v_row.user_id,
        'entityId', v_row.entity_id,
        'entityCode', v_row.entity_code,
        'objectKey', v_row.object_key,
        'filename', v_row.filename,
        'contentType', v_row.content_type,
        'size', v_row.size,
        'status', v_row.status,
        'expiresAt', to_char(v_row.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'createdAt', to_char(v_row.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'claimId', v_row.claim_id,
        'claimedBy', v_row.claimed_by,
        'claimedAt', CASE WHEN v_row.claimed_at IS NOT NULL THEN to_char(v_row.claimed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END,
        'consumedAt', CASE WHEN v_row.consumed_at IS NOT NULL THEN to_char(v_row.consumed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END,
        'voucherId', v_row.voucher_id,
        'retryCount', v_row.retry_count,
        'lastCleanupError', v_row.last_cleanup_error,
        'lastCleanupAttemptAt', CASE WHEN v_row.last_cleanup_attempt_at IS NOT NULL THEN to_char(v_row.last_cleanup_attempt_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END
      );
    END;
    $$;

    -- 6. Atomic Procedure: receipt_reservation_complete
    CREATE OR REPLACE FUNCTION public.receipt_reservation_complete(
      p_upload_id text,
      p_user_id uuid,
      p_entity_id uuid
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_row receipt_reservations%ROWTYPE;
    BEGIN
      IF p_upload_id IS NULL THEN
        RETURN jsonb_build_object('error', 'NOT_FOUND');
      END IF;

      SELECT * INTO v_row
      FROM public.receipt_reservations
      WHERE upload_id = p_upload_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'NOT_FOUND');
      END IF;

      IF p_user_id IS NULL OR p_entity_id IS NULL OR
         v_row.user_id IS DISTINCT FROM p_user_id OR
         v_row.entity_id IS DISTINCT FROM p_entity_id THEN
        RETURN jsonb_build_object('error', 'MISMATCH');
      END IF;

      IF v_row.status = 'consumed' THEN
        RETURN jsonb_build_object('error', 'ALREADY_CONSUMED');
      END IF;

      IF v_row.status = 'claimed' THEN
        RETURN jsonb_build_object('error', 'ALREADY_CLAIMED');
      END IF;

      IF v_row.status NOT IN ('pending', 'completed') THEN
        RETURN jsonb_build_object('error', 'CLEANUP_IN_PROGRESS');
      END IF;

      IF v_row.expires_at < clock_timestamp() THEN
        RETURN jsonb_build_object('error', 'EXPIRED');
      END IF;

      UPDATE public.receipt_reservations
      SET status = 'completed',
          updated_at = clock_timestamp()
      WHERE id = v_row.id
      RETURNING * INTO v_row;

      RETURN jsonb_build_object(
        'data', jsonb_build_object(
          'uploadId', v_row.upload_id,
          'userId', v_row.user_id,
          'entityId', v_row.entity_id,
          'entityCode', v_row.entity_code,
          'objectKey', v_row.object_key,
          'filename', v_row.filename,
          'contentType', v_row.content_type,
          'size', v_row.size,
          'status', v_row.status,
          'expiresAt', to_char(v_row.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'createdAt', to_char(v_row.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
      );
    END;
    $$;

    -- 7. Atomic Procedure: receipt_reservation_find_completed
    CREATE OR REPLACE FUNCTION public.receipt_reservation_find_completed(
      p_receipt_s3_key text,
      p_user_id uuid,
      p_entity_id uuid
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_row receipt_reservations%ROWTYPE;
    BEGIN
      IF p_receipt_s3_key IS NULL THEN
        RETURN jsonb_build_object('error', 'NOT_FOUND');
      END IF;

      SELECT * INTO v_row
      FROM public.receipt_reservations
      WHERE object_key = p_receipt_s3_key;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'NOT_FOUND');
      END IF;

      IF p_user_id IS NULL OR p_entity_id IS NULL OR
         v_row.user_id IS DISTINCT FROM p_user_id OR
         v_row.entity_id IS DISTINCT FROM p_entity_id THEN
        RETURN jsonb_build_object('error', 'MISMATCH');
      END IF;

      IF v_row.status = 'consumed' THEN
        RETURN jsonb_build_object('error', 'ALREADY_CONSUMED');
      END IF;

      IF v_row.status = 'claimed' THEN
        RETURN jsonb_build_object('error', 'ALREADY_CLAIMED');
      END IF;

      IF v_row.expires_at < clock_timestamp() THEN
        RETURN jsonb_build_object('error', 'EXPIRED');
      END IF;

      IF v_row.status <> 'completed' THEN
        RETURN jsonb_build_object('error', 'NOT_COMPLETED');
      END IF;

      RETURN jsonb_build_object(
        'data', jsonb_build_object(
          'uploadId', v_row.upload_id,
          'userId', v_row.user_id,
          'entityId', v_row.entity_id,
          'entityCode', v_row.entity_code,
          'objectKey', v_row.object_key,
          'filename', v_row.filename,
          'contentType', v_row.content_type,
          'size', v_row.size,
          'status', v_row.status,
          'expiresAt', to_char(v_row.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'createdAt', to_char(v_row.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
      );
    END;
    $$;

    -- 8. Atomic Procedure: receipt_reservation_claim
    CREATE OR REPLACE FUNCTION public.receipt_reservation_claim(
      p_receipt_s3_key text,
      p_user_id uuid,
      p_entity_id uuid,
      p_claim_id text DEFAULT NULL
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_row receipt_reservations%ROWTYPE;
      v_claim_id text;
      v_now timestamptz;
    BEGIN
      IF p_receipt_s3_key IS NULL THEN
        RETURN jsonb_build_object('error', 'NOT_FOUND');
      END IF;

      SELECT * INTO v_row
      FROM public.receipt_reservations
      WHERE object_key = p_receipt_s3_key
      FOR UPDATE;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'NOT_FOUND');
      END IF;

      IF p_user_id IS NULL OR p_entity_id IS NULL OR
         v_row.user_id IS DISTINCT FROM p_user_id OR
         v_row.entity_id IS DISTINCT FROM p_entity_id THEN
        RETURN jsonb_build_object('error', 'MISMATCH');
      END IF;

      IF v_row.status = 'consumed' THEN
        RETURN jsonb_build_object('error', 'ALREADY_CONSUMED');
      END IF;

      IF v_row.status = 'claimed' THEN
        RETURN jsonb_build_object('error', 'ALREADY_CLAIMED');
      END IF;

      IF v_row.expires_at < clock_timestamp() THEN
        RETURN jsonb_build_object('error', 'EXPIRED');
      END IF;

      IF v_row.status <> 'completed' THEN
        RETURN jsonb_build_object('error', 'NOT_COMPLETED');
      END IF;

      v_claim_id := COALESCE(NULLIF(trim(p_claim_id), ''), gen_random_uuid()::text);
      v_now := clock_timestamp();

      UPDATE public.receipt_reservations
      SET status = 'claimed',
          claim_id = v_claim_id,
          claimed_by = p_user_id,
          claimed_at = v_now,
          updated_at = v_now
      WHERE id = v_row.id
      RETURNING * INTO v_row;

      RETURN jsonb_build_object(
        'data', jsonb_build_object(
          'uploadId', v_row.upload_id,
          'userId', v_row.user_id,
          'entityId', v_row.entity_id,
          'entityCode', v_row.entity_code,
          'objectKey', v_row.object_key,
          'filename', v_row.filename,
          'contentType', v_row.content_type,
          'size', v_row.size,
          'status', v_row.status,
          'claimId', v_claim_id,
          'claimedBy', v_row.claimed_by,
          'claimedAt', to_char(v_row.claimed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'expiresAt', to_char(v_row.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'createdAt', to_char(v_row.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ),
        'claimId', v_claim_id
      );
    END;
    $$;

    -- 9. Atomic Procedure: receipt_reservation_release
    CREATE OR REPLACE FUNCTION public.receipt_reservation_release(
      p_receipt_s3_key text,
      p_user_id uuid,
      p_entity_id uuid,
      p_claim_id text
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_row receipt_reservations%ROWTYPE;
    BEGIN
      IF p_receipt_s3_key IS NULL THEN
        RETURN NULL;
      END IF;

      SELECT * INTO v_row
      FROM public.receipt_reservations
      WHERE object_key = p_receipt_s3_key
      FOR UPDATE;

      IF NOT FOUND THEN
        RETURN NULL;
      END IF;

      IF p_user_id IS NULL OR p_entity_id IS NULL OR
         v_row.user_id IS DISTINCT FROM p_user_id OR
         v_row.entity_id IS DISTINCT FROM p_entity_id THEN
        RETURN jsonb_build_object('error', 'MISMATCH');
      END IF;

      IF v_row.status = 'consumed' THEN
        RETURN jsonb_build_object('error', 'ALREADY_CONSUMED');
      END IF;

      IF v_row.status <> 'claimed' THEN
        RETURN jsonb_build_object('error', 'NOT_CLAIMED');
      END IF;

      IF p_claim_id IS NULL OR v_row.claim_id IS DISTINCT FROM p_claim_id THEN
        RETURN jsonb_build_object('error', 'CLAIM_MISMATCH');
      END IF;

      UPDATE public.receipt_reservations
      SET status = 'completed',
          claim_id = NULL,
          claimed_by = NULL,
          claimed_at = NULL,
          updated_at = clock_timestamp()
      WHERE id = v_row.id
      RETURNING * INTO v_row;

      RETURN jsonb_build_object(
        'data', jsonb_build_object(
          'uploadId', v_row.upload_id,
          'userId', v_row.user_id,
          'entityId', v_row.entity_id,
          'entityCode', v_row.entity_code,
          'objectKey', v_row.object_key,
          'filename', v_row.filename,
          'contentType', v_row.content_type,
          'size', v_row.size,
          'status', v_row.status,
          'expiresAt', to_char(v_row.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'createdAt', to_char(v_row.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
      );
    END;
    $$;

    -- 10. Atomic Procedure: receipt_reservation_consume
    CREATE OR REPLACE FUNCTION public.receipt_reservation_consume(
      p_receipt_s3_key text,
      p_user_id uuid,
      p_entity_id uuid,
      p_claim_id text DEFAULT NULL,
      p_voucher_id uuid DEFAULT NULL
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_row receipt_reservations%ROWTYPE;
      v_now timestamptz;
    BEGIN
      IF p_receipt_s3_key IS NULL THEN
        RETURN NULL;
      END IF;

      SELECT * INTO v_row
      FROM public.receipt_reservations
      WHERE object_key = p_receipt_s3_key
      FOR UPDATE;

      IF NOT FOUND OR p_user_id IS NULL OR p_entity_id IS NULL OR
         v_row.user_id IS DISTINCT FROM p_user_id OR
         v_row.entity_id IS DISTINCT FROM p_entity_id THEN
        RETURN NULL;
      END IF;

      IF v_row.status NOT IN ('claimed', 'completed') THEN
        RETURN NULL;
      END IF;

      IF v_row.status = 'claimed' AND (p_claim_id IS NULL OR v_row.claim_id IS DISTINCT FROM p_claim_id) THEN
        RETURN NULL;
      END IF;

      v_now := clock_timestamp();

      UPDATE public.receipt_reservations
      SET status = 'consumed',
          consumed_at = v_now,
          voucher_id = p_voucher_id,
          claim_id = NULL,
          claimed_by = NULL,
          claimed_at = NULL,
          updated_at = v_now
      WHERE id = v_row.id
      RETURNING * INTO v_row;

      RETURN jsonb_build_object(
        'uploadId', v_row.upload_id,
        'userId', v_row.user_id,
        'entityId', v_row.entity_id,
        'entityCode', v_row.entity_code,
        'objectKey', v_row.object_key,
        'filename', v_row.filename,
        'contentType', v_row.content_type,
        'size', v_row.size,
        'status', v_row.status,
        'consumedAt', to_char(v_row.consumed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'voucherId', v_row.voucher_id,
        'expiresAt', to_char(v_row.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'createdAt', to_char(v_row.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      );
    END;
    $$;

    -- 11. Atomic Procedure: receipt_reservation_cleanup_select
    CREATE OR REPLACE FUNCTION public.receipt_reservation_cleanup_select(
      p_now timestamptz DEFAULT clock_timestamp(),
      p_dry_run boolean DEFAULT false,
      p_consumed_retention_ms bigint DEFAULT 86400000,
      p_ttl_ms bigint DEFAULT NULL
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_scanned integer := 0;
      v_skipped_consumed integer := 0;
      v_skipped_active_claims integer := 0;
      v_pruned_consumed integer := 0;
      v_candidates jsonb := '[]'::jsonb;
      v_retention_interval interval;
    BEGIN
      v_retention_interval := (COALESCE(p_consumed_retention_ms, 86400000) || ' milliseconds')::interval;

      SELECT count(*) INTO v_scanned FROM public.receipt_reservations;

      SELECT count(*) INTO v_skipped_consumed
      FROM public.receipt_reservations
      WHERE status = 'consumed';

      IF NOT p_dry_run THEN
        WITH deleted_consumed AS (
          DELETE FROM public.receipt_reservations
          WHERE status = 'consumed'
            AND (p_now - COALESCE(consumed_at, expires_at)) > v_retention_interval
          RETURNING id
        )
        SELECT count(*) INTO v_pruned_consumed FROM deleted_consumed;
      END IF;

      SELECT count(*) INTO v_skipped_active_claims
      FROM public.receipt_reservations
      WHERE status = 'claimed';

      IF p_dry_run THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'uploadId', upload_id,
          'objectKey', object_key,
          'status', status
        )), '[]'::jsonb)
        INTO v_candidates
        FROM public.receipt_reservations
        WHERE status NOT IN ('consumed', 'claimed')
          AND (
            status IN ('deleting', 'cleanup_failed')
            OR (CASE WHEN p_ttl_ms IS NOT NULL THEN (p_now - created_at) > (p_ttl_ms || ' milliseconds')::interval
                     ELSE expires_at < p_now END)
          );
      ELSE
        WITH selected AS (
          SELECT id
          FROM public.receipt_reservations
          WHERE status NOT IN ('consumed', 'claimed')
            AND (
              status IN ('deleting', 'cleanup_failed')
              OR (CASE WHEN p_ttl_ms IS NOT NULL THEN (p_now - created_at) > (p_ttl_ms || ' milliseconds')::interval
                       ELSE expires_at < p_now END)
            )
          FOR UPDATE SKIP LOCKED
        ),
        updated AS (
          UPDATE public.receipt_reservations r
          SET status = 'deleting',
              updated_at = p_now
          FROM selected s
          WHERE r.id = s.id
          RETURNING r.upload_id, r.object_key, r.status
        )
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'uploadId', upload_id,
          'objectKey', object_key,
          'status', status
        )), '[]'::jsonb)
        INTO v_candidates
        FROM updated;
      END IF;

      RETURN jsonb_build_object(
        'scanned', v_scanned,
        'skippedConsumed', v_skipped_consumed,
        'skippedActiveClaims', v_skipped_active_claims,
        'prunedConsumedRecords', v_pruned_consumed,
        'candidates', v_candidates
      );
    END;
    $$;

    -- 12. Atomic Procedure: receipt_reservation_cleanup_finalize
    CREATE OR REPLACE FUNCTION public.receipt_reservation_cleanup_finalize(
      p_upload_id text,
      p_action text,
      p_voucher_id uuid DEFAULT NULL,
      p_error text DEFAULT NULL
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_row receipt_reservations%ROWTYPE;
    BEGIN
      IF p_upload_id IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'action', 'not_found');
      END IF;

      SELECT * INTO v_row
      FROM public.receipt_reservations
      WHERE upload_id = p_upload_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', true, 'action', 'not_found');
      END IF;

      IF p_action = 'linked' THEN
        IF v_row.status IN ('deleting', 'cleanup_failed') THEN
          UPDATE public.receipt_reservations
          SET status = 'consumed',
              voucher_id = p_voucher_id,
              consumed_at = clock_timestamp(),
              updated_at = clock_timestamp()
          WHERE id = v_row.id;
        END IF;
      ELSIF p_action = 'deleted' THEN
        IF v_row.status IN ('deleting', 'cleanup_failed') THEN
          DELETE FROM public.receipt_reservations
          WHERE id = v_row.id;
        END IF;
      ELSIF p_action = 'failed' THEN
        IF v_row.status IN ('deleting', 'cleanup_failed') THEN
          UPDATE public.receipt_reservations
          SET status = 'cleanup_failed',
              retry_count = v_row.retry_count + 1,
              last_cleanup_error = p_error,
              last_cleanup_attempt_at = clock_timestamp(),
              updated_at = clock_timestamp()
          WHERE id = v_row.id;
        END IF;
      END IF;

      RETURN jsonb_build_object('ok', true);
    END;
    $$;

    -- 13. Probe Procedure: receipt_reservation_probe
    CREATE OR REPLACE FUNCTION public.receipt_reservation_probe()
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    BEGIN
      PERFORM 1 FROM public.receipt_reservations LIMIT 1;
      RETURN jsonb_build_object('ok', true);
    END;
    $$;

    -- 14. Clear Procedure (Testing/Maintenance): receipt_reservation_clear
    CREATE OR REPLACE FUNCTION public.receipt_reservation_clear()
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    BEGIN
      DELETE FROM public.receipt_reservations;
      RETURN jsonb_build_object('ok', true);
    END;
    $$;

    -- 15. Security grants on all procedures (service_role only; revoke from PUBLIC, anon, authenticated)
    REVOKE ALL ON FUNCTION public.receipt_reservation_create(text, uuid, uuid, text, text, text, text, bigint, integer) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.receipt_reservation_create(text, uuid, uuid, text, text, text, text, bigint, integer) TO service_role;

    REVOKE ALL ON FUNCTION public.receipt_reservation_get(text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.receipt_reservation_get(text) TO service_role;

    REVOKE ALL ON FUNCTION public.receipt_reservation_complete(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.receipt_reservation_complete(text, uuid, uuid) TO service_role;

    REVOKE ALL ON FUNCTION public.receipt_reservation_find_completed(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.receipt_reservation_find_completed(text, uuid, uuid) TO service_role;

    REVOKE ALL ON FUNCTION public.receipt_reservation_claim(text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.receipt_reservation_claim(text, uuid, uuid, text) TO service_role;

    REVOKE ALL ON FUNCTION public.receipt_reservation_release(text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.receipt_reservation_release(text, uuid, uuid, text) TO service_role;

    REVOKE ALL ON FUNCTION public.receipt_reservation_consume(text, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.receipt_reservation_consume(text, uuid, uuid, text, uuid) TO service_role;

    REVOKE ALL ON FUNCTION public.receipt_reservation_cleanup_select(timestamptz, boolean, bigint, bigint) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.receipt_reservation_cleanup_select(timestamptz, boolean, bigint, bigint) TO service_role;

    REVOKE ALL ON FUNCTION public.receipt_reservation_cleanup_finalize(text, text, uuid, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.receipt_reservation_cleanup_finalize(text, text, uuid, text) TO service_role;

    REVOKE ALL ON FUNCTION public.receipt_reservation_probe() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.receipt_reservation_probe() TO service_role;

    REVOKE ALL ON FUNCTION public.receipt_reservation_clear() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.receipt_reservation_clear() TO service_role;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS public.receipt_reservation_clear();
    DROP FUNCTION IF EXISTS public.receipt_reservation_probe();
    DROP FUNCTION IF EXISTS public.receipt_reservation_cleanup_finalize(text, text, uuid, text);
    DROP FUNCTION IF EXISTS public.receipt_reservation_cleanup_select(timestamptz, boolean, bigint, bigint);
    DROP FUNCTION IF EXISTS public.receipt_reservation_consume(text, uuid, uuid, text, uuid);
    DROP FUNCTION IF EXISTS public.receipt_reservation_release(text, uuid, uuid, text);
    DROP FUNCTION IF EXISTS public.receipt_reservation_claim(text, uuid, uuid, text);
    DROP FUNCTION IF EXISTS public.receipt_reservation_find_completed(text, uuid, uuid);
    DROP FUNCTION IF EXISTS public.receipt_reservation_complete(text, uuid, uuid);
    DROP FUNCTION IF EXISTS public.receipt_reservation_get(text);
    DROP FUNCTION IF EXISTS public.receipt_reservation_create(text, uuid, uuid, text, text, text, text, bigint, integer);
    DROP TABLE IF EXISTS public.receipt_reservations;
  `);
};
