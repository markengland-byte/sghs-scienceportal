-- ================================================================
-- FERPA Phase 2 — Schema additions for self-contained RLS
-- ================================================================
-- Denormalize auth_user_id onto write tables so RLS can use a direct
-- equality (auth_user_id = auth.uid()) instead of a cross-table
-- subquery. Cross-table subqueries in RLS were the source of the
-- 2026-04-29 phantom-state bug that nuked data on these same 5 tables.
--
-- Nullable for now: legacy-only students (no SSO row) keep their old
-- rows readable through teacher endpoints. New writes populate the
-- field via the updated sol-api.js client (commit 8a61d4e).
--
-- Companion migration: 008-ferpa-phase2-rls-lockdown.sql replaces
-- the wide/cross-table policies with `auth.uid() = auth_user_id`.
-- ================================================================

ALTER TABLE scores       ADD COLUMN IF NOT EXISTS auth_user_id UUID;
ALTER TABLE quiz_detail  ADD COLUMN IF NOT EXISTS auth_user_id UUID;
ALTER TABLE checkpoints  ADD COLUMN IF NOT EXISTS auth_user_id UUID;
ALTER TABLE activity     ADD COLUMN IF NOT EXISTS auth_user_id UUID;
ALTER TABLE dsm_attempts ADD COLUMN IF NOT EXISTS auth_user_id UUID;

CREATE INDEX IF NOT EXISTS idx_scores_auth_user       ON scores(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_detail_auth_user  ON quiz_detail(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_auth_user  ON checkpoints(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_activity_auth_user     ON activity(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_dsm_attempts_auth_user ON dsm_attempts(auth_user_id);

-- One-shot backfill for existing rows. Joins through the canonical
-- student_id linkage so SSO students get tied to their auth.uid().
-- Rows without student_id (legacy-only students who never signed in)
-- stay NULL — they're readable to teachers via service-role endpoints.
UPDATE scores t       SET auth_user_id = s.auth_user_id FROM students s WHERE t.student_id = s.id AND t.auth_user_id IS NULL;
UPDATE quiz_detail t  SET auth_user_id = s.auth_user_id FROM students s WHERE t.student_id = s.id AND t.auth_user_id IS NULL;
UPDATE checkpoints t  SET auth_user_id = s.auth_user_id FROM students s WHERE t.student_id = s.id AND t.auth_user_id IS NULL;
UPDATE activity t     SET auth_user_id = s.auth_user_id FROM students s WHERE t.student_id = s.id AND t.auth_user_id IS NULL;
UPDATE dsm_attempts t SET auth_user_id = s.auth_user_id FROM students s WHERE t.student_id = s.id AND t.auth_user_id IS NULL;

NOTIFY pgrst, 'reload schema';
