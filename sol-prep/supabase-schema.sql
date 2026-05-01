-- ================================================================
-- ⚠️  HISTORICAL — DO NOT RUN AGAINST PRODUCTION
-- ================================================================
-- This file was the Phase 1 bootstrap when SGHS was first wired to
-- Supabase. It has been SUPERSEDED by the numbered migrations under
-- migrations/ at the repo root:
--
--   001-rls-lockdown.sql       — proper RLS scoping
--   002-sso-foundation.sql     — students/student_classes + helpers
--   003-sso-activation-prep.sql — requires_sso flag + email sync
--   004-rls-phase2-lockdown.sql — dual-path INSERT policies
--   005-dsm-module-id-tracking.sql — scores.dsm_module_id column
--
-- Plus feature-additive migrations in this folder:
--   dsm-migration.sql, quiz-progress-migration.sql,
--   allow-retakes-migration.sql, mastery-threshold-migration.sql,
--   module-releases-migration.sql
--
-- Running this file against production WOULD:
--   - Re-create policies that have been deliberately replaced
--   - Re-seed Period 1-7 classes with hardcoded teacher_name='Mr. England'
--     and no teacher_id, breaking the Phase 2 RLS lockdown
--   - Drop and recreate tables in some cases, possibly losing data
--
-- Kept here only as reference for what the Phase 1 baseline looked
-- like, and so anyone setting up a fresh dev project from scratch
-- has a starting point. For prod, trust the migrations/ tree.
-- ================================================================
-- SGHS SOL Prep — Supabase Schema (Phase 1)
-- Run this in your Supabase SQL Editor after creating a new project.
-- ================================================================

-- ── CLASSES ─────────────────────────────────────────────────────
-- Each teacher creates classes; students join via class code.
-- Auto-generate a random 6-character class code (no ambiguous chars: 0/O/1/I/L removed)
CREATE OR REPLACE FUNCTION generate_class_code() RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  code TEXT := '';
  i INTEGER;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..6 LOOP
      code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    -- Ensure uniqueness
    EXIT WHEN NOT EXISTS (SELECT 1 FROM classes WHERE classes.code = code);
  END LOOP;
  RETURN code;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL DEFAULT generate_class_code(),  -- auto-generated 6-char code
  label TEXT NOT NULL,                  -- e.g. '3rd Period Biology'
  teacher_name TEXT NOT NULL,           -- e.g. 'Mr. England'
  school_year TEXT NOT NULL DEFAULT '2025-2026',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_classes_code ON classes(code);

-- ── SCORES ──────────────────────────────────────────────────────
-- One row per quiz/test completion (vocab quiz, unit practice test, or assigned test).
CREATE TABLE scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  module TEXT NOT NULL,                 -- e.g. 'SOL Prep — Unit 1: Scientific Investigation'
  lesson TEXT NOT NULL,                 -- e.g. 'Vocab Quiz', 'Practice Test'
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  pct INTEGER NOT NULL,
  time_on_quiz INTEGER,                -- seconds
  assignment_id TEXT,                   -- links to assigned practice tests
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scores_class ON scores(class_id);
CREATE INDEX idx_scores_student ON scores(class_id, student_name);

-- ── QUIZ DETAIL ─────────────────────────────────────────────────
-- One row per question answered (for per-question analytics).
CREATE TABLE quiz_detail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  module TEXT NOT NULL,
  lesson TEXT NOT NULL,
  q_num INTEGER NOT NULL,
  question_text TEXT,
  student_answer TEXT NOT NULL,
  correct_answer TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL,
  standard TEXT,                        -- e.g. 'BIO.3' (for practice test questions)
  assignment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_quiz_detail_class ON quiz_detail(class_id);
CREATE INDEX idx_quiz_detail_standard ON quiz_detail(class_id, standard);

-- ── CHECKPOINTS ─────────────────────────────────────────────────
-- Vocab quiz pass events and other checkpoint completions.
CREATE TABLE checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  module TEXT NOT NULL,
  lesson TEXT NOT NULL,
  response_text TEXT,
  score TEXT,                           -- e.g. '8/10'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_checkpoints_class ON checkpoints(class_id);

-- ── ACTIVITY ────────────────────────────────────────────────────
-- Page views, session tracking, module starts, score submissions.
CREATE TABLE activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  module TEXT NOT NULL,
  lesson TEXT,
  event TEXT NOT NULL,                  -- 'module_start', 'page_view', 'session_end', 'submit_score', etc.
  duration INTEGER,                     -- seconds
  metadata JSONB,                       -- flexible: stdBreakdown, panelLog, questionCount, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_class ON activity(class_id);
CREATE INDEX idx_activity_event ON activity(class_id, event);

-- ================================================================
-- ROW LEVEL SECURITY
-- Students (anonymous/anon key) can INSERT data and validate class codes.
-- Only authenticated users (Phase 2) can SELECT student data.
-- ================================================================

ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_detail ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

-- Classes: anon can read active classes (for code validation)
CREATE POLICY "Anyone can validate class codes"
  ON classes FOR SELECT
  USING (is_active = true);

-- Data tables: anon can insert (students submit scores)
CREATE POLICY "Students can submit scores"
  ON scores FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Students can submit quiz detail"
  ON quiz_detail FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Students can submit checkpoints"
  ON checkpoints FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Students can log activity"
  ON activity FOR INSERT
  WITH CHECK (true);

-- Data tables: only authenticated users can read (Phase 2 — teacher dashboard)
-- For now, allow all SELECT so you can verify data in the Supabase dashboard.
-- In Phase 2, replace these with teacher-scoped policies.
CREATE POLICY "Temp: allow reading scores"
  ON scores FOR SELECT USING (true);
CREATE POLICY "Temp: allow reading quiz detail"
  ON quiz_detail FOR SELECT USING (true);
CREATE POLICY "Temp: allow reading checkpoints"
  ON checkpoints FOR SELECT USING (true);
CREATE POLICY "Temp: allow reading activity"
  ON activity FOR SELECT USING (true);

-- ================================================================
-- SEED: Create your first classes (codes auto-generated)
-- Update these with your actual class periods and teacher names.
-- After running, query: SELECT code, label, teacher_name FROM classes;
-- to see the generated codes to give to your students.
-- ================================================================
INSERT INTO classes (label, teacher_name) VALUES
  ('Period 1 Biology', 'Mr. England'),
  ('Period 2 Biology', 'Mr. England'),
  ('Period 3 Biology', 'Mr. England'),
  ('Period 4 Biology', 'Mr. England'),
  ('Period 5 Biology', 'Mr. England'),
  ('Period 6 Biology', 'Mr. England'),
  ('Period 7 Biology', 'Mr. England');

-- To add a class for another teacher later:
-- INSERT INTO classes (label, teacher_name) VALUES ('Period 2 Biology', 'Mrs. Johnson');
-- The code column auto-generates. Query to see it:
-- SELECT code, label, teacher_name FROM classes ORDER BY teacher_name, label;
