-- ================================================================
-- SGHS Portal — DSM Module-ID tracking on scores (Audit finding #11)
-- Run this in Supabase SQL Editor.
--
-- Adds a nullable `dsm_module_id` column to the scores table so that
-- a student's Mastery Module pass is tied to the specific dsm_modules
-- row they passed against. When Mark republishes a DSM (new questions
-- via Gemini, new dsm_modules row), the lookup at init() time will no
-- longer match the old score row → student is correctly required to
-- retake against the new question set.
--
-- Backward compatibility: existing score rows have NULL in the new
-- column. The dsm-player.js lookup uses
--   dsm_module_id = <current_id> OR dsm_module_id IS NULL
-- so historical mastery (earned before this column existed) continues
-- to count, and any republish from this point forward correctly
-- invalidates only the scores tagged with the now-replaced module ID.
--
-- Non-destructive. Safe to run during school hours.
-- ================================================================

ALTER TABLE scores
  ADD COLUMN IF NOT EXISTS dsm_module_id UUID NULL;

-- Foreign key to dsm_modules — ON DELETE SET NULL so deleting a
-- DSM module doesn't cascade-delete student scores.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'scores' AND constraint_name = 'scores_dsm_module_id_fkey'
  ) THEN
    ALTER TABLE scores
      ADD CONSTRAINT scores_dsm_module_id_fkey
      FOREIGN KEY (dsm_module_id) REFERENCES dsm_modules(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Index for the lookup query at init() (filters by class, student,
-- module, lesson, AND optionally dsm_module_id). Plain index covers
-- both sides of the OR (= and IS NULL) without a partial.
CREATE INDEX IF NOT EXISTS idx_scores_dsm_module_id
  ON scores(dsm_module_id);

-- Verification
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'scores' AND column_name = 'dsm_module_id';

SELECT indexname FROM pg_indexes
WHERE tablename = 'scores' AND indexname = 'idx_scores_dsm_module_id';
