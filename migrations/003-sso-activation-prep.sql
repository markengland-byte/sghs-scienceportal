-- ================================================================
-- SGHS Portal — SSO Activation Prep (Evening 1 of SSO-ACTIVATION-PLAN.md)
-- Run this in Supabase SQL Editor.
--
-- Non-destructive. Safe to run during school hours.
--
--   1. Fix the existing teachers row's email column to match what
--      Google returns at sign-in. The auth_user_id link is already
--      correct, so is_admin() works regardless — this is just for
--      consistency in the dashboard's "logged in as" display.
--   2. Add classes.requires_sso flag so we can pilot one class
--      before flipping the rest.
--
-- This migration does NOT change any RLS policies. The lockdown
-- migration is a separate file run later (Evening 4 of the plan).
-- ================================================================

-- ── 1. Sync teachers.email with auth.users.email ────────────────
-- The current teachers row predates SSO and has a stale email.
-- This UPDATE fixes the cosmetic mismatch. auth_user_id link
-- (the load-bearing one for is_admin()) is already correct.

UPDATE teachers
SET email = u.email
FROM auth.users u
WHERE teachers.auth_user_id = u.id
  AND teachers.email <> u.email;

-- ── 2. Add per-class SSO rollout flag ────────────────────────────
-- When false (default), legacy name-modal flow is allowed.
-- When true, only SSO writes are accepted.
-- Per-class so we can pilot ENG-1 (or whichever) before sweeping
-- the rest. Set to true via UPDATE classes SET requires_sso = true
-- WHERE code = 'ENG-1' once the unit pages are wired.

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS requires_sso BOOLEAN NOT NULL DEFAULT false;

-- ── 3. Verify ────────────────────────────────────────────────────
-- After running, this should show your teachers row matched and
-- requires_sso = false on every class.

SELECT t.email AS teachers_email, t.is_admin, u.email AS auth_email,
       (t.auth_user_id = u.id) AS matched
FROM teachers t
JOIN auth.users u ON u.id = t.auth_user_id;

SELECT code, label, requires_sso
FROM classes
ORDER BY code;
