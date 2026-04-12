-- ================================================================
-- SGHS Portal — RLS Lockdown Migration
-- Run this in Supabase SQL Editor.
--
-- This migration:
--   1. Applies Phase 2 teacher-scoped access (if not already done)
--   2. Replaces all "temp allow all" policies with proper scoped policies
--   3. Adds access_logs table for audit trail
--   4. Adds student INSERT validation (class_id must exist and be active)
--
-- IMPORTANT: Run this AFTER the Phase 1 schema is in place.
-- ================================================================

-- ══════════════════════════════════════════════════════
-- STEP 1: TEACHERS TABLE (skip if Phase 2 already applied)
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════
-- STEP 2: LINK CLASSES TO TEACHERS
-- ══════════════════════════════════════════════════════

ALTER TABLE classes ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL;

-- ══════════════════════════════════════════════════════
-- STEP 3: HELPER FUNCTIONS
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM teachers WHERE auth_user_id = auth.uid()),
    false
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_teacher_id() RETURNS UUID AS $$
  SELECT id FROM teachers WHERE auth_user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_my_class_ids() RETURNS SETOF UUID AS $$
  SELECT id FROM classes
  WHERE teacher_id = (SELECT id FROM teachers WHERE auth_user_id = auth.uid());
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ══════════════════════════════════════════════════════
-- STEP 4: TEACHERS TABLE POLICIES
-- ══════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Teachers read own or admin reads all" ON teachers;
CREATE POLICY "Teachers read own or admin reads all"
  ON teachers FOR SELECT
  USING (auth_user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "Admins manage teachers" ON teachers;
CREATE POLICY "Admins manage teachers"
  ON teachers FOR INSERT WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admins update teachers" ON teachers;
CREATE POLICY "Admins update teachers"
  ON teachers FOR UPDATE USING (is_admin());

DROP POLICY IF EXISTS "Admins delete teachers" ON teachers;
CREATE POLICY "Admins delete teachers"
  ON teachers FOR DELETE USING (is_admin());

-- ══════════════════════════════════════════════════════
-- STEP 5: CLASSES TABLE POLICIES
-- ══════════════════════════════════════════════════════

-- Keep: "Anyone can validate class codes" (students need this for code entry)
-- Add: teacher management policies

DROP POLICY IF EXISTS "Teachers manage own classes" ON classes;
CREATE POLICY "Teachers manage own classes"
  ON classes FOR INSERT WITH CHECK (
    teacher_id = get_teacher_id() OR is_admin()
  );

DROP POLICY IF EXISTS "Teachers update own classes" ON classes;
CREATE POLICY "Teachers update own classes"
  ON classes FOR UPDATE USING (
    teacher_id = get_teacher_id() OR is_admin()
  );

DROP POLICY IF EXISTS "Teachers delete own classes" ON classes;
CREATE POLICY "Teachers delete own classes"
  ON classes FOR DELETE USING (
    teacher_id = get_teacher_id() OR is_admin()
  );

-- ══════════════════════════════════════════════════════
-- STEP 6: REPLACE TEMP "ALLOW ALL" WITH SCOPED POLICIES
-- ══════════════════════════════════════════════════════

-- ── SCORES ──
DROP POLICY IF EXISTS "Temp: allow reading scores" ON scores;
DROP POLICY IF EXISTS "Students can submit scores" ON scores;

-- Students can only insert scores for active classes
CREATE POLICY "Students insert scores for active classes"
  ON scores FOR INSERT
  WITH CHECK (
    class_id IN (SELECT id FROM classes WHERE is_active = true)
  );

-- Teachers read only their own class scores
CREATE POLICY "Teachers read own class scores"
  ON scores FOR SELECT
  USING (
    class_id IN (SELECT get_my_class_ids())
    OR is_admin()
  );

-- ── QUIZ DETAIL ──
DROP POLICY IF EXISTS "Temp: allow reading quiz detail" ON quiz_detail;
DROP POLICY IF EXISTS "Students can submit quiz detail" ON quiz_detail;

CREATE POLICY "Students insert quiz detail for active classes"
  ON quiz_detail FOR INSERT
  WITH CHECK (
    class_id IN (SELECT id FROM classes WHERE is_active = true)
  );

CREATE POLICY "Teachers read own class quiz detail"
  ON quiz_detail FOR SELECT
  USING (
    class_id IN (SELECT get_my_class_ids())
    OR is_admin()
  );

-- ── CHECKPOINTS ──
DROP POLICY IF EXISTS "Temp: allow reading checkpoints" ON checkpoints;
DROP POLICY IF EXISTS "Students can submit checkpoints" ON checkpoints;

CREATE POLICY "Students insert checkpoints for active classes"
  ON checkpoints FOR INSERT
  WITH CHECK (
    class_id IN (SELECT id FROM classes WHERE is_active = true)
  );

CREATE POLICY "Teachers read own class checkpoints"
  ON checkpoints FOR SELECT
  USING (
    class_id IN (SELECT get_my_class_ids())
    OR is_admin()
  );

-- ── ACTIVITY ──
DROP POLICY IF EXISTS "Temp: allow reading activity" ON activity;
DROP POLICY IF EXISTS "Students can log activity" ON activity;

CREATE POLICY "Students insert activity for active classes"
  ON activity FOR INSERT
  WITH CHECK (
    class_id IN (SELECT id FROM classes WHERE is_active = true)
  );

CREATE POLICY "Teachers read own class activity"
  ON activity FOR SELECT
  USING (
    class_id IN (SELECT get_my_class_ids())
    OR is_admin()
  );

-- ══════════════════════════════════════════════════════
-- STEP 7: ACCESS LOGS TABLE (audit trail)
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_email TEXT,
  action TEXT NOT NULL,
  target_class_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE access_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins read access logs"
  ON access_logs FOR SELECT USING (is_admin());

CREATE POLICY "Authenticated users insert own logs"
  ON access_logs FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_access_logs_user ON access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_created ON access_logs(created_at);

-- ══════════════════════════════════════════════════════
-- DONE — Next steps:
-- 1. Create your teacher account in Supabase Auth (if not done)
-- 2. Insert teacher record:
--    INSERT INTO teachers (auth_user_id, email, display_name, is_admin) VALUES
--      ('your-auth-uuid', 'your-email@school.edu', 'Mr. England', true);
-- 3. Link existing classes to your teacher profile:
--    UPDATE classes SET teacher_id = (SELECT id FROM teachers WHERE is_admin = true);
-- ══════════════════════════════════════════════════════
