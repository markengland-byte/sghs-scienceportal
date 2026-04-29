-- ================================================================
-- SGHS SOL Prep — Practice-test retake control
-- Run this in Supabase SQL Editor.
-- ================================================================
--
-- Adds allow_retakes flag on each class. When false, students who
-- already submitted a practice-test score for this class are blocked
-- from starting another. Default true preserves current behavior.

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS allow_retakes BOOLEAN NOT NULL DEFAULT true;

-- Quick toggle examples (for the SQL Editor — adjust the code as needed):
--
--   -- Lock period 7 to one attempt:
--   UPDATE classes SET allow_retakes = false WHERE code = 'ENG-7';
--
--   -- Re-open all periods:
--   UPDATE classes SET allow_retakes = true;
--
--   -- See current settings:
--   SELECT code, label, allow_retakes FROM classes ORDER BY code;
