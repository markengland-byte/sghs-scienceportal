-- ================================================================
-- SGHS SOL Prep — Mastery completion threshold (per class)
-- Run this in Supabase SQL Editor.
-- ================================================================
--
-- Adds mastery_threshold to classes so each period can require
-- 85%, 90%, or 100% on a full DSM attempt before "Mastery Module"
-- counts as complete and the next-step panels unlock.
--
-- Default: 100% (preserves current behavior — student must answer
-- every DSM question correctly on a single full attempt).
--
-- Toggle examples:
--   UPDATE classes SET mastery_threshold = 85  WHERE code = 'ENG-3';
--   UPDATE classes SET mastery_threshold = 90  WHERE code = 'ENG-7';
--   UPDATE classes SET mastery_threshold = 100;  -- back to perfect
--
-- See current state:
--   SELECT code, label, mastery_threshold FROM classes ORDER BY code;

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS mastery_threshold INTEGER NOT NULL DEFAULT 100;

ALTER TABLE classes
  DROP CONSTRAINT IF EXISTS classes_mastery_threshold_chk;

ALTER TABLE classes
  ADD CONSTRAINT classes_mastery_threshold_chk
  CHECK (mastery_threshold IN (85, 90, 100));
