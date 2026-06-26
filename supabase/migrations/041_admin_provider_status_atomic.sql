-- Migration 041: Atomic admin provider-status update + audit log (Security Remediation Batch 3)
--
-- Addresses audit finding:
--   H1/H5 (SECURITY_AUDIT_1) — Admin KYC status update is not atomic with the
--   provider_kyc_log audit insert. If the log insert fails, the status change is
--   committed with no audit trail (UAE compliance risk).
--
-- Fix: a single SECURITY DEFINER RPC performs ONLY the approved status / verified_badge
-- change AND the audit-log insert in one transaction. Either both succeed or both roll back.
--
-- IMPORTANT — this is NOT a generic provider-update bypass:
--   * It takes explicit, named scalar parameters only.
--   * It writes ONLY providers.status and providers.verified_badge (each applied only when
--     the corresponding parameter is non-null), plus one provider_kyc_log row.
--   * It cannot set any other provider column, so it does not open a hole in the C3
--     immutable-column protection from migration 039. The C3 trigger still runs; because
--     this RPC is executed by the service_role client, is_service_role() returns true and
--     the approved write passes (same proven pattern as select_quote_atomic /
--     sla_check_and_release in migration 040).
--
-- Keeps SECURITY DEFINER, SET search_path = public, and the revoke/grant pattern.
-- Idempotent: safe to re-run (CREATE OR REPLACE).

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_update_provider_status_atomic(
  p_admin_id        UUID,
  p_provider_id     UUID,
  p_new_status      TEXT,      -- nullable: when null, status is left unchanged
  p_verified_badge  BOOLEAN,   -- nullable: when null, verified_badge is left unchanged
  p_review_notes    TEXT,      -- nullable: stored as provider_kyc_log.notes
  p_previous_status TEXT,      -- the status observed by the route before the change
  p_action          TEXT       -- audit action: submitted|under_review|approved|rejected|suspended|reactivated
)
RETURNS TABLE (
  success BOOLEAN,
  reason  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated UUID;
BEGIN
  -- Validate the target status against the same allow-list as the providers CHECK constraint.
  IF p_new_status IS NOT NULL
     AND p_new_status NOT IN ('pending', 'under_review', 'active', 'rejected', 'suspended') THEN
    RETURN QUERY SELECT FALSE, 'invalid_status'::TEXT;
    RETURN;
  END IF;

  -- Validate the audit action against the provider_kyc_log CHECK allow-list.
  IF p_action IS NOT NULL
     AND p_action NOT IN ('submitted', 'under_review', 'approved', 'rejected', 'suspended', 'reactivated') THEN
    RETURN QUERY SELECT FALSE, 'invalid_action'::TEXT;
    RETURN;
  END IF;

  -- Apply ONLY the approved columns. COALESCE keeps each field unchanged when its
  -- parameter is null, so this can never touch any other provider data.
  UPDATE public.providers
  SET status         = COALESCE(p_new_status, status),
      verified_badge = COALESCE(p_verified_badge, verified_badge)
  WHERE id = p_provider_id
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN
    RETURN QUERY SELECT FALSE, 'provider_not_found'::TEXT;
    RETURN;
  END IF;

  -- Audit insert is part of the SAME transaction as the status change. A failure here
  -- (e.g. missing required fields) raises and rolls back the status change above.
  -- Only log when an actual status transition occurred.
  IF p_new_status IS NOT NULL AND p_new_status IS DISTINCT FROM p_previous_status THEN
    INSERT INTO public.provider_kyc_log (
      provider_id, admin_id, action, previous_status, new_status, notes
    ) VALUES (
      p_provider_id, p_admin_id, p_action, p_previous_status, p_new_status, p_review_notes
    );
  END IF;

  RETURN QUERY SELECT TRUE, 'updated'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_provider_status_atomic(UUID, UUID, TEXT, BOOLEAN, TEXT, TEXT, TEXT)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_provider_status_atomic(UUID, UUID, TEXT, BOOLEAN, TEXT, TEXT, TEXT)
  TO service_role;

COMMIT;
