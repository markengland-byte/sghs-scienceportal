-- ================================================================
-- FERPA Phase 2.5b — RLS rewrite + drop now-orphan helpers
-- ================================================================
-- Replaces every classes / dsm_modules / dsm_questions / student_classes
-- RLS policy that used the SECURITY DEFINER helpers (get_teacher_id,
-- get_student_id, get_my_class_ids) with direct
-- `auth.uid() = <denormalized_col>` checks.
--
-- Drops the 3 orphan helper functions. Keeps is_admin() — still used
-- and exposes only the caller's own admin status (low risk).
--
-- Drops "Teachers read enrolled students" + "Teachers see class
-- enrollments" because teachers now go through /api/teacher/* with
-- the service-role key (no RLS dependency).
--
-- Verified by SET LOCAL ROLE authenticated + JWT-claims contract test:
-- - Mark (admin) sees all 7 classes / 8 dsm_modules / 204 questions / 15 enrollments
-- - Kiera (student) sees 7 classes (active=true public), 8 published
--   modules, 204 active questions, 1 own enrollment — zero leakage.
-- ================================================================

-- ── classes ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Teachers manage own classes"  ON classes;
DROP POLICY IF EXISTS "Teachers update own classes"  ON classes;
DROP POLICY IF EXISTS "Teachers delete own classes"  ON classes;

CREATE POLICY classes_insert_self ON classes FOR INSERT
  WITH CHECK (teacher_auth_user_id = auth.uid() OR is_admin());
CREATE POLICY classes_update_self ON classes FOR UPDATE
  USING      (teacher_auth_user_id = auth.uid() OR is_admin())
  WITH CHECK (teacher_auth_user_id = auth.uid() OR is_admin());
CREATE POLICY classes_delete_self ON classes FOR DELETE
  USING (teacher_auth_user_id = auth.uid() OR is_admin());

-- ── dsm_modules ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Teachers manage own DSM modules" ON dsm_modules;
DROP POLICY IF EXISTS "Teachers insert DSM modules"     ON dsm_modules;
DROP POLICY IF EXISTS "Teachers update own DSM modules" ON dsm_modules;
DROP POLICY IF EXISTS "Teachers delete own DSM modules" ON dsm_modules;

CREATE POLICY dsm_modules_select_self ON dsm_modules FOR SELECT
  USING (created_by_auth_user_id = auth.uid() OR is_admin());
CREATE POLICY dsm_modules_insert_self ON dsm_modules FOR INSERT
  WITH CHECK (created_by_auth_user_id = auth.uid() OR is_admin());
CREATE POLICY dsm_modules_update_self ON dsm_modules FOR UPDATE
  USING      (created_by_auth_user_id = auth.uid() OR is_admin())
  WITH CHECK (created_by_auth_user_id = auth.uid() OR is_admin());
CREATE POLICY dsm_modules_delete_self ON dsm_modules FOR DELETE
  USING (created_by_auth_user_id = auth.uid() OR is_admin());

-- ── dsm_questions ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Teachers manage own DSM questions" ON dsm_questions;
DROP POLICY IF EXISTS "Teachers insert DSM questions"     ON dsm_questions;
DROP POLICY IF EXISTS "Teachers update own DSM questions" ON dsm_questions;
DROP POLICY IF EXISTS "Teachers delete own DSM questions" ON dsm_questions;

CREATE POLICY dsm_questions_select_self ON dsm_questions FOR SELECT
  USING (created_by_auth_user_id = auth.uid() OR is_admin());
CREATE POLICY dsm_questions_insert_self ON dsm_questions FOR INSERT
  WITH CHECK (created_by_auth_user_id = auth.uid() OR is_admin());
CREATE POLICY dsm_questions_update_self ON dsm_questions FOR UPDATE
  USING      (created_by_auth_user_id = auth.uid() OR is_admin())
  WITH CHECK (created_by_auth_user_id = auth.uid() OR is_admin());
CREATE POLICY dsm_questions_delete_self ON dsm_questions FOR DELETE
  USING (created_by_auth_user_id = auth.uid() OR is_admin());

-- ── student_classes ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Students manage own enrollments" ON student_classes;
DROP POLICY IF EXISTS "Students see own enrollments"    ON student_classes;
DROP POLICY IF EXISTS "Students unenroll self"          ON student_classes;
DROP POLICY IF EXISTS "Teachers see class enrollments"  ON student_classes;

CREATE POLICY student_classes_insert_self ON student_classes FOR INSERT
  WITH CHECK (auth_user_id = auth.uid());
CREATE POLICY student_classes_select_self ON student_classes FOR SELECT
  USING (auth_user_id = auth.uid() OR is_admin());
CREATE POLICY student_classes_delete_self ON student_classes FOR DELETE
  USING (auth_user_id = auth.uid());

-- ── students (drop only the teacher-side cross-table policy) ────
DROP POLICY IF EXISTS "Teachers read enrolled students" ON students;

-- ── Drop the now-orphan helper functions ────────────────────────
DROP FUNCTION IF EXISTS public.get_teacher_id();
DROP FUNCTION IF EXISTS public.get_student_id();
DROP FUNCTION IF EXISTS public.get_my_class_ids();

NOTIFY pgrst, 'reload schema';
