-- ================================================================
-- FERPA Phase 2.5 — quiz_progress + module_releases lockdown
-- ================================================================
-- Closes two real exploit vectors flagged by the Supabase advisor
-- after the Phase 2 lockdown landed on the 5 main write tables.
--
-- 1. module_releases UPDATE was open to ANY authenticated user. A
--    signed-in student could PATCH a row to flip `unlocked = true`
--    and gain access to a unit the teacher had locked. Tighten to
--    is_admin() only — Mark uses the dashboard which runs in his
--    admin session, so no teacher workflow breaks.
--
-- 2. quiz_progress was wide open: any anon caller could read,
--    write, update, or DELETE any student's resume snapshot just
--    by knowing the (class_id, student_name, module) tuple. Add
--    auth_user_id and lock to `auth_user_id = auth.uid()`.
--
-- Backfill quiz_progress.auth_user_id by joining students on
-- canonical display_name (today's dedup work guarantees student_name
-- in this table is canonical for SSO-linked students).
-- ================================================================

-- ── module_releases — admin-only writes ──
DROP POLICY IF EXISTS "Authenticated users can update releases" ON module_releases;

CREATE POLICY module_releases_update_admin ON module_releases FOR UPDATE
  USING      (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY module_releases_insert_admin ON module_releases FOR INSERT
  WITH CHECK (is_admin());

-- SELECT stays open ("Anyone can read release state") — every unit
-- page does an unauth read on DOM-ready to decide whether to show
-- the lock overlay before the SSO modal. Public read is intentional.

-- ── quiz_progress — denormalize + lock down ──
ALTER TABLE quiz_progress ADD COLUMN IF NOT EXISTS auth_user_id UUID;
CREATE INDEX IF NOT EXISTS idx_quiz_progress_auth_user ON quiz_progress(auth_user_id);

-- One-shot backfill from students via canonical display_name match.
UPDATE quiz_progress qp SET auth_user_id = stu.auth_user_id
FROM students stu
WHERE qp.auth_user_id IS NULL
  AND stu.display_name = qp.student_name;

DROP POLICY IF EXISTS "Students can save progress"   ON quiz_progress;
DROP POLICY IF EXISTS "Students can update progress" ON quiz_progress;
DROP POLICY IF EXISTS "Students can read progress"   ON quiz_progress;
DROP POLICY IF EXISTS "Students can clear progress"  ON quiz_progress;

CREATE POLICY quiz_progress_insert_self ON quiz_progress FOR INSERT
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY quiz_progress_select_self ON quiz_progress FOR SELECT
  USING (auth_user_id = auth.uid() OR is_admin());

CREATE POLICY quiz_progress_update_self ON quiz_progress FOR UPDATE
  USING      (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY quiz_progress_delete_self ON quiz_progress FOR DELETE
  USING (auth_user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
