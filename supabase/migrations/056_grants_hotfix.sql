-- ============================================================================
-- Migration 056 — EMERGENCY grants-only hotfix (Postgres/Supabase, public schema)
--
-- SCOPE: 15 confirmed live PUBLIC-execute findings (select_quote_atomic and
-- get_nearby_providers proven via direct pg_get_functiondef/grant-history
-- inspection; the remaining 13 identified as at-risk by the same DROP+CREATE
-- pattern across migration history). 056 additionally normalizes grants
-- across all 30 project-owned public-schema functions to eliminate current
-- AND future ACL drift. This does NOT mean all 30 are confirmed gaps — most
-- already carry correct grants; this migration re-asserts them anyway so the
-- whole surface has one auditable, idempotent source of truth.
--
-- Grants-only: no function body, signature, owner, or search_path is changed.
--
-- ROOT CAUSE (three mechanisms, all three must be closed together):
--   (i)   `ALTER DEFAULT PRIVILEGES` for role `postgres` in schema `public`
--         explicitly granted EXECUTE to anon AND authenticated by default
--         (proven: defaclacl = {postgres=X, anon=X, authenticated=X,
--         service_role=X} for defaclobjtype='f') — every new postgres-created
--         function was born pre-exposed.
--   (ii)  PUBLIC's implicit EXECUTE (the Postgres schema default) was never
--         revoked for get_nearby_providers, and for select_quote_atomic was
--         revoked from anon/authenticated individually but never from PUBLIC
--         itself, so the PUBLIC grant kept resurfacing.
--   (iii) DROP FUNCTION + CREATE OR REPLACE cycles (select_quote_atomic was
--         rebuilt this way 4 times — migrations 040, 045, 047, 048) reset the
--         ACL to schema defaults each time; none of those four re-issued
--         REVOKE ALL FROM PUBLIC.
--
-- Sensitive targets include multiple SECURITY DEFINER functions (confirmed
-- directly for is_admin() at 001_initial_schema.sql:118-123; the *_atomic
-- RPCs follow this project's own stated SECURITY DEFINER convention per
-- AGENTS.md — re-confirm via the baseline query in the review package before
-- applying). Search-path hijack risk was checked separately and is clean:
-- anon/authenticated/service_role all have CREATE = false on schema public.
--
-- is_admin(): grants anon, authenticated, service_role (NOT a blanket "no
-- anon" default). Live RLS proof: price_estimates carries BOTH
-- "Admin full access" (roles={public}, qual = is_admin()) AND
-- "Public read price estimates" (roles={anon,authenticated}, qual = true).
-- In Postgres RLS, roles={public} means the policy is evaluated for EVERY
-- role, including anon -- so an anonymous read of price_estimates ALSO
-- triggers evaluation of the admin policy's is_admin() call. Revoking anon
-- EXECUTE on is_admin() would break that public read with "permission
-- denied for function is_admin". PUBLIC's implicit grant (the actual
-- vulnerability) is still removed by REVOKE ALL FROM PUBLIC below -- only
-- the anon role keeps EXECUTE, which is a real, currently-relied-upon path.
-- FOLLOW-UP (not in scope here -- 056 is grants-only, RLS policy changes are
-- a separate migration): restrict admin RLS policies from TO PUBLIC to TO
-- authenticated where safe, runtime-test anonymous price_estimates reads
-- against the narrowed policy, then revoke anon EXECUTE from is_admin().
--
-- is_service_role(): classified OWNER-ONLY (no anon, authenticated, or
-- service_role grant). Confirmed via direct search of every migration file
-- (Select-String on "is_service_role", supabase/migrations/*.sql) and of
-- src/: the ONLY two call sites in the entire codebase are
-- 039_security_backstop.sql:52 and :85, both inside the
-- enforce_users_immutable_columns / enforce_providers_immutable_columns
-- SECURITY DEFINER triggers (owned by postgres, same owner as
-- is_service_role() itself) -- those calls execute as the owner and succeed
-- via ownership regardless of any explicit grant. The live RLS-policy query
-- for is_service_role also returned zero rows. No other direct caller
-- exists anywhere in the project.
--
-- FAIL-CLOSED DEFAULT: after this migration, every newly created postgres-
-- owned function in public is born callable by its owner only. Each future
-- migration MUST explicitly GRANT the roles it needs (see AGENTS.md rule).
-- supabase_admin's own default-privilege entries are NOT touched.
--
-- Idempotent: safe to re-run. Fully transactional: any failed guard or
-- assertion raises an exception and rolls back the ENTIRE migration —
-- partial ACL normalization is never left in place.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 056.0a Precondition guard: every target function must exist in `public`
-- and be unambiguous by name (no live overload). Collects ALL problems into
-- one readable error instead of failing opaquely on the first miss.
-- ----------------------------------------------------------------------------
DO $guard_exist$
DECLARE
  v_targets text[] := ARRAY[
    'accept_provider_request_atomic','restore_ppj_credit_for_cancelled_paid_request',
    'complete_provider_job_atomic','cancel_request_and_compensate_atomic','release_job_atomic',
    'advance_provider_job_state','request_price_change_atomic','respond_price_change_atomic',
    'submit_quote_atomic','select_quote_atomic','finalize_ppj_selection_atomic',
    'admin_update_provider_status_atomic','expire_stale_open_requests','expire_stuck_active_requests',
    'sla_check_and_release','expire_ppj_payment_selection_atomic','weekly_sla_reset_atomic',
    'release_target_status','get_nearby_open_requests','get_nearby_providers',
    'reset_monthly_job_counters','get_provider_limits','get_customer_abuse_limits',
    'compute_request_visibility_delay','is_admin','is_service_role',
    'enforce_users_immutable_columns','enforce_providers_immutable_columns',
    'update_provider_rating','check_provider_suspension'
  ];
  v_name text;
  v_count int;
  v_missing text[] := ARRAY[]::text[];
  v_ambiguous text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_name IN ARRAY v_targets LOOP
    SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name;

    IF v_count = 0 THEN
      v_missing := array_append(v_missing, v_name);
    ELSIF v_count > 1 THEN
      v_ambiguous := array_append(v_ambiguous, v_name);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 056 aborted: missing function(s) in public schema (drift vs. this migration''s assumptions): %',
      array_to_string(v_missing, ', ');
  END IF;

  IF array_length(v_ambiguous, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 056 aborted: ambiguous/overloaded function(s) require explicit signature handling before this migration can proceed: %',
      array_to_string(v_ambiguous, ', ');
  END IF;
END;
$guard_exist$;

-- ----------------------------------------------------------------------------
-- 056.0b Extension-ownership guard: abort if any target is owned by an
-- extension (never modify extension-owned function grants here).
-- ----------------------------------------------------------------------------
DO $guard_ext$
DECLARE
  v_ext_owned text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_ext_owned
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'accept_provider_request_atomic','restore_ppj_credit_for_cancelled_paid_request',
      'complete_provider_job_atomic','cancel_request_and_compensate_atomic','release_job_atomic',
      'advance_provider_job_state','request_price_change_atomic','respond_price_change_atomic',
      'submit_quote_atomic','select_quote_atomic','finalize_ppj_selection_atomic',
      'admin_update_provider_status_atomic','expire_stale_open_requests','expire_stuck_active_requests',
      'sla_check_and_release','expire_ppj_payment_selection_atomic','weekly_sla_reset_atomic',
      'release_target_status','get_nearby_open_requests','get_nearby_providers',
      'reset_monthly_job_counters','get_provider_limits','get_customer_abuse_limits',
      'compute_request_visibility_delay','is_admin','is_service_role',
      'enforce_users_immutable_columns','enforce_providers_immutable_columns',
      'update_provider_rating','check_provider_suspension'
    );

  IF v_ext_owned IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 056 aborted: extension-owned function(s) in target list, must not be touched: %', v_ext_owned;
  END IF;
END;
$guard_ext$;

-- ----------------------------------------------------------------------------
-- 056.0c Owner guard: abort if any target's owner is not the expected
-- migration role (confirmed live: current_user = session_user = postgres).
-- ----------------------------------------------------------------------------
DO $guard_owner$
DECLARE
  v_bad_owner text;
BEGIN
  SELECT string_agg(p.proname || ' (owner=' || pg_get_userbyid(p.proowner) || ')', ', ') INTO v_bad_owner
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'accept_provider_request_atomic','restore_ppj_credit_for_cancelled_paid_request',
      'complete_provider_job_atomic','cancel_request_and_compensate_atomic','release_job_atomic',
      'advance_provider_job_state','request_price_change_atomic','respond_price_change_atomic',
      'submit_quote_atomic','select_quote_atomic','finalize_ppj_selection_atomic',
      'admin_update_provider_status_atomic','expire_stale_open_requests','expire_stuck_active_requests',
      'sla_check_and_release','expire_ppj_payment_selection_atomic','weekly_sla_reset_atomic',
      'release_target_status','get_nearby_open_requests','get_nearby_providers',
      'reset_monthly_job_counters','get_provider_limits','get_customer_abuse_limits',
      'compute_request_visibility_delay','is_admin','is_service_role',
      'enforce_users_immutable_columns','enforce_providers_immutable_columns',
      'update_provider_rating','check_provider_suspension'
    )
    AND pg_get_userbyid(p.proowner) <> 'postgres';

  IF v_bad_owner IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 056 aborted: unexpected owner (expected postgres) on: %', v_bad_owner;
  END IF;
END;
$guard_owner$;

-- ----------------------------------------------------------------------------
-- 056.0d Security-mode guard: is_admin() is directly confirmed SECURITY
-- DEFINER (001_initial_schema.sql:118-123). This is the only assertion I
-- have direct source evidence for this session; it is asserted, not merely
-- claimed.
-- ----------------------------------------------------------------------------
DO $guard_secdef$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_admin' AND p.prosecdef = true
  ) THEN
    RAISE EXCEPTION 'Migration 056 aborted: is_admin() is expected to be SECURITY DEFINER but is not — drift from 001_initial_schema.sql.';
  END IF;
END;
$guard_secdef$;

-- ----------------------------------------------------------------------------
-- 056.1 FAIL-CLOSED DEFAULT PRIVILEGES (binding decision A).
--
-- ROOT CAUSE OF DEFAULT-PRIVILEGE EXPOSURE — THREE mechanisms, all closed here:
--   (i)   Postgres's BUILT-IN default for functions grants PUBLIC EXECUTE to
--         every function created by any role, in any schema, unless that
--         role's GLOBAL (no IN SCHEMA) default privileges explicitly revoke
--         it -- proven live via an in-transaction probe: a function created
--         with no customization at all has proacl = NULL yet
--         anon/authenticated/service_role/PUBLIC all show EXECUTE = true
--         through implicit PUBLIC membership.
--   (ii)  A prior standalone `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public
--         REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role`
--         was already applied directly to production. Per Postgres's
--         additive default-privilege model (see MECHANISM below), a
--         schema-scoped statement can only remove the EXPLICIT default
--         grants recorded for schema public -- it cannot and does not
--         remove Postgres's built-in PUBLIC-execute default, which is a
--         separate mechanism entirely. REVOKE also only affects grantees
--         you name; since it never named PUBLIC, PUBLIC's access was left
--         untouched by two separate causes at once. The schema-scoped
--         statement below is safely idempotent and now explicitly names
--         PUBLIC too (defensive documentation of the schema-level default);
--         re-running it is a no-op for the three roles it already covered.
--   (iii) DROP FUNCTION + CREATE OR REPLACE cycles (select_quote_atomic x4)
--         reset each function's OWN acl to schema defaults on every rebuild,
--         which is why (i)/(ii) must be closed at the default-privilege
--         level, not just per-function.
--
-- MECHANISM (schema-specific defaults are ADDITIVE to global defaults --
-- they do NOT override or take precedence over them): per Postgres docs, a
-- per-schema `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON
-- FUNCTIONS FROM PUBLIC` does NOT remove Postgres's built-in PUBLIC-execute
-- default for functions -- the docs give this exact case as an example of
-- what schema-scoped revokes cannot do. Only a GLOBAL (no IN SCHEMA)
-- `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS
-- FROM PUBLIC` suppresses the built-in default itself, for every schema
-- that role creates functions in, including public. Therefore BOTH
-- statements below are required, for TWO DIFFERENT reasons, not as
-- redundant defense-in-depth for the same hole:
--   1. The GLOBAL revoke closes (i) -- the built-in PUBLIC-execute default
--      -- for every schema, including public and storage.
--   2. The public-schema revoke closes the EXPLICIT additional default
--      grants recorded specifically for schema public (anon/authenticated/
--      service_role from the prior standalone apply) -- these are a
--      second, separate grant source layered on top of the built-in
--      default, and the global revoke does not touch them.
-- The schema-scoped PUBLIC revoke (included in the statement below) is
-- kept as defensive documentation of intent, not because it is what closes
-- the built-in-default hole -- the global statement is what does that.
--
-- STORAGE SCHEMA: the global revoke WILL suppress the built-in PUBLIC-
-- execute default for any FUTURE postgres-created function in storage too
-- (additive: it only ever removes PUBLIC, nothing else). Storage's
-- EXISTING explicit schema-scoped default grants to anon/authenticated/
-- service_role are a separate, additive layer and remain in effect,
-- untouched by 056 -- confirmed by direct search that no project migration
-- creates any function in the storage schema (only `storage.objects` RLS
-- policies and calls to the extension-provided storage.foldername() exist,
-- in migration 023). Proven below via a byte-for-byte before/after
-- comparison of storage's default-ACL row. supabase_admin's own defaults
-- are untouched entirely.
-- ----------------------------------------------------------------------------

-- Baseline snapshot of the storage-schema default ACL for role postgres,
-- taken BEFORE any change, so the postcondition below can prove it is
-- untouched. Out of scope for 056 -- captured only for comparison.
DO $storage_baseline$
DECLARE
  v_before text;
BEGIN
  SELECT d.defaclacl::text INTO v_before
  FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
  WHERE d.defaclrole = 'postgres'::regrole AND n.nspname = 'storage' AND d.defaclobjtype = 'f';

  CREATE TEMP TABLE IF NOT EXISTS __056_storage_baseline (acl text) ON COMMIT DROP;
  DELETE FROM __056_storage_baseline;
  INSERT INTO __056_storage_baseline VALUES (v_before);
END;
$storage_baseline$;

-- Schema-specific: removes the EXPLICIT default grants recorded for schema
-- public (anon/authenticated/service_role from the prior standalone apply)
-- and documents PUBLIC's exclusion here too. This statement alone does NOT
-- remove Postgres's built-in PUBLIC-execute default (additive model, see
-- MECHANISM above) -- the global statement below is what does that.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

-- Global (no IN SCHEMA): suppresses Postgres's BUILT-IN PUBLIC-execute
-- default for every schema this role creates functions in, including
-- public and storage. This is the statement that actually closes root
-- cause (i) -- required regardless of whether a schema-specific row
-- exists, since schema-specific and global defaults are additive, not
-- overriding.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Postcondition: prove the storage-schema default ACL is byte-for-byte
-- unchanged (out of scope, must not be touched by either ALTER above).
DO $storage_check$
DECLARE
  v_before text;
  v_after text;
BEGIN
  SELECT acl INTO v_before FROM __056_storage_baseline;

  SELECT d.defaclacl::text INTO v_after
  FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
  WHERE d.defaclrole = 'postgres'::regrole AND n.nspname = 'storage' AND d.defaclobjtype = 'f';

  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'Migration 056 aborted: storage-schema default ACL for role postgres changed (before=%, after=%) -- out of scope, must remain untouched', v_before, v_after;
  END IF;
END;
$storage_check$;

-- Postcondition: the GLOBAL default-ACL row must EXIST (absence = fallback
-- to the built-in PUBLIC-execute default = failure, not a pass) and must
-- carry no PUBLIC EXECUTE grant. Checked via aclexplode, not ACL text.
DO $assert_global_default$
DECLARE
  v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_default_acl d
    WHERE d.defaclrole = 'postgres'::regrole
      AND d.defaclnamespace = 0
      AND d.defaclobjtype = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM aclexplode(d.defaclacl) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      )
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Migration 056 aborted: global postgres FUNCTIONS default-ACL row is missing or still grants PUBLIC EXECUTE (an absent row means Postgres falls back to the built-in PUBLIC-execute default -- absence is a failure, not a pass)';
  END IF;
END;
$assert_global_default$;

-- Postcondition: the SCHEMA-SPECIFIC (public) default-ACL row must EXIST
-- and must carry no PUBLIC/anon/authenticated/service_role EXECUTE grant.
DO $assert_schema_default$
DECLARE
  v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
    WHERE d.defaclrole = 'postgres'::regrole
      AND n.nspname = 'public'
      AND d.defaclobjtype = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM aclexplode(d.defaclacl) a
        WHERE a.privilege_type = 'EXECUTE'
          AND (
            a.grantee = 0
            OR a.grantee IN (
              'anon'::regrole::oid, 'authenticated'::regrole::oid, 'service_role'::regrole::oid
            )
          )
      )
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Migration 056 aborted: public-schema postgres FUNCTIONS default-ACL row is missing or still grants EXECUTE to PUBLIC/anon/authenticated/service_role';
  END IF;
END;
$assert_schema_default$;

-- ----------------------------------------------------------------------------
-- 056.2 FAIL-CLOSED PROOF (binding decision D). Create a throwaway function
-- immediately after the default-privilege change and prove it is born with
-- zero non-owner EXECUTE grants. Aborts the whole migration if not.
-- ----------------------------------------------------------------------------
DO $probe$
DECLARE
  v_anon boolean;
  v_auth boolean;
  v_svc boolean;
BEGIN
  EXECUTE 'CREATE FUNCTION public.__acl_probe_056() RETURNS boolean LANGUAGE sql AS $body$ SELECT true $body$';

  v_anon := has_function_privilege('anon', 'public.__acl_probe_056()', 'EXECUTE');
  v_auth := has_function_privilege('authenticated', 'public.__acl_probe_056()', 'EXECUTE');
  v_svc  := has_function_privilege('service_role', 'public.__acl_probe_056()', 'EXECUTE');

  EXECUTE 'DROP FUNCTION public.__acl_probe_056()';

  IF v_anon OR v_auth OR v_svc THEN
    RAISE EXCEPTION 'Migration 056 FAIL-CLOSED PROOF FAILED: new function born with anon=%, authenticated=%, service_role=% (expected all false)',
      v_anon, v_auth, v_svc;
  END IF;
END;
$probe$;

-- ----------------------------------------------------------------------------
-- 056.3 ACL normalization for all 30 live targets. Uses each function's OID
-- (resolved by name, proven unique by the 056.0a guard) cast to regprocedure
-- so the exact live signature is used automatically -- this migration does
-- NOT hardcode argument types anywhere, which is what makes it safe against
-- both known signature corrections (get_nearby_providers's real 4-arg
-- signature) and functions absent from migration history entirely
-- (expire_stale_open_requests -- see note below).
--
-- NOTE ON DRIFT: expire_stale_open_requests is called from
-- src/app/api/ops/expire-requests/route.ts:27 but has NO CREATE FUNCTION
-- statement anywhere in supabase/migrations/ -- it was created directly
-- against the live database (SQL editor or ad hoc), bypassing migration
-- history. This migration hardens its grants using its live OID regardless,
-- but its definition must be captured into a documented migration as a
-- separate follow-up (see review package).
-- ----------------------------------------------------------------------------
DO $normalize$
DECLARE
  v_targets jsonb := '{
    "accept_provider_request_atomic": ["service_role"],
    "restore_ppj_credit_for_cancelled_paid_request": ["service_role"],
    "complete_provider_job_atomic": ["service_role"],
    "cancel_request_and_compensate_atomic": ["service_role"],
    "release_job_atomic": ["service_role"],
    "advance_provider_job_state": ["service_role"],
    "request_price_change_atomic": ["service_role"],
    "respond_price_change_atomic": ["service_role"],
    "submit_quote_atomic": ["service_role"],
    "select_quote_atomic": ["service_role"],
    "finalize_ppj_selection_atomic": ["service_role"],
    "admin_update_provider_status_atomic": ["service_role"],
    "expire_stale_open_requests": ["service_role"],
    "expire_stuck_active_requests": ["service_role"],
    "sla_check_and_release": ["service_role"],
    "expire_ppj_payment_selection_atomic": ["service_role"],
    "weekly_sla_reset_atomic": ["service_role"],
    "release_target_status": ["service_role"],
    "get_nearby_open_requests": ["authenticated", "service_role"],
    "get_nearby_providers": ["service_role"],
    "reset_monthly_job_counters": ["service_role"],
    "get_provider_limits": ["service_role"],
    "get_customer_abuse_limits": ["service_role"],
    "compute_request_visibility_delay": ["service_role"],
    "is_admin": ["anon", "authenticated", "service_role"],
    "is_service_role": [],
    "enforce_users_immutable_columns": [],
    "enforce_providers_immutable_columns": [],
    "update_provider_rating": [],
    "check_provider_suspension": []
  }'::jsonb;
  v_name text;
  v_oid oid;
  v_sig regprocedure;
  v_role text;
BEGIN
  FOR v_name IN SELECT jsonb_object_keys(v_targets) LOOP
    SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name;

    v_sig := v_oid::regprocedure;

    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_sig);

    FOR v_role IN SELECT jsonb_array_elements_text(v_targets -> v_name) LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', v_sig, v_role);
    END LOOP;
  END LOOP;
END;
$normalize$;

-- ----------------------------------------------------------------------------
-- 056.4 Postcondition assertions (binding decision C). Re-checks every one
-- of the 30 targets x (anon, authenticated, service_role) against the same
-- classification map used above via has_function_privilege on the exact live
-- signature. Aborts the ENTIRE migration on any mismatch.
-- ----------------------------------------------------------------------------
DO $assert$
DECLARE
  v_targets jsonb := '{
    "accept_provider_request_atomic": ["service_role"],
    "restore_ppj_credit_for_cancelled_paid_request": ["service_role"],
    "complete_provider_job_atomic": ["service_role"],
    "cancel_request_and_compensate_atomic": ["service_role"],
    "release_job_atomic": ["service_role"],
    "advance_provider_job_state": ["service_role"],
    "request_price_change_atomic": ["service_role"],
    "respond_price_change_atomic": ["service_role"],
    "submit_quote_atomic": ["service_role"],
    "select_quote_atomic": ["service_role"],
    "finalize_ppj_selection_atomic": ["service_role"],
    "admin_update_provider_status_atomic": ["service_role"],
    "expire_stale_open_requests": ["service_role"],
    "expire_stuck_active_requests": ["service_role"],
    "sla_check_and_release": ["service_role"],
    "expire_ppj_payment_selection_atomic": ["service_role"],
    "weekly_sla_reset_atomic": ["service_role"],
    "release_target_status": ["service_role"],
    "get_nearby_open_requests": ["authenticated", "service_role"],
    "get_nearby_providers": ["service_role"],
    "reset_monthly_job_counters": ["service_role"],
    "get_provider_limits": ["service_role"],
    "get_customer_abuse_limits": ["service_role"],
    "compute_request_visibility_delay": ["service_role"],
    "is_admin": ["anon", "authenticated", "service_role"],
    "is_service_role": [],
    "enforce_users_immutable_columns": [],
    "enforce_providers_immutable_columns": [],
    "update_provider_rating": [],
    "check_provider_suspension": []
  }'::jsonb;
  v_name text;
  v_oid oid;
  v_expected jsonb;
  v_role text;
  v_expect_grant boolean;
  v_actual boolean;
  v_failures text[] := ARRAY[]::text[];
  v_acl aclitem[];
BEGIN
  FOR v_name IN SELECT jsonb_object_keys(v_targets) LOOP
    SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name;

    v_expected := v_targets -> v_name;

    FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      v_expect_grant := v_expected ? v_role;
      v_actual := has_function_privilege(v_role, v_oid, 'EXECUTE');
      IF v_actual <> v_expect_grant THEN
        v_failures := array_append(v_failures,
          format('%s: role=%s expected=%s actual=%s', v_name, v_role, v_expect_grant, v_actual));
      END IF;
    END LOOP;

    -- PUBLIC must never hold EXECUTE on any target after this migration.
    -- has_function_privilege('public', ...) is unreliable here: PUBLIC is a
    -- pseudo-role, not a real role, so it does not behave like a role name
    -- passed to has_function_privilege. Inspect the ACL directly instead:
    -- aclexplode grantee = 0 is the PUBLIC pseudo-entry.
    SELECT p.proacl INTO v_acl FROM pg_proc p WHERE p.oid = v_oid;
    IF EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(v_acl, acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = v_oid)))) a
      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) THEN
      v_failures := array_append(v_failures, format('%s: PUBLIC still holds EXECUTE', v_name));
    END IF;
  END LOOP;

  IF array_length(v_failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 056 postcondition FAILED, rolling back: %', array_to_string(v_failures, ' | ');
  END IF;
END;
$assert$;

COMMIT;
