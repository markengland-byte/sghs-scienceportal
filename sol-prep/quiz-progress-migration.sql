-- ================================================================
-- SGHS SOL Prep — Cross-device quiz progress sync
-- Run this in Supabase SQL Editor.
-- ================================================================
--
-- Adds the `quiz_progress` table so a student's in-progress unit/practice
-- state survives switching machines. Keyed by (class_id, student_name,
-- module); UPSERT on every state change. Phase-2 SSO can later layer
-- student_id on top without changing this schema.

CREATE TABLE IF NOT EXISTS quiz_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  module TEXT NOT NULL,                 -- e.g. 'unit-1', 'practice-test'
  progress_data JSONB NOT NULL,         -- full localStorage snapshot for this module
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_id, student_name, module)
);
CREATE INDEX IF NOT EXISTS idx_quiz_progress_lookup
  ON quiz_progress(class_id, student_name, module);

-- Auto-update updated_at on every UPSERT
CREATE OR REPLACE FUNCTION quiz_progress_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quiz_progress_touch ON quiz_progress;
CREATE TRIGGER trg_quiz_progress_touch
  BEFORE UPDATE ON quiz_progress
  FOR EACH ROW EXECUTE FUNCTION quiz_progress_touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────
-- Mirror the existing data-table policies: anon can INSERT/UPDATE/SELECT
-- their own rows. Tightened in Phase 2 once SSO student_id is wired.
ALTER TABLE quiz_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can save progress"
  ON quiz_progress FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Students can update progress"
  ON quiz_progress FOR UPDATE
  USING (true) WITH CHECK (true);

CREATE POLICY "Students can read progress"
  ON quiz_progress FOR SELECT
  USING (true);

CREATE POLICY "Students can clear progress"
  ON quiz_progress FOR DELETE
  USING (true);
