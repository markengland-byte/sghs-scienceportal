-- ================================================================
-- SGHS Portal — SSO Foundation Migration
-- Run this in Supabase SQL Editor.
--
-- This migration prepares the schema for Google Workspace SSO
-- without breaking the current honor-system name-modal flow.
--
--   1. students table (links Supabase auth.users → school identity)
--   2. student_classes enrollment table
--   3. student_id columns on scores/quiz_detail/checkpoints/activity
--      (nullable so legacy anon writes keep working)
--   4. Helper functions get_student_id() and get_enrolled_class_ids()
--      (used later by Phase 2 strict RLS)
--   5. Self-scoped RLS for students + student_classes
--
-- Existing class-scoped INSERT policies on data tables are NOT
-- modified — legacy student_name flow continues to work until
-- Phase 2 lockdown is applied (separate migration, after IT
-- approves Google OAuth and we cut over to SSO).
--
-- Prerequisites: 001-rls-lockdown.sql already applied.
-- ================================================================

-- ══════════════════════════════════════════════════════
-- STEP 1: STUDENTS TABLE
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE students ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_students_auth ON students(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_students_email ON students(email);

-- ══════════════════════════════════════════════════════
-- STEP 2: STUDENT_CLASSES ENROLLMENT TABLE
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS student_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(student_id, class_id)
);

ALTER TABLE student_classes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_student_classes_student ON student_classes(student_id);
CREATE INDEX IF NOT EXISTS idx_student_classes_class ON student_classes(class_id);

-- ══════════════════════════════════════════════════════
-- STEP 3: ADD student_id COLUMNS TO DATA TABLES
-- (nullable — legacy rows have NULL, new SSO rows populate it)
-- ══════════════════════════════════════════════════════

ALTER TABLE scores        ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students(id) ON DELETE SET NULL;
ALTER TABLE quiz_detail   ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students(id) ON DELETE SET NULL;
ALTER TABLE checkpoints   ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students(id) ON DELETE SET NULL;
ALTER TABLE activity      ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students(id) ON DELETE SET NULL;
ALTER TABLE dsm_attempts  ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_scores_student_id       ON scores(student_id);
CREATE INDEX IF NOT EXISTS idx_quiz_detail_student_id  ON quiz_detail(student_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_student_id  ON checkpoints(student_id);
CREATE INDEX IF NOT EXISTS idx_activity_student_id     ON activity(student_id);
CREATE INDEX IF NOT EXISTS idx_dsm_attempts_student_id ON dsm_attempts(student_id);

-- ══════════════════════════════════════════════════════
-- STEP 4: HELPER FUNCTIONS (used by Phase 2 strict RLS later)
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_student_id() RETURNS UUID AS $$
  SELECT id FROM students WHERE auth_user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_enrolled_class_ids() RETURNS SETOF UUID AS $$
  SELECT class_id FROM student_classes
  WHERE student_id = (SELECT id FROM students WHERE auth_user_id = auth.uid());
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ══════════════════════════════════════════════════════
-- STEP 5: STUDENTS TABLE POLICIES
-- ══════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Students read own profile" ON students;
CREATE POLICY "Students read own profile"
  ON students FOR SELECT
  USING (auth_user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "Students self-create on first login" ON students;
CREATE POLICY "Students self-create on first login"
  ON students FOR INSERT
  WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "Students update own profile" ON students;
CREATE POLICY "Students update own profile"
  ON students FOR UPDATE
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "Teachers read enrolled students" ON students;
CREATE POLICY "Teachers read enrolled students"
  ON students FOR SELECT
  USING (
    id IN (
      SELECT student_id FROM student_classes
      WHERE class_id IN (SELECT get_my_class_ids())
    )
    OR is_admin()
  );

-- ══════════════════════════════════════════════════════
-- STEP 6: STUDENT_CLASSES TABLE POLICIES
-- ══════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Students manage own enrollments" ON student_classes;
CREATE POLICY "Students manage own enrollments"
  ON student_classes FOR INSERT
  WITH CHECK (student_id = get_student_id());

DROP POLICY IF EXISTS "Students see own enrollments" ON student_classes;
CREATE POLICY "Students see own enrollments"
  ON student_classes FOR SELECT
  USING (student_id = get_student_id());

DROP POLICY IF EXISTS "Students unenroll self" ON student_classes;
CREATE POLICY "Students unenroll self"
  ON student_classes FOR DELETE
  USING (student_id = get_student_id());

DROP POLICY IF EXISTS "Teachers see class enrollments" ON student_classes;
CREATE POLICY "Teachers see class enrollments"
  ON student_classes FOR SELECT
  USING (class_id IN (SELECT get_my_class_ids()) OR is_admin());

-- ══════════════════════════════════════════════════════
-- DONE
--
-- After running:
--  - Legacy name-modal flow continues to work (existing
--    class-scoped INSERT policies on scores/quiz_detail/etc.
--    are unchanged; student_id stays NULL on legacy rows).
--  - New SSO code path can sign students in, create rows in
--    students, enroll via student_classes, and write student_id
--    into the data tables.
--  - Phase 2 lockdown (separate migration) will tighten the
--    INSERT policies to require student_id = get_student_id()
--    once the cutover is complete.
-- ══════════════════════════════════════════════════════
