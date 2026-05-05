-- ================================================================
-- Assignments table — teacher-created SOL practice test assignments
-- Run in Supabase SQL Editor. Non-destructive.
-- ================================================================

CREATE TABLE assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id),
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'random' CHECK (mode IN ('random', 'fixed')),
  seed INTEGER,
  question_count INTEGER NOT NULL DEFAULT 50 CHECK (question_count BETWEEN 5 AND 100),
  std_targets JSONB NOT NULL DEFAULT '{"BIO.1":8,"BIO.2":7,"BIO.3":7,"BIO.4":4,"BIO.5":7,"BIO.6":6,"BIO.7":6,"BIO.8":5}',
  allow_retake BOOLEAN NOT NULL DEFAULT true,
  due_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assignments_class ON assignments(class_id);

ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

-- Students (anon key) can read active assignments so practice-test.html
-- can fetch the assignment config when a student opens the link.
CREATE POLICY "anon_read_active" ON assignments FOR SELECT
  USING (is_active = true);

-- Teachers can create, update, and delete assignments.
-- The dashboard uses the authenticated Supabase client.
CREATE POLICY "teacher_insert" ON assignments FOR INSERT
  WITH CHECK (true);
CREATE POLICY "teacher_update" ON assignments FOR UPDATE
  USING (true);
CREATE POLICY "teacher_delete" ON assignments FOR DELETE
  USING (true);
