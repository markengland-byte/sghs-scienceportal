-- ================================================================
-- SGHS SOL Prep — Phase 2 Migration: Teacher Auth & Dashboard
-- Run this in Supabase SQL Editor AFTER Phase 1 schema is in place.
-- ================================================================

-- ── STEP 1: TEACHERS TABLE (must exist before functions) ───────
CREATE TABLE teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,           -- e.g. 'Mr. England'
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;

-- ── STEP 2: LINK CLASSES TO TEACHERS ───────────────────────────
ALTER TABLE classes ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL;

-- ── STEP 3: HELPER FUNCTIONS (bypass RLS for policy checks) ────
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

-- ── STEP 4: RLS POLICIES ───────────────────────────────────────

-- Teachers table policies
CREATE POLICY "Teachers read own or admin reads all"
  ON teachers FOR SELECT
  USING (auth_user_id = auth.uid() OR is_admin());

CREATE POLICY "Admins manage teachers"
  ON teachers FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "Admins update teachers"
  ON teachers FOR UPDATE USING (is_admin());
CREATE POLICY "Admins delete teachers"
  ON teachers FOR DELETE USING (is_admin());

-- Classes table policies (teacher/admin management)
CREATE POLICY "Teachers manage own classes"
  ON classes FOR INSERT WITH CHECK (
    teacher_id = get_teacher_id() OR is_admin()
  );
CREATE POLICY "Teachers update own classes"
  ON classes FOR UPDATE USING (
    teacher_id = get_teacher_id() OR is_admin()
  );
CREATE POLICY "Teachers delete own classes"
  ON classes FOR DELETE USING (
    teacher_id = get_teacher_id() OR is_admin()
  );

-- Replace temp "allow all reads" with teacher-scoped reads
DROP POLICY IF EXISTS "Temp: allow reading scores" ON scores;
DROP POLICY IF EXISTS "Temp: allow reading quiz detail" ON quiz_detail;
DROP POLICY IF EXISTS "Temp: allow reading checkpoints" ON checkpoints;
DROP POLICY IF EXISTS "Temp: allow reading activity" ON activity;

CREATE POLICY "Teachers read own class scores"
  ON scores FOR SELECT
  USING (class_id IN (SELECT get_my_class_ids()));

CREATE POLICY "Teachers read own class quiz detail"
  ON quiz_detail FOR SELECT
  USING (class_id IN (SELECT get_my_class_ids()));

CREATE POLICY "Teachers read own class checkpoints"
  ON checkpoints FOR SELECT
  USING (class_id IN (SELECT get_my_class_ids()));

CREATE POLICY "Teachers read own class activity"
  ON activity FOR SELECT
  USING (class_id IN (SELECT get_my_class_ids()));

-- ================================================================
-- ADMIN SETUP (run these manually after the migration above)
-- ================================================================
-- 1. Go to Supabase → Authentication → Users → Add user
--    Enter your email and a password.
-- 2. Copy the user's UUID from the Users list.
-- 3. Run (replace the UUID and email):
--
-- INSERT INTO teachers (auth_user_id, email, display_name, is_admin) VALUES
--   ('your-auth-uuid-here', 'your-email@school.edu', 'Mr. England', true);
--
-- 4. Link your existing classes to your teacher profile:
--
-- UPDATE classes SET teacher_id = (SELECT id FROM teachers WHERE is_admin = true);
