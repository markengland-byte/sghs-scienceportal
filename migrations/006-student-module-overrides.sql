-- ================================================================
-- SGHS SOL Prep — Per-student module overrides (Phase B)
-- ================================================================
--
-- Adds per-(student, module) lock/unlock overrides on top of the
-- global module_releases table. Resolution order at read time:
--
--   1. If a row exists in student_module_overrides for
--      (student_id, module_key) -> use that row's `unlocked` value
--   2. Otherwise -> fall back to module_releases.unlocked
--
-- Both directions are supported: force-OPEN (unlocked=true) for a
-- student even when the class default is locked, AND force-CLOSED
-- (unlocked=false) for a student even when the class default is open.
--
-- No auto-expire. Teacher manually adds, flips, or removes rows
-- via the dashboard 3-state matrix. Removing the row drops the
-- student back to the global default.
--
-- This feature requires SSO to be active — without auth.uid() the
-- client has no way to look up "my overrides". `requires_sso=true`
-- was flipped on all 7 ENG-* classes 2026-05-02 (same day).
-- ================================================================

CREATE TABLE IF NOT EXISTS student_module_overrides (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  module_key  TEXT NOT NULL,
  unlocked    BOOLEAN NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT student_module_overrides_module_key_check
    CHECK (module_key IN (
      'unit-1','unit-2','unit-3','unit-4',
      'unit-5','unit-6','unit-7','unit-8',
      'practice-test'
    )),
  CONSTRAINT student_module_overrides_unique
    UNIQUE (student_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_student_module_overrides_student
  ON student_module_overrides (student_id);

-- Auto-bump updated_at on UPDATE.
CREATE OR REPLACE FUNCTION student_module_overrides_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_student_module_overrides_updated_at
  ON student_module_overrides;
CREATE TRIGGER trg_student_module_overrides_updated_at
  BEFORE UPDATE ON student_module_overrides
  FOR EACH ROW EXECUTE FUNCTION student_module_overrides_touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────
-- SELECT: a student can read THEIR OWN overrides (so the unit page
--   can resolve unlock state on load). Admins can read all.
-- INSERT/UPDATE/DELETE: deliberately have no anon/student policy.
--   All writes go through /api/teacher/student-override which uses
--   the service-role key after JWT-verifying the requester is a
--   teacher (same pattern as /api/teacher/{scores,activity,...}).
--   Default-deny is the right answer here: a student must NEVER be
--   able to grant themselves access to a locked unit.
ALTER TABLE student_module_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students read own overrides" ON student_module_overrides;
CREATE POLICY "Students read own overrides"
  ON student_module_overrides FOR SELECT
  USING (
    student_id IN (
      SELECT id FROM students WHERE auth_user_id = auth.uid()
    )
    OR is_admin()
  );

-- Tell PostgREST to reload its schema cache so the new table is
-- immediately reachable from the REST API without a service restart.
NOTIFY pgrst, 'reload schema';
