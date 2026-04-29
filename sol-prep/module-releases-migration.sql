-- ================================================================
-- SGHS SOL Prep — Per-module release gating
-- Run this in Supabase SQL Editor.
-- ================================================================
--
-- Adds the module_releases table so teachers can lock/unlock each
-- unit + the standalone practice-test independently. Students see
-- a "Not yet open — talk to your teacher" full-page overlay until
-- the row is flipped to unlocked = true.
--
-- Default state: unit-1 open (Period 3 currently using it), all
-- others locked. Flip the rest by running SQL like:
--
--   UPDATE module_releases
--      SET unlocked = true, unlocked_at = now()
--    WHERE module_key = 'unit-2';
--
-- Quick view of current state:
--   SELECT module_key, unlocked, unlocked_at FROM module_releases
--    ORDER BY module_key;

CREATE TABLE IF NOT EXISTS module_releases (
  module_key TEXT PRIMARY KEY,
  unlocked BOOLEAN NOT NULL DEFAULT false,
  unlocked_at TIMESTAMPTZ,
  notes TEXT
);

-- Seed all 9 rows. ON CONFLICT keeps existing values if you re-run.
INSERT INTO module_releases (module_key, unlocked, unlocked_at) VALUES
  ('unit-1', true, now()),  -- currently in use
  ('unit-2', false, null),
  ('unit-3', false, null),
  ('unit-4', false, null),
  ('unit-5', false, null),
  ('unit-6', false, null),
  ('unit-7', false, null),
  ('unit-8', false, null),
  ('practice-test', false, null)
ON CONFLICT (module_key) DO NOTHING;

-- ── RLS ─────────────────────────────────────────────────────────
-- SELECT public — every student needs to read the lock state on
-- page load. INSERT/UPDATE/DELETE deliberately have no anon policy:
-- only the SQL Editor (service_role) or an authenticated teacher
-- session can flip them. Prevents a student with the anon key from
-- unlocking modules from their browser console.
ALTER TABLE module_releases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read release state" ON module_releases;
CREATE POLICY "Anyone can read release state"
  ON module_releases FOR SELECT
  USING (true);
