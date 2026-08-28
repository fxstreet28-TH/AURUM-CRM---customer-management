-- ====================================================================
-- CRM buyback admin RPCs  (Supabase project hknvooaqgpufrbdxtzxf)
-- Deployed 2026-08-28 as migrations:
--   crm_buyback_admin_rpcs
--   crm_buyback_admin_rpcs_fix_generated_column
--   crm_buyback_admin_notes_append
-- This file is the consolidated, as-deployed source of truth.
--
-- WHY THESE EXIST
-- The CRM (crm.creatorlivetech.com) is a static browser app that ships
-- only the Supabase anon key, so it authenticates as the signed-in
-- admin's JWT. It cannot use service_role. Two consequences:
--   1. request_buyback is granted to service_role only and is therefore
--      unreachable from the browser -> admin_create_buyback wraps it.
--   2. Every relevant table is RLS "own row only", so an admin querying
--      buyback_requests directly would see only their OWN rows
--      -> the admin_list/get/search read RPCs exist to serve the panel.
-- Every entry point is SECURITY DEFINER and gates on crm_assert_admin().
-- ====================================================================


-- Shared admin gate. Returns the caller's uuid or raises.
CREATE OR REPLACE FUNCTION public.crm_assert_admin()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_role      TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT role INTO v_role
    FROM public.profiles
   WHERE id = v_caller_id
     AND status = 'active'
     AND is_active;

  IF v_role IS NULL OR v_role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_caller_id;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_assert_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_assert_admin() TO authenticated, service_role;


-- admin_notes is an audit trail across the request lifecycle, so each
-- transition APPENDS a stamped line rather than overwriting the last one.
CREATE OR REPLACE FUNCTION public.crm_append_note(
  p_existing TEXT,
  p_new      TEXT,
  p_label    TEXT
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN NULLIF(btrim(COALESCE(p_new, '')), '') IS NULL THEN p_existing
    WHEN NULLIF(btrim(COALESCE(p_existing, '')), '') IS NULL
      THEN '[' || p_label || '] ' || btrim(p_new)
    ELSE btrim(p_existing) || E'\n' || '[' || p_label || '] ' || btrim(p_new)
  END;
$$;

REVOKE ALL ON FUNCTION public.crm_append_note(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_append_note(TEXT, TEXT, TEXT) TO authenticated, service_role;


-- --------------------------------------------------------------------
-- READ: the admin queue. Ordered pending -> approved -> everything else,
-- newest first, because pending is what the admin has to act on.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_buybacks(
  p_status TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  PERFORM public.crm_assert_admin();

  SELECT COALESCE(jsonb_agg(r ORDER BY r.sort_rank, r.requested_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT b.id,
             b.user_id,
             u.email                AS customer_email,
             b.star_amount,
             b.thb_per_star,
             b.total_thb,
             b.status,
             b.bank_name,
             b.bank_account_number,
             b.bank_account_name,
             b.requested_at,
             b.processed_at,
             CASE b.status
               WHEN 'pending'  THEN 0
               WHEN 'approved' THEN 1
               ELSE 2
             END AS sort_rank
        FROM public.buyback_requests b
        LEFT JOIN auth.users u ON u.id = b.user_id
       WHERE (p_status IS NULL OR p_status = '' OR b.status = p_status)
         AND (
           p_search IS NULL OR btrim(p_search) = ''
           OR u.email ILIKE '%' || btrim(p_search) || '%'
         )
    ) r;

  RETURN jsonb_build_object('success', true, 'rows', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_buybacks(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_buybacks(TEXT, TEXT) TO authenticated, service_role;


-- --------------------------------------------------------------------
-- READ: one request plus live wallet context, for the detail page.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_buyback(p_request_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  PERFORM public.crm_assert_admin();

  SELECT jsonb_build_object(
           'id',                  b.id,
           'user_id',             b.user_id,
           'customer_email',      u.email,
           'star_amount',         b.star_amount,
           'thb_per_star',        b.thb_per_star,
           'total_thb',           b.total_thb,
           'status',              b.status,
           'bank_name',           b.bank_name,
           'bank_account_number', b.bank_account_number,
           'bank_account_name',   b.bank_account_name,
           'requested_at',        b.requested_at,
           'processed_at',        b.processed_at,
           'processed_by',        b.processed_by,
           'processed_by_email',  pr.email,
           'processed_by_name',   pr.full_name,
           'admin_notes',         b.admin_notes,
           'rejection_reason',    b.rejection_reason,
           'wallet', CASE WHEN w.user_id IS NULL THEN NULL ELSE jsonb_build_object(
             'total_balance',     w.total_balance,
             'total_purchased',   w.total_purchased,
             'total_spent',       w.total_spent,
             'total_expired',     w.total_expired,
             'total_bought_back', w.total_bought_back
           ) END
         )
    INTO v_out
    FROM public.buyback_requests b
    LEFT JOIN auth.users       u  ON u.id  = b.user_id
    LEFT JOIN public.profiles  pr ON pr.id = b.processed_by
    LEFT JOIN public.stars_wallet w ON w.user_id = b.user_id
   WHERE b.id = p_request_id;

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('success', true, 'request', v_out);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_buyback(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_buyback(UUID) TO authenticated, service_role;


-- --------------------------------------------------------------------
-- READ: customer picker for the create-for-customer form.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_search_buyback_customers(p_search TEXT)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  PERFORM public.crm_assert_admin();

  IF p_search IS NULL OR btrim(p_search) = '' THEN
    RETURN jsonb_build_object('success', true, 'rows', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY r.email), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT c.user_id,
             c.email,
             COALESCE(w.total_balance, 0) AS total_balance,
             (w.user_id IS NOT NULL)      AS has_wallet
        FROM public.customers c
        LEFT JOIN public.stars_wallet w ON w.user_id = c.user_id
       WHERE c.user_id IS NOT NULL
         AND c.email ILIKE '%' || btrim(p_search) || '%'
       LIMIT 20
    ) r;

  RETURN jsonb_build_object('success', true, 'rows', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_search_buyback_customers(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_buyback_customers(TEXT) TO authenticated, service_role;


-- --------------------------------------------------------------------
-- WRITE: create a buyback on a customer's behalf. Thin admin-gated
-- wrapper over the existing service_role-only request_buyback RPC.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_buyback(
  p_user_id             UUID,
  p_star_amount         INTEGER,
  p_bank_name           TEXT,
  p_bank_account_number TEXT,
  p_bank_account_name   TEXT,
  p_admin_notes         TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id  UUID;
  v_result     jsonb;
  v_request_id UUID;
BEGIN
  v_caller_id := public.crm_assert_admin();

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_required' USING ERRCODE = 'P0001';
  END IF;

  -- Existing RPC does the balance check, the FIFO deduction and the
  -- pending row, atomically inside this transaction.
  v_result := public.request_buyback(
    p_user_id,
    p_star_amount,
    p_bank_name,
    p_bank_account_number,
    p_bank_account_name
  );

  v_request_id := (v_result ->> 'request_id')::uuid;

  -- request_buyback has no notes parameter, so stamp provenance here.
  UPDATE public.buyback_requests
     SET admin_notes = NULLIF(btrim(COALESCE(p_admin_notes, '')), '')
   WHERE id = v_request_id;

  RETURN v_result || jsonb_build_object('created_by', v_caller_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_buyback(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_buyback(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;


-- --------------------------------------------------------------------
-- WRITE: pending -> approved, approved -> paid. Never refunds.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_transition_buyback_status(
  p_request_id  UUID,
  p_new_status  TEXT,
  p_admin_notes TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id      UUID;
  v_current_status TEXT;
BEGIN
  v_caller_id := public.crm_assert_admin();

  IF p_new_status NOT IN ('approved', 'paid') THEN
    RAISE EXCEPTION 'invalid_target_status' USING ERRCODE = 'P0001';
  END IF;

  SELECT status INTO v_current_status
    FROM public.buyback_requests
   WHERE id = p_request_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_new_status = 'approved' AND v_current_status <> 'pending' THEN
    RAISE EXCEPTION 'invalid_transition: only pending can be approved' USING ERRCODE = 'P0001';
  END IF;

  IF p_new_status = 'paid' AND v_current_status <> 'approved' THEN
    RAISE EXCEPTION 'invalid_transition: only approved can be marked paid' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.buyback_requests
     SET status       = p_new_status,
         admin_notes  = public.crm_append_note(
                          admin_notes,
                          p_admin_notes,
                          to_char(NOW() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') || ' · ' || p_new_status
                        ),
         processed_at = CASE WHEN p_new_status = 'paid' THEN NOW() ELSE processed_at END,
         processed_by = v_caller_id
   WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'success',      true,
    'request_id',   p_request_id,
    'new_status',   p_new_status,
    'processed_by', v_caller_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_transition_buyback_status(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_transition_buyback_status(UUID, TEXT, TEXT) TO authenticated, service_role;


-- --------------------------------------------------------------------
-- WRITE: pending|approved -> rejected|cancelled, always refunding.
--
-- Exact inverse of what request_buyback did to the wallet:
--   request_buyback net: total_balance -N, total_bought_back +N
--     (deduct_stars_fifo does balance -N / spent +N, then request_buyback
--      reverses spent -N and adds bought_back +N)
--   refund          net: total_balance +N, total_bought_back -N
-- Stars return as a fresh batch so total_balance and the sum of
-- remaining_stars stay consistent. All of it is one transaction.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_refund_buyback(
  p_request_id       UUID,
  p_new_status       TEXT,
  p_rejection_reason TEXT,
  p_admin_notes      TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id    UUID;
  v_request      RECORD;
  v_new_batch_id UUID;
  v_wallet_rows  INTEGER;
BEGIN
  v_caller_id := public.crm_assert_admin();

  IF p_new_status NOT IN ('rejected', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_target_status' USING ERRCODE = 'P0001';
  END IF;

  IF p_rejection_reason IS NULL OR btrim(p_rejection_reason) = '' THEN
    RAISE EXCEPTION 'rejection_reason_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_request
    FROM public.buyback_requests
   WHERE id = p_request_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'invalid_transition: only pending or approved can be refunded' USING ERRCODE = 'P0001';
  END IF;

  -- Credit the stars back as a new batch. retail_thb_per_star is a STORED
  -- generated column (round(thb_amount / NULLIF(stars_amount,0), 2)) and
  -- must NOT appear in the column list.
  INSERT INTO public.star_purchases (
    user_id, stars_amount, remaining_stars, thb_amount,
    payment_method, payment_provider_id, payment_status,
    expires_at, completed_at, metadata
  ) VALUES (
    v_request.user_id,
    v_request.star_amount,
    v_request.star_amount,
    0,
    'manual_admin',
    'refund_' || p_request_id::text,
    'succeeded',
    NOW() + INTERVAL '6 months',
    NOW(),
    jsonb_build_object(
      'refund_from_buyback_id', p_request_id,
      'refunded_by',            v_caller_id,
      'reason',                 p_rejection_reason
    )
  ) RETURNING id INTO v_new_batch_id;

  UPDATE public.stars_wallet
     SET total_balance     = total_balance + v_request.star_amount,
         total_bought_back = GREATEST(0, total_bought_back - v_request.star_amount),
         updated_at        = NOW()
   WHERE user_id = v_request.user_id;

  GET DIAGNOSTICS v_wallet_rows = ROW_COUNT;
  IF v_wallet_rows = 0 THEN
    -- Refuse rather than leave a credited batch the wallet never saw.
    RAISE EXCEPTION 'wallet_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.star_transactions (
    user_id, transaction_type, stars_delta,
    reference_id, reference_type, purchase_batch_ids
  ) VALUES (
    v_request.user_id,
    'buyback_refund',
    v_request.star_amount,
    p_request_id,
    'buyback_request',
    ARRAY[v_new_batch_id]
  );

  UPDATE public.buyback_requests
     SET status           = p_new_status,
         rejection_reason = p_rejection_reason,
         admin_notes      = public.crm_append_note(
                              admin_notes,
                              p_admin_notes,
                              to_char(NOW() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') || ' · ' || p_new_status
                            ),
         processed_at     = NOW(),
         processed_by     = v_caller_id
   WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'success',         true,
    'request_id',      p_request_id,
    'new_status',      p_new_status,
    'refunded_stars',  v_request.star_amount,
    'refund_batch_id', v_new_batch_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_refund_buyback(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_refund_buyback(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;


-- --------------------------------------------------------------------
-- WRITE: edit admin_notes without changing status.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_buyback_notes(
  p_request_id  UUID,
  p_admin_notes TEXT
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.crm_assert_admin();

  UPDATE public.buyback_requests
     SET admin_notes = NULLIF(btrim(COALESCE(p_admin_notes, '')), '')
   WHERE id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('success', true, 'request_id', p_request_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_buyback_notes(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_buyback_notes(UUID, TEXT) TO authenticated, service_role;
