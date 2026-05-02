-- ================================================================
-- FERPA Phase 2 — Function hardening + orphan cleanup
-- ================================================================
-- Cleanup pass after migration 008 (RLS lockdown). Two changes:
--
-- 1. Drop functions that became orphan after we replaced the
--    cross-table-subquery RLS pattern with self-contained
--    auth.uid() = auth_user_id checks.
--
-- 2. Harden the SECURITY DEFINER helper functions still in use by
--    teacher/student-classes RLS:
--      a. SET search_path = '' to prevent search-path-injection
--         (CVE class flagged by advisor lint 0011).
--      b. Revoke EXECUTE from PUBLIC + anon. RLS calls these in
--         the context of an authenticated session, so the only
--         legitimate callers are `authenticated` and `service_role`.
--
-- Trigger functions (touch_updated_at) only need search_path
-- hardening — they aren't in any GRANT chain visible to anon.
-- ================================================================

-- ── Drop truly-orphan functions ──
-- class_allows_legacy() was used only by the *_self_or_legacy RLS
-- policies that migration 008 replaced. get_enrolled_class_ids()
-- was a duplicate of get_my_class_ids() that was never adopted.
DROP FUNCTION IF EXISTS public.class_allows_legacy(UUID);
DROP FUNCTION IF EXISTS public.get_enrolled_class_ids();

-- ── Lock search_path on remaining helpers ──
ALTER FUNCTION public.is_admin()                                  SET search_path = '';
ALTER FUNCTION public.get_student_id()                            SET search_path = '';
ALTER FUNCTION public.get_teacher_id()                            SET search_path = '';
ALTER FUNCTION public.get_my_class_ids()                          SET search_path = '';
ALTER FUNCTION public.student_module_overrides_touch_updated_at() SET search_path = '';
ALTER FUNCTION public.quiz_progress_touch_updated_at()            SET search_path = '';

-- ── Tighten EXECUTE grants on SECURITY DEFINER helpers ──
REVOKE EXECUTE ON FUNCTION public.is_admin()                      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_student_id()                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_teacher_id()                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_class_ids()              FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_admin()                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_student_id()                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_teacher_id()                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_class_ids()               TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- Known remaining advisor warnings (deliberately accepted):
--   * authenticated_security_definer_function_executable on the 4
--     helpers above — RLS needs them callable by authenticated.
--     Each only exposes the caller's OWN identity info, not others'.
--   * Permissive RLS on quiz_progress, module_releases, access_logs
--     — pre-existing, queued for a future Phase 2.5.
--   * Leaked-password protection disabled — students sign in with
--     Google SSO so this only applies to teacher email/password.
-- ================================================================
