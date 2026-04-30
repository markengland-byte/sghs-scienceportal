-- ================================================================
-- SGHS Portal — Phase 2 RLS Lockdown
-- Run this in Supabase SQL Editor.
--
-- Replaces the wide-open `*_insert_any` policies on the 5 data tables
-- with identity-aware policies that accept either:
--
--   1. SSO writes — student_id matches the authenticated user's
--      get_student_id(), OR
--   2. Legacy writes — student_id IS NULL AND the class has
--      requires_sso = false.
--
-- Both branches use SECURITY DEFINER function calls (no raw cross-table
-- subqueries in WITH CHECK). This is the pattern proven safe last
-- night when student_classes accepted writes via student_id =
-- get_student_id() without phantom-state.
--
-- SELECT policies are left wide-open for now. They'll be locked down
-- later via 4 teacher serverless endpoints that use the service-role
-- key + JWT verification (separate work).
--
-- After applying this migration:
--   - All classes still have requires_sso = false → legacy writes
--     keep working everywhere.
--   - To pilot a class on SSO:
--       UPDATE classes SET requires_sso = true WHERE code = 'ENG-7';
--   - Once a class is requires_sso = true, any write without a
--     student_id (= unauthenticated/legacy) is rejected by RLS.
-- ================================================================

-- ── 1. Helper function for legacy gate ───────────────────────────
-- Wrapping the cross-table check in a function avoids the raw subquery
-- pattern in WITH CHECK that was associated with phantom-state.
CREATE OR REPLACE FUNCTION class_allows_legacy(cid UUID) RETURNS BOOLEAN AS $$
  SELECT requires_sso = false FROM classes WHERE id = cid;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION class_allows_legacy(UUID) IS
  'Returns true when the class is still in legacy-flow mode (no SSO required). Used by data-table INSERT policies to permit anonymous writes for classes not yet flipped to requires_sso=true. SECURITY DEFINER function call avoids raw cross-table subquery in WITH CHECK.';

-- ── 2. scores INSERT ─────────────────────────────────────────────
DROP POLICY IF EXISTS "scores_insert_any" ON scores;
DROP POLICY IF EXISTS "scores_insert_self_or_legacy" ON scores;
CREATE POLICY "scores_insert_self_or_legacy" ON scores FOR INSERT
  WITH CHECK (
    student_id = get_student_id()
    OR (student_id IS NULL AND class_allows_legacy(class_id))
  );

-- ── 3. quiz_detail INSERT ────────────────────────────────────────
DROP POLICY IF EXISTS "quiz_detail_insert_any" ON quiz_detail;
DROP POLICY IF EXISTS "quiz_detail_insert_self_or_legacy" ON quiz_detail;
CREATE POLICY "quiz_detail_insert_self_or_legacy" ON quiz_detail FOR INSERT
  WITH CHECK (
    student_id = get_student_id()
    OR (student_id IS NULL AND class_allows_legacy(class_id))
  );

-- ── 4. checkpoints INSERT ────────────────────────────────────────
DROP POLICY IF EXISTS "checkpoints_insert_any" ON checkpoints;
DROP POLICY IF EXISTS "checkpoints_insert_self_or_legacy" ON checkpoints;
CREATE POLICY "checkpoints_insert_self_or_legacy" ON checkpoints FOR INSERT
  WITH CHECK (
    student_id = get_student_id()
    OR (student_id IS NULL AND class_allows_legacy(class_id))
  );

-- ── 5. activity INSERT ───────────────────────────────────────────
DROP POLICY IF EXISTS "activity_insert_any" ON activity;
DROP POLICY IF EXISTS "activity_insert_self_or_legacy" ON activity;
CREATE POLICY "activity_insert_self_or_legacy" ON activity FOR INSERT
  WITH CHECK (
    student_id = get_student_id()
    OR (student_id IS NULL AND class_allows_legacy(class_id))
  );

-- ── 6. dsm_attempts INSERT ───────────────────────────────────────
DROP POLICY IF EXISTS "dsm_attempts_insert_any" ON dsm_attempts;
DROP POLICY IF EXISTS "dsm_attempts_insert_self_or_legacy" ON dsm_attempts;
CREATE POLICY "dsm_attempts_insert_self_or_legacy" ON dsm_attempts FOR INSERT
  WITH CHECK (
    student_id = get_student_id()
    OR (student_id IS NULL AND class_allows_legacy(class_id))
  );

-- ── 7. dsm_attempts UPDATE (students update their own attempt as they go) ──
DROP POLICY IF EXISTS "dsm_attempts_update_any" ON dsm_attempts;
DROP POLICY IF EXISTS "dsm_attempts_update_self_or_legacy" ON dsm_attempts;
CREATE POLICY "dsm_attempts_update_self_or_legacy" ON dsm_attempts FOR UPDATE
  USING (
    student_id = get_student_id()
    OR (student_id IS NULL AND class_allows_legacy(class_id))
  )
  WITH CHECK (
    student_id = get_student_id()
    OR (student_id IS NULL AND class_allows_legacy(class_id))
  );

-- ── 8. Tell PostgREST to reload its schema cache ─────────────────
-- Belt-and-suspenders so the new policies are picked up immediately.
NOTIFY pgrst, 'reload schema';

-- ── 9. Verification ──────────────────────────────────────────────
-- After running, every INSERT policy should be the new self_or_legacy
-- variant (no more *_insert_any). UPDATE on dsm_attempts likewise.
SELECT pc.relname AS table_name,
       pol.polname,
       CASE pol.polcmd
         WHEN 'r' THEN 'SELECT'
         WHEN 'a' THEN 'INSERT'
         WHEN 'w' THEN 'UPDATE'
         WHEN 'd' THEN 'DELETE'
       END AS cmd,
       pol.polpermissive AS is_permissive
FROM pg_policy pol
JOIN pg_class pc ON pc.oid = pol.polrelid
WHERE pc.relname IN ('scores','quiz_detail','checkpoints','activity','dsm_attempts')
ORDER BY pc.relname, cmd, pol.polname;

-- All classes still in legacy mode after this migration. To pilot:
--   UPDATE classes SET requires_sso = true WHERE code = 'ENG-7';
SELECT code, label, requires_sso FROM classes ORDER BY code;
