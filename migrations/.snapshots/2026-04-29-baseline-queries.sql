-- ================================================================
-- Phase A3 baseline snapshot — RLS policy state on the 5 tables
-- that have hit phantom-state.
--
-- Run this in Supabase SQL Editor RIGHT NOW, while everything is
-- working. Copy each result block into 2026-04-29-prod-policies.txt
-- in this folder. This is the before-picture; next time phantom-state
-- recurs, you diff against this to find what changed.
--
-- Tables under audit: scores, quiz_detail, checkpoints, activity, dsm_attempts
-- (quiz_progress and module_releases are NOT under audit because they
-- have single-source migrations and have not exhibited the bug.)
-- ================================================================

-- 1. POLICIES — full picture including the RESTRICTIVE flag.
--    polpermissive = false means RESTRICTIVE; that's the smoking gun if
--    one shows up unexpected.
SELECT pc.relname AS table_name,
       pol.polname,
       CASE pol.polcmd
         WHEN 'r' THEN 'SELECT'
         WHEN 'a' THEN 'INSERT'
         WHEN 'w' THEN 'UPDATE'
         WHEN 'd' THEN 'DELETE'
         WHEN '*' THEN 'ALL'
       END AS cmd,
       pol.polpermissive AS is_permissive,
       pol.polroles::regrole[] AS roles,
       pg_get_expr(pol.polqual, pol.polrelid)      AS using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr
FROM pg_policy pol
JOIN pg_class pc ON pc.oid = pol.polrelid
WHERE pc.relname IN ('scores','quiz_detail','checkpoints','activity','dsm_attempts')
ORDER BY pc.relname, cmd, pol.polname;

-- 2. RLS state — confirm enabled and not forced (forced would block
--    even the table owner, which is unusual and worth knowing).
SELECT relname,
       relrowsecurity     AS rls_enabled,
       relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relname IN ('scores','quiz_detail','checkpoints','activity','dsm_attempts')
ORDER BY relname;

-- 3. TRIGGERS — a BEFORE INSERT trigger that returns NULL would silently
--    drop rows the same way RLS does, so verify nothing unexpected is
--    attached. tgisinternal=false filters out FK constraint triggers.
SELECT pc.relname AS table_name,
       tg.tgname,
       CASE WHEN (tg.tgtype & 2) = 2 THEN 'BEFORE'
            WHEN (tg.tgtype & 64) = 64 THEN 'INSTEAD OF'
            ELSE 'AFTER' END AS timing,
       CASE WHEN (tg.tgtype & 4) = 4 THEN 'INSERT'
            WHEN (tg.tgtype & 8) = 8 THEN 'DELETE'
            WHEN (tg.tgtype & 16) = 16 THEN 'UPDATE'
            ELSE 'OTHER' END AS event,
       tg.tgenabled
FROM pg_trigger tg
JOIN pg_class pc ON pc.oid = tg.tgrelid
WHERE pc.relname IN ('scores','quiz_detail','checkpoints','activity','dsm_attempts')
  AND NOT tg.tgisinternal
ORDER BY pc.relname, tg.tgname;

-- 4. ROLE GRANTS — RLS only applies if anon/authenticated has the
--    table-level privilege in the first place. If anon lost INSERT
--    via a stray REVOKE, RLS-cycle won't fix it; you'd need GRANT.
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name IN ('scores','quiz_detail','checkpoints','activity','dsm_attempts')
  AND grantee IN ('anon','authenticated','public','service_role')
ORDER BY table_name, grantee, privilege_type;

-- 5. ROW COUNT SANITY — confirms data is actually flowing post-fix.
--    All five should be > 0 since 2026-04-29.
SELECT 'scores'        AS table_name, count(*) AS rows, max(created_at) AS last_write FROM scores
UNION ALL SELECT 'quiz_detail',       count(*), max(created_at) FROM quiz_detail
UNION ALL SELECT 'checkpoints',       count(*), max(created_at) FROM checkpoints
UNION ALL SELECT 'activity',          count(*), max(created_at) FROM activity
UNION ALL SELECT 'dsm_attempts',      count(*), max(created_at) FROM dsm_attempts;
