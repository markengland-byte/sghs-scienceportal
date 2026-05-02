-- ================================================================
-- FERPA Phase 2 — RLS Lockdown
-- ================================================================
-- Replaces the cross-table-subquery RLS pattern (the same shape that
-- caused phantom-state on these 5 tables on 2026-04-29) with a
-- self-contained `auth_user_id = auth.uid()` check.
--
-- Prerequisites (already applied):
--   * Migration 006 added student_module_overrides (Phase B)
--   * Earlier migration added auth_user_id columns + indexes on the
--     5 write tables and backfilled existing rows
--   * sol-api.js now sends auth_user_id on every write
--   * requires_sso=true on all 7 ENG-* classes
--
-- After this:
--   * Anon writes are rejected (no auth.uid() => no match)
--   * Students can only read their OWN rows via REST
--   * Teacher dashboard reads keep working — they go through
--     /api/teacher/* endpoints which use the service-role key
--     (bypasses RLS entirely; no impact)
--   * Service-role + SQL Editor still see everything (this is
--     intentional — teachers and admins use service-role paths)
-- ================================================================

-- ─────────────── scores ───────────────
DROP POLICY IF EXISTS scores_insert_self_or_legacy ON scores;
DROP POLICY IF EXISTS scores_select_any            ON scores;

CREATE POLICY scores_insert_self ON scores FOR INSERT
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY scores_select_self ON scores FOR SELECT
  USING (auth_user_id = auth.uid() OR is_admin());

-- ─────────────── activity ───────────────
DROP POLICY IF EXISTS activity_insert_self_or_legacy ON activity;
DROP POLICY IF EXISTS activity_select_any            ON activity;

CREATE POLICY activity_insert_self ON activity FOR INSERT
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY activity_select_self ON activity FOR SELECT
  USING (auth_user_id = auth.uid() OR is_admin());

-- ─────────────── quiz_detail ───────────────
DROP POLICY IF EXISTS quiz_detail_insert_self_or_legacy ON quiz_detail;
DROP POLICY IF EXISTS quiz_detail_select_any            ON quiz_detail;

CREATE POLICY quiz_detail_insert_self ON quiz_detail FOR INSERT
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY quiz_detail_select_self ON quiz_detail FOR SELECT
  USING (auth_user_id = auth.uid() OR is_admin());

-- ─────────────── checkpoints ───────────────
DROP POLICY IF EXISTS checkpoints_insert_self_or_legacy ON checkpoints;
DROP POLICY IF EXISTS checkpoints_select_any            ON checkpoints;

CREATE POLICY checkpoints_insert_self ON checkpoints FOR INSERT
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY checkpoints_select_self ON checkpoints FOR SELECT
  USING (auth_user_id = auth.uid() OR is_admin());

-- ─────────────── dsm_attempts ───────────────
-- Keeps an UPDATE policy: the DSM player creates an attempt row at
-- start of mastery, then PATCHes with the final score on completion.
DROP POLICY IF EXISTS dsm_attempts_insert_self_or_legacy ON dsm_attempts;
DROP POLICY IF EXISTS dsm_attempts_update_self_or_legacy ON dsm_attempts;
DROP POLICY IF EXISTS dsm_attempts_select_any            ON dsm_attempts;

CREATE POLICY dsm_attempts_insert_self ON dsm_attempts FOR INSERT
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY dsm_attempts_update_self ON dsm_attempts FOR UPDATE
  USING      (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY dsm_attempts_select_self ON dsm_attempts FOR SELECT
  USING (auth_user_id = auth.uid() OR is_admin());

NOTIFY pgrst, 'reload schema';
