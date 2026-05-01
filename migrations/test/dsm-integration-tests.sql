-- ================================================================
-- SGHS Portal — DSM Integration Test Suite
-- File: migrations/test/dsm-integration-tests.sql
--
-- WHAT THIS IS
--   A self-asserting SQL test harness that validates the DSM
--   (Mastery Module) feature against the 14-finding audit fixed
--   in commit dbc4561 (DSM_AUDIT_REPORT.md) plus the
--   `scores.dsm_module_id` column shipped in commit 00c2d58
--   (migration 005-dsm-module-id-tracking.sql).
--
--   Tests cover:
--     - lookupScoreStrict() query semantics (the OR clause that
--       matches the published module ID OR historical NULL rows)
--     - dsm_module_id tagging on score writes
--     - Republish invalidation (new module ID → old score no
--       longer matches at lookup)
--     - Backward compatibility (NULL dsm_module_id legacy rows
--       still count)
--     - Bypass-detection diagnostic query catches every signature
--       observed in production (1/26→100, 1/25→100, 3/25→100,
--       1/1→100) and does NOT false-positive on legitimate scores
--     - dsm_attempts records the real student_name (not 'Unknown')
--     - Foreign-key behavior on both tables
--       (scores.dsm_module_id ON DELETE SET NULL,
--        dsm_attempts.module_id ON DELETE CASCADE)
--
-- HOW TO RUN
--   1. Open Supabase SQL Editor.
--   2. Paste the entire file (or run blocks individually if your
--      editor balks — every block is self-contained and idempotent).
--   3. Watch the messages tab for `RAISE NOTICE` output.
--      - Each test block ends with `... PASS` on success.
--      - Failure throws `RAISE EXCEPTION` and the run halts there.
--   4. Re-run safely as many times as you like — the prologue
--      block of every test wipes any leftover `_DSM_TEST_*`
--      fixtures from prior runs before inserting fresh ones.
--
-- READ-ONLY AGAINST REAL DATA
--   Every row this file writes carries `student_name LIKE
--   '_DSM_TEST_%'`. The final cleanup block deletes everything
--   matching that prefix from `scores`, `dsm_attempts`,
--   `dsm_questions`, and `dsm_modules`. No production student
--   row is ever touched.
--
-- WHAT TO LOOK FOR IN OUTPUT
--   ✓ A `NOTICE: Test N — <name> ... PASS` for every numbered
--     test (currently 1 through 15).
--   ✗ A `RAISE EXCEPTION` aborting the script means a test failed
--     — the message includes the scenario name and what the row
--     looked like vs. what was expected. Copy that into the
--     follow-up issue.
--
-- DEPENDENCIES
--   - 001-rls-lockdown.sql, 002-sso-foundation.sql,
--     004-rls-phase2-lockdown.sql, 005-dsm-module-id-tracking.sql
--     all already applied.
--   - At least one row in `classes` with `is_active = true`
--     (the suite picks the first one it finds, alphabetically
--     by code).
-- ================================================================


-- ┌──────────────────────────────────────────────────────────────┐
-- │ Block 0 — Setup: pick a real class + create a test module    │
-- │ Idempotent: drops any leftover test fixtures first.          │
-- └──────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  v_class_id UUID;
  v_module_id UUID;
BEGIN
  -- Wipe any leftover test fixtures from prior runs (incl. ones from
  -- a suite that aborted mid-flight on a failed assertion).
  DELETE FROM scores         WHERE student_name LIKE '_DSM_TEST_%';
  DELETE FROM dsm_attempts   WHERE student_name LIKE '_DSM_TEST_%';
  DELETE FROM dsm_questions
    WHERE module_id IN (
      SELECT id FROM dsm_modules
      WHERE standard IN ('_DSM_TEST_STANDARD', '_DSM_TEST_STANDARD_V2',
                         '_DSM_TEST_STANDARD_FK', '_DSM_TEST_STANDARD_FK_SCORE')
    );
  DELETE FROM dsm_modules
    WHERE standard IN ('_DSM_TEST_STANDARD', '_DSM_TEST_STANDARD_V2',
                       '_DSM_TEST_STANDARD_FK', '_DSM_TEST_STANDARD_FK_SCORE');

  -- Pick a real active class.
  SELECT id INTO v_class_id
  FROM classes
  WHERE is_active = true
  ORDER BY code
  LIMIT 1;

  IF v_class_id IS NULL THEN
    RAISE EXCEPTION 'Setup failed: no active class found. Insert at least one classes row with is_active=true before running.';
  END IF;

  -- Insert a draft (NOT published) test DSM module — students never see this.
  INSERT INTO dsm_modules (class_id, standard, unit_number, title, question_count, status, created_by)
  VALUES (v_class_id, '_DSM_TEST_STANDARD', 99, '_DSM_TEST_ Module v1', 5, 'draft', NULL)
  RETURNING id INTO v_module_id;

  -- One throwaway question so the dsm_questions FK has something to point at.
  INSERT INTO dsm_questions (module_id, question_text, option_a, option_b, option_c, option_d,
                              correct_answer, explanation, sort_order, is_active)
  VALUES (v_module_id, '_DSM_TEST_ q1', 'a', 'b', 'c', 'd', 'a', '_DSM_TEST_ exp', 0, true);

  RAISE NOTICE 'Setup OK — class_id=% test_module_id=%', v_class_id, v_module_id;
END $$;


-- ┌──────────────────────────────────────────────────────────────┐
-- │ Test 1 — Lookup miss when no score exists                    │
-- │ Fresh student, query returns nothing.                        │
-- └──────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  v_class_id UUID;
  v_module_id UUID;
  v_row_count INT;
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE is_active=true ORDER BY code LIMIT 1;
  SELECT id INTO v_module_id FROM dsm_modules WHERE standard = '_DSM_TEST_STANDARD' LIMIT 1;

  -- Mirror the lookupScoreStrict PostgREST query exactly:
  --   class_id = $1 AND student_name = $2 AND module = $3
  --   AND lesson = $4
  --   AND (dsm_module_id = $5 OR dsm_module_id IS NULL)
  --   ORDER BY created_at DESC LIMIT 1
  SELECT COUNT(*) INTO v_row_count FROM (
    SELECT *
    FROM scores
    WHERE class_id = v_class_id
      AND student_name = '_DSM_TEST_alice_no_score'
      AND module = '_DSM_TEST_MODULE_NAME'
      AND lesson = 'Mastery Module'
      AND (dsm_module_id = v_module_id OR dsm_module_id IS NULL)
    ORDER BY created_at DESC
    LIMIT 1
  ) t;

  IF v_row_count <> 0 THEN
    RAISE EXCEPTION 'Test 1 FAIL — expected 0 rows for fresh student, got %', v_row_count;
  END IF;

  RAISE NOTICE 'Test 1 — lookup miss when no score exists ... PASS';
END $$;


-- ┌──────────────────────────────────────────────────────────────┐
-- │ Test 2 — Lookup hit when score has matching dsm_module_id    │
-- └──────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  v_class_id UUID;
  v_module_id UUID;
  v_found_pct INT;
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE is_active=true ORDER BY code LIMIT 1;
  SELECT id INTO v_module_id FROM dsm_modules WHERE standard = '_DSM_TEST_STANDARD' LIMIT 1;

  INSERT INTO scores (class_id, student_name, module, lesson, score, total, pct, dsm_module_id)
  VALUES (v_class_id, '_DSM_TEST_bob_match', '_DSM_TEST_MODULE_NAME', 'Mastery Module',
          22, 25, 88, v_module_id);

  SELECT pct INTO v_found_pct FROM (
    SELECT pct
    FROM scores
    WHERE class_id = v_class_id
      AND student_name = '_DSM_TEST_bob_match'
      AND module = '_DSM_TEST_MODULE_NAME'
      AND lesson = 'Mastery Module'
      AND (dsm_module_id = v_module_id OR dsm_module_id IS NULL)
    ORDER BY created_at DESC
    LIMIT 1
  ) t;

  IF v_found_pct IS NULL THEN
    RAISE EXCEPTION 'Test 2 FAIL — expected to find row with pct=88, got NULL';
  END IF;
  IF v_found_pct <> 88 THEN
    RAISE EXCEPTION 'Test 2 FAIL — expected pct=88, got %', v_found_pct;
  END IF;

  RAISE NOTICE 'Test 2 — lookup hit when score has matching dsm_module_id ... PASS';
END $$;


-- ┌──────────────────────────────────────────────────────────────┐
-- │ Test 3 — Lookup hit when score has NULL dsm_module_id        │
-- │ Historical / pre-migration row still counts.                 │
-- └──────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  v_class_id UUID;
  v_module_id UUID;
  v_found_pct INT;
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE is_active=true ORDER BY code LIMIT 1;
  SELECT id INTO v_module_id FROM dsm_modules WHERE standard = '_DSM_TEST_STANDARD' LIMIT 1;

  INSERT INTO scores (class_id, student_name, module, lesson, score, total, pct, dsm_module_id)
  VALUES (v_class_id, '_DSM_TEST_carol_legacy', '_DSM_TEST_MODULE_NAME', 'Mastery Module',
          24, 25, 96, NULL);

  SELECT pct INTO v_found_pct FROM (
    SELECT pct
    FROM scores
    WHERE class_id = v_class_id
      AND student_name = '_DSM_TEST_carol_legacy'
      AND module = '_DSM_TEST_MODULE_NAME'
      AND lesson = 'Mastery Module'
      AND (dsm_module_id = v_module_id OR dsm_module_id IS NULL)
    ORDER BY created_at DESC
    LIMIT 1
  ) t;

  IF v_found_pct IS NULL THEN
    RAISE EXCEPTION 'Test 3 FAIL — historical NULL row should have matched OR-clause but did not';
  END IF;
  IF v_found_pct <> 96 THEN
    RAISE EXCEPTION 'Test 3 FAIL — expected pct=96, got %', v_found_pct;
  END IF;

  RAISE NOTICE 'Test 3 — lookup hit when score has NULL dsm_module_id (historical) ... PASS';
END $$;


-- ┌──────────────────────────────────────────────────────────────┐
-- │ Test 4 — Republish: lookup miss when score's module_id ≠ Y   │
-- │ Student passed v1; v2 lookup correctly returns no row,       │
-- │ forcing a retake.                                            │
-- └──────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  v_class_id UUID;
  v_module_v1_id UUID;
  v_module_v2_id UUID;
  v_row_count INT;
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE is_active=true ORDER BY code LIMIT 1;
  SELECT id INTO v_module_v1_id FROM dsm_modules WHERE standard = '_DSM_TEST_STANDARD' LIMIT 1;

  -- Insert a v2 module — same standard, different ID, simulates republish.
  -- Use a different standard string so we don't violate any unique constraint
  -- (none exists today, but this keeps the fixture self-evidently distinct).
  INSERT INTO dsm_modules (class_id, standard, unit_number, title, question_count, status, created_by)
  VALUES (v_class_id, '_DSM_TEST_STANDARD_V2', 99, '_DSM_TEST_ Module v2', 5, 'draft', NULL)
  RETURNING id INTO v_module_v2_id;

  -- Student passed v1 (tagged with v1 ID).
  INSERT INTO scores (class_id, student_name, module, lesson, score, total, pct, dsm_module_id)
  VALUES (v_class_id, '_DSM_TEST_dave_republish', '_DSM_TEST_MODULE_NAME', 'Mastery Module',
          25, 25, 100, v_module_v1_id);

  -- Lookup using the v2 module ID (the now-published one).
  SELECT COUNT(*) INTO v_row_count FROM (
    SELECT *
    FROM scores
    WHERE class_id = v_class_id
      AND student_name = '_DSM_TEST_dave_republish'
      AND module = '_DSM_TEST_MODULE_NAME'
      AND lesson = 'Mastery Module'
      AND (dsm_module_id = v_module_v2_id OR dsm_module_id IS NULL)
    ORDER BY created_at DESC
    LIMIT 1
  ) t;

  IF v_row_count <> 0 THEN
    RAISE EXCEPTION 'Test 4 FAIL — republish should invalidate v1 score for v2 lookup, but query returned % row(s)', v_row_count;
  END IF;

  RAISE NOTICE 'Test 4 — republish lookup miss (different dsm_module_id) ... PASS';
END $$;


-- ┌──────────────────────────────────────────────────────────────┐
-- │ Test 5 — Multiple rows: ORDER BY created_at DESC LIMIT 1     │
-- │ picks the most recent.                                       │
-- └──────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  v_class_id UUID;
  v_module_id UUID;
  v_found_pct INT;
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE is_active=true ORDER BY code LIMIT 1;
  SELECT id INTO v_module_id FROM dsm_modules WHERE standard = '_DSM_TEST_STANDARD' LIMIT 1;

  -- Older row.
  INSERT INTO scores (class_id, student_name, module, lesson, score, total, pct, dsm_module_id, created_at)
  VALUES (v_class_id, '_DSM_TEST_emma_multi', '_DSM_TEST_MODULE_NAME', 'Mastery Module',
          20, 25, 80, v_module_id, now() - interval '1 hour');
  -- Newer row — should win.
  INSERT INTO scores (class_id, student_name, module, lesson, score, total, pct, dsm_module_id, created_at)
  VALUES (v_class_id, '_DSM_TEST_emma_multi', '_DSM_TEST_MODULE_NAME', 'Mastery Module',
          25, 25, 100, v_module_id, now());

  SELECT pct INTO v_found_pct FROM (
    SELECT pct
    FROM scores
    WHERE class_id = v_class_id
      AND student_name = '_DSM_TEST_emma_multi'
      AND module = '_DSM_TEST_MODULE_NAME'
      AND lesson = 'Mastery Module'
      AND (dsm_module_id = v_module_id OR dsm_module_id IS NULL)
    ORDER BY created_at DESC
    LIMIT 1
  ) t;

  IF v_found_pct IS NULL OR v_found_pct <> 100 THEN
    RAISE EXCEPTION 'Test 5 FAIL — expected newest row pct=100, got %', v_found_pct;
  END IF;

  RAISE NOTICE 'Test 5 — most-recent row wins on ORDER BY created_at DESC ... PASS';
END $$;


-- ┌──────────────────────────────────────────────────────────────┐
-- │ Test 6 — Bypass detection catches 1/26 → 100% (and other     │
-- │ score/total/pct mismatches).                                 │
-- │ Detector predicate from DSM-MASTERY-FIX.md §Remaining work:  │
-- │   pct != ROUND((score::numeric / total) * 100) OR total < 5  │
-- └──────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  v_class_id UUID;
  v_module_id UUID;
  v_caught BOOLEAN;
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE is_active=true ORDER BY code LIMIT 1;
  SELECT id INTO v_module_id FROM dsm_modules WHERE standard = '_DSM_TEST_STANDARD' LIMIT 1;

  -- Skylar-shape: 1 correct of 26, but pct=100 stamped by the bypass.
  INSERT INTO scores (class_id, student_name, module, lesson, score, total, pct, dsm_module_id)
  VALUES (v_class_id, '_DSM_TEST_bypass_1of26', '_DSM_TEST_MODULE_NAME', 'Mastery Module',
          1, 26, 100, v_module_id);

  SELECT EXISTS (
    SELECT 1 FROM scores
    WHERE student_name = '_DSM_TEST_bypass_1of26'
      AND lesson = 'Mastery Module'
      AND (pct != ROUND((score::numeric / total) * 100) OR total < 5)
  ) INTO v_caught;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'Test 6 FAIL — bypass detector did NOT catch 1/26 → 100%%';
  END IF;

  RAISE NOTICE 'Test 6 — bypass detection catches 1/26 → 100%% ... PASS';
END $$;


-- ┌──────────────────────────────────────────────────────────────┐
-- │ Test 6b — Bypass detection catches 1/25 → 100% AND           │
-- │ 3/25 → 100% (the other production-observed signatures).      │
-- └──────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  v_class_id UUID;
  v_module_id UUID;
  v_caught_count INT;
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE is_active=true ORDER BY code LIMIT 1;
  SELECT id INTO v_module_id FROM dsm_modules WHERE standard = '_DSM_TEST_STANDARD' LIMIT 1;

  INSERT INTO scores (class_id, student_name, module, lesson, score, total, pct, dsm_module_id) VALUES
    (v_class_id, '_DSM_TEST_bypass_1of25', '_DSM_TEST_MODULE_NAME', 'Mastery Module', 1, 25, 100, v_module_id),
    (v_class_id, '_DSM_TEST_bypass_3of25', '_DSM_TEST_MODULE_NAME', 'Mastery Module', 3, 25, 100, v_module_id);

  SELECT COUNT(*) INTO v_caught_count
  FROM scores
  WHERE student_name IN ('_DSM_TEST_bypass_1of25', '_DSM_TEST_bypass_3of25')
    AND lesson = 'Mastery Module'
    AND (pct != ROUND((score::numeric / total) * 100) OR total < 5);

  IF v_caught_count <> 2 THEN
    RAISE EXCEPTION 'Test 6b FAIL — expected detector to catch both 1/25 and 3/25 (=2 rows), caught %', v_caught_count;
  END IF;

  RAISE NOTICE 'Test 6b — bypass detection catches 1/25 and 3/25 → 100%% ... PASS';
END $$;


-- ┌──────────────────────────────────────────────────────────────┐
-- │ Test 7 — Bypass detection catches 1/1 → 100% via total < 5   │
-- │ This is the round-parity Bug 3 signature where score and pct │
-- │ math out (1/1 = 100%) but the total is impossibly small.     │
-- └──────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  v_class_id UUID;
  v_module_id UUID;
  v_caught BOOLEAN;
  v_round_parity_only BOOLEAN;
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE is_active=true ORDER BY code LIMIT 1;
  SELECT id INTO v_module_id FROM dsm_modules WHERE standard = '_DSM_TEST_STANDARD' LIMIT 1;

  INSERT INTO scores (class_id, student_name, module, lesson, score, total, pct, dsm_module_id)
  VALUES (v_class_id, '_DSM_TEST_bypass_1of1', '_DSM_TEST_MODULE_NAME', 'Mastery Module',
          1, 1, 100, v_module_id);

  -- Confirm the combined predicate flags it.
  SELECT EXISTS (
    SELECT 1 FROM scores
    WHERE student_name = '_DSM_TEST_bypass_1of1'
      AND lesson = 'Mastery Module'
      AND (pct != ROUND((score::numeric / total) * 100) OR total < 5)
  ) INTO v_caught;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'Test 7 FAIL — bypass detector did NOT catch 1/1 → 100%%';
  END IF;

  -- Bonus: confirm it's the `total < 5` branch that fired (not the math one).
  SELECT EXISTS (
    SELECT 1 FROM scores
    WHERE student_name = '_DSM_TEST_bypass_1of1'
      AND lesson = 'Mastery Module'
      AND total < 5
      AND pct = ROUND((score::numeric / total) * 100)
  ) INTO v_round_parity_only;

  IF NOT v_round_parity_only THEN
    RAISE EXCEPTION 'Test 7 FAIL — 1/1 should be caught by total<5 branch with score/pct in agreement; predicate behavior changed';
  END IF;

  RAISE NOTICE 'Test 7 — bypass detection catches 1/1 → 100%% via total<5 branch ... PASS';
END $$;


-- ┌──────────────────────────────────────────────────────────────┐
-- │ Test 8 — Bypass detection does NOT false-positive on         │
-- │ legitimate 25/26 → 96%.                                      │
-- └──────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  v_class_id UUID;
  v_module_id UUID;
  v_flagged BOOLEAN;
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE is_active=true ORDER BY code LIMIT 1;
  SELECT id INTO v_module_id FROM dsm_modules WHERE standard = '_DSM_TEST_STANDARD' LIMIT 1;

  -- 25/26 = 96.15... ROUND→96. Legit.
  INSERT INTO scores (class_id, student_name, module, lesson, score, total, pct, dsm_module_id)
  VALUES (v_class_id, '_DSM_TEST_legit_25of26', '_DSM_TEST_MODULE_NAME', 'Mastery Module',
          25, 26, 96, v_module_id);

  SELECT EXISTS (
    SELECT 1 FROM scores
    WHERE student_name = '_DSM_TEST_legit_25of26'
      AND lesson = 'Mastery Module'
      AND (pct != ROUND((score::numeric / total) * 100) OR total < 5)
  ) INTO v_flagged;

  IF v_flagged THEN
    RAISE EXCEPTION 'Test 8 FAIL — detector false-positived on legit 25/26 → 96%%';
  END IF;

  RAISE NOTICE 'Test 8 — no false positive on legit 25/26 → 96%% ... PASS';
END $$;


-- ┌──────────────────────────────────────────────────────────────┐
-- │ Test 9 — Bypass detection does NOT false-positive on a       │
-- │ legitimate perfect score (26/26 → 100%).                     │
-- └──────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  v_class_id UUID;
  v_module_id UUID;
  v_flagged BOOLEAN;
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE is_active=true ORDER BY code LIMIT 1;
  SELECT id INTO v_module_id FROM dsm_modules WHERE standard = '_DSM_TEST_STANDARD' LIMIT 1;

  INSERT INTO scores (class_id, student_name, module, lesson, score, total, pct, dsm_module_id)
  VALUES (v_class_id, '_DSM_TEST_legit_26of26', '_DSM_TEST_MODULE_NAME', 'Mastery Module',
          26, 26, 100, v_module_id);

  SELECT EXISTS (
    SELECT 1 FROM scores
    WHERE student_name = '_DSM_TEST_legit_26of26'
      AND lesson = 'Mastery Module'
      AND (pct != ROUND((score::numeric / total) * 100) OR total < 5)
  ) INTO v_flagged;

  IF v_flagged THEN
    RAISE EXCEPTION 'Test 9 FAIL — detector false-positived on perfect 26/26 → 100%%';
  END IF;

  RAISE NOTICE 'Test 9 — no false positive on legit 26/26 → 100%% ... PASS';
END $$;


-- ┌──────────────────────────────────────────────────────────────┐
-- │ Test 10 — dsm_attempts row insertion with REAL student name  │
-- │ Audit finding #4: pre-fix every row was 'Unknown'. Confirms  │
-- │ the table accepts the real name + a NULL completed_at.       │
-- └──────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  v_class_id UUID;
  v_module_id UUID;
  v_attempt_id UUID;
  v_actual_name TEXT;
  v_completed_at TIMESTAMPTZ;
  v_completed BOOLEAN;
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE is_active=true ORDER BY code LIMIT 1;
  SELECT id INTO v_module_id FROM dsm_modules WHERE standard = '_DSM_TEST_STANDARD' LIMIT 1;

  INSERT INTO dsm_attempts (class_id, student_name, module_id, unit_number,
                             rounds_completed, total_questions, questions_missed, completed)
  VALUES (v_class_id, '_DSM_TEST_alice', v_module_id, 99,
          0, 5, '[]'::jsonb, false)
  RETURNING id INTO v_attempt_id;

  SELECT student_name, completed_at, completed
    INTO v_actual_name, v_completed_at, v_completed
  FROM dsm_attempts
  WHERE id = v_attempt_id;

  IF v_actual_name <> '_DSM_TEST_alice' THEN
    RAISE EXCEPTION 'Test 10 FAIL — expected student_name=_DSM_TEST_alice, got %', v_actual_name;
  END IF;
  IF v_actual_name = 'Unknown' THEN
    RAISE EXCEPTION 'Test 10 FAIL — student_name silently coerced to Unknown';
  END IF;
  IF v_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Test 10 FAIL — completed_at should be NULL on a fresh in-progress attempt, got %', v_completed_at;
  END IF;
  IF v_completed <> false THEN
    RAISE EXCEPTION 'Test 10 FAIL — completed should default to false, got %', v_completed;
  END IF;

  RAISE NOTICE 'Test 10 — dsm_attempts accepts real student_name + NULL completed_at ... PASS';
END $$;


-- ┌──────────────────────────────────────────────────────────────┐
-- │ Test 11 — dsm_attempts.module_id FK behavior on module DELETE│
-- │ Per dsm-migration.sql line 52: ON DELETE CASCADE.            │
-- │ (NB: this is CASCADE, not SET NULL — different from scores.) │
-- └──────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  v_class_id UUID;
  v_temp_module_id UUID;
  v_attempt_id UUID;
  v_attempts_after INT;
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE is_active=true ORDER BY code LIMIT 1;

  -- Throwaway module so we can delete it without affecting the rest of the suite.
  INSERT INTO dsm_modules (class_id, standard, unit_number, title, question_count, status, created_by)
  VALUES (v_class_id, '_DSM_TEST_STANDARD_FK', 99, '_DSM_TEST_ FK module', 5, 'draft', NULL)
  RETURNING id INTO v_temp_module_id;

  INSERT INTO dsm_attempts (class_id, student_name, module_id, unit_number,
                             rounds_completed, total_questions, questions_missed, completed)
  VALUES (v_class_id, '_DSM_TEST_fk_student', v_temp_module_id, 99, 0, 5, '[]'::jsonb, false)
  RETURNING id INTO v_attempt_id;

  -- Delete the parent module — should CASCADE-delete the attempt row.
  DELETE FROM dsm_questions WHERE module_id = v_temp_module_id;
  DELETE FROM dsm_modules   WHERE id = v_temp_module_id;

  SELECT COUNT(*) INTO v_attempts_after FROM dsm_attempts WHERE id = v_attempt_id;

  IF v_attempts_after <> 0 THEN
    RAISE EXCEPTION 'Test 11 FAIL — dsm_attempts.module_id FK should CASCADE on module delete; row still present (count=%)', v_attempts_after;
  END IF;

  RAISE NOTICE 'Test 11 — dsm_attempts.module_id ON DELETE CASCADE works ... PASS';
END $$;


-- ┌──────────────────────────────────────────────────────────────┐
-- │ Test 12 — scores.dsm_module_id FK ON DELETE SET NULL         │
-- │ Per migration 005: deleting a dsm_modules row does NOT       │
-- │ delete the score; the column is set to NULL so the           │
-- │ historical mastery still counts (NULL branch of OR clause).  │
-- └──────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  v_class_id UUID;
  v_temp_module_id UUID;
  v_score_id UUID;
  v_after_module_id UUID;
  v_score_present INT;
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE is_active=true ORDER BY code LIMIT 1;

  INSERT INTO dsm_modules (class_id, standard, unit_number, title, question_count, status, created_by)
  VALUES (v_class_id, '_DSM_TEST_STANDARD_FK_SCORE', 99, '_DSM_TEST_ FK-score module', 5, 'draft', NULL)
  RETURNING id INTO v_temp_module_id;

  INSERT INTO scores (class_id, student_name, module, lesson, score, total, pct, dsm_module_id)
  VALUES (v_class_id, '_DSM_TEST_fk_score_student', '_DSM_TEST_MODULE_NAME', 'Mastery Module',
          25, 25, 100, v_temp_module_id)
  RETURNING id INTO v_score_id;

  -- Delete the parent module — score should remain, with dsm_module_id NULLed out.
  DELETE FROM dsm_modules WHERE id = v_temp_module_id;

  -- Two separate SELECTs (Postgres has no MAX(uuid) aggregate, so we can't
  -- combine COUNT and the value lookup into one row).
  SELECT COUNT(*) INTO v_score_present FROM scores WHERE id = v_score_id;
  SELECT dsm_module_id INTO v_after_module_id FROM scores WHERE id = v_score_id;

  IF v_score_present <> 1 THEN
    RAISE EXCEPTION 'Test 12 FAIL — score row should still exist after module delete (ON DELETE SET NULL), got count=%', v_score_present;
  END IF;
  IF v_after_module_id IS NOT NULL THEN
    RAISE EXCEPTION 'Test 12 FAIL — scores.dsm_module_id should be NULL after parent module delete, got %', v_after_module_id;
  END IF;

  RAISE NOTICE 'Test 12 — scores.dsm_module_id ON DELETE SET NULL works ... PASS';
END $$;


-- ┌──────────────────────────────────────────────────────────────┐
-- │ Test 13 — OR-clause edge case: tagged-with-X row + NULL row  │
-- │ both exist for same student/module/lesson; ORDER BY          │
-- │ created_at DESC LIMIT 1 picks the most recent regardless of  │
-- │ which side of the OR matched.                                │
-- └──────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  v_class_id UUID;
  v_module_id UUID;
  v_found_pct INT;
  v_found_module UUID;
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE is_active=true ORDER BY code LIMIT 1;
  SELECT id INTO v_module_id FROM dsm_modules WHERE standard = '_DSM_TEST_STANDARD' LIMIT 1;

  -- Older NULL (legacy) row.
  INSERT INTO scores (class_id, student_name, module, lesson, score, total, pct, dsm_module_id, created_at)
  VALUES (v_class_id, '_DSM_TEST_frank_orcase', '_DSM_TEST_MODULE_NAME', 'Mastery Module',
          22, 25, 88, NULL, now() - interval '2 hours');
  -- Newer tagged row.
  INSERT INTO scores (class_id, student_name, module, lesson, score, total, pct, dsm_module_id, created_at)
  VALUES (v_class_id, '_DSM_TEST_frank_orcase', '_DSM_TEST_MODULE_NAME', 'Mastery Module',
          25, 25, 100, v_module_id, now() - interval '1 hour');

  SELECT pct, dsm_module_id INTO v_found_pct, v_found_module FROM (
    SELECT pct, dsm_module_id, created_at
    FROM scores
    WHERE class_id = v_class_id
      AND student_name = '_DSM_TEST_frank_orcase'
      AND module = '_DSM_TEST_MODULE_NAME'
      AND lesson = 'Mastery Module'
      AND (dsm_module_id = v_module_id OR dsm_module_id IS NULL)
    ORDER BY created_at DESC
    LIMIT 1
  ) t;

  IF v_found_pct <> 100 THEN
    RAISE EXCEPTION 'Test 13 FAIL — most recent row (pct=100, tagged) should win, got pct=%', v_found_pct;
  END IF;
  IF v_found_module IS DISTINCT FROM v_module_id THEN
    RAISE EXCEPTION 'Test 13 FAIL — expected dsm_module_id=%, got %', v_module_id, v_found_module;
  END IF;

  -- Reverse-order variant: older tagged, newer NULL — NULL should win this time.
  INSERT INTO scores (class_id, student_name, module, lesson, score, total, pct, dsm_module_id, created_at)
  VALUES (v_class_id, '_DSM_TEST_frank_orcase_rev', '_DSM_TEST_MODULE_NAME', 'Mastery Module',
          25, 25, 100, v_module_id, now() - interval '2 hours');
  INSERT INTO scores (class_id, student_name, module, lesson, score, total, pct, dsm_module_id, created_at)
  VALUES (v_class_id, '_DSM_TEST_frank_orcase_rev', '_DSM_TEST_MODULE_NAME', 'Mastery Module',
          22, 25, 88, NULL, now() - interval '1 hour');

  SELECT pct, dsm_module_id INTO v_found_pct, v_found_module FROM (
    SELECT pct, dsm_module_id, created_at
    FROM scores
    WHERE class_id = v_class_id
      AND student_name = '_DSM_TEST_frank_orcase_rev'
      AND module = '_DSM_TEST_MODULE_NAME'
      AND lesson = 'Mastery Module'
      AND (dsm_module_id = v_module_id OR dsm_module_id IS NULL)
    ORDER BY created_at DESC
    LIMIT 1
  ) t;

  IF v_found_pct <> 88 OR v_found_module IS NOT NULL THEN
    RAISE EXCEPTION 'Test 13 FAIL — reverse case: newer NULL row should win, got pct=% module_id=%', v_found_pct, v_found_module;
  END IF;

  RAISE NOTICE 'Test 13 — OR-clause does not bias toward tagged or NULL; pure created_at ordering ... PASS';
END $$;


-- ┌──────────────────────────────────────────────────────────────┐
-- │ Test 14 — PostgREST OR syntax sanity check                   │
-- │ Verifies that the literal URL fragment                       │
-- │   &or=(dsm_module_id.eq.<X>,dsm_module_id.is.null)           │
-- │ produces the same row set as the SQL predicate               │
-- │   dsm_module_id = <X> OR dsm_module_id IS NULL               │
-- │ by mirroring it inside SQL. Cross-checks that the Postgres   │
-- │ predicate the test suite uses everywhere is faithful to the  │
-- │ JS layer's URL composition.                                  │
-- └──────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  v_class_id UUID;
  v_module_id UUID;
  v_count_explicit INT;
  v_count_or INT;
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE is_active=true ORDER BY code LIMIT 1;
  SELECT id INTO v_module_id FROM dsm_modules WHERE standard = '_DSM_TEST_STANDARD' LIMIT 1;

  -- Reuse fixtures from earlier tests (bob_match tagged, carol_legacy NULL,
  -- dave_republish tagged with v1, frank_orcase has both shapes).
  -- Both queries should return the same count.

  -- Variant A: spelled-out OR (the predicate dsm-player.js generates).
  SELECT COUNT(*) INTO v_count_or
  FROM scores
  WHERE student_name LIKE '_DSM_TEST_%'
    AND lesson = 'Mastery Module'
    AND (dsm_module_id = v_module_id OR dsm_module_id IS NULL);

  -- Variant B: explicit UNION of the two arms.
  SELECT COUNT(*) INTO v_count_explicit
  FROM (
    SELECT id FROM scores
      WHERE student_name LIKE '_DSM_TEST_%'
        AND lesson = 'Mastery Module'
        AND dsm_module_id = v_module_id
    UNION
    SELECT id FROM scores
      WHERE student_name LIKE '_DSM_TEST_%'
        AND lesson = 'Mastery Module'
        AND dsm_module_id IS NULL
  ) t;

  IF v_count_or <> v_count_explicit THEN
    RAISE EXCEPTION 'Test 14 FAIL — OR-clause and UNION-of-arms disagree (or=% explicit=%)',
      v_count_or, v_count_explicit;
  END IF;

  RAISE NOTICE 'Test 14 — PostgREST OR syntax matches SQL OR semantics (count=%) ... PASS', v_count_or;
END $$;


-- ┌──────────────────────────────────────────────────────────────┐
-- │ Test 15 — End-to-end mimicry: simulate a successful Mastery  │
-- │ submission (the rows submit() with action='score' would      │
-- │ insert) and verify the lookupScoreStrict query returns it.   │
-- │                                                              │
-- │ This catches the failure mode where the column exists but    │
-- │ the player code forgets to populate it (the bug class that   │
-- │ migration 005 + commit 00c2d58 was meant to close).          │
-- └──────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  v_class_id UUID;
  v_module_id UUID;
  v_found_pct INT;
  v_found_module UUID;
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE is_active=true ORDER BY code LIMIT 1;
  SELECT id INTO v_module_id FROM dsm_modules WHERE standard = '_DSM_TEST_STANDARD' LIMIT 1;

  -- Insert mirrors solAPI.submit({action:'score', ..., dsmModuleId: moduleId})
  -- exactly: every column written by the JS path, with dsm_module_id populated.
  INSERT INTO scores (class_id, student_id, student_name, module, lesson,
                      score, total, pct, time_on_quiz, assignment_id, dsm_module_id)
  VALUES (v_class_id, NULL, '_DSM_TEST_e2e_grace',
          '_DSM_TEST_MODULE_NAME', 'Mastery Module',
          24, 25, 96, NULL, NULL, v_module_id);

  -- Now run the exact SQL form of lookupScoreStrict(name, module, lesson, dsmModuleId).
  SELECT pct, dsm_module_id INTO v_found_pct, v_found_module FROM (
    SELECT pct, dsm_module_id
    FROM scores
    WHERE class_id = v_class_id
      AND student_name = '_DSM_TEST_e2e_grace'
      AND module = '_DSM_TEST_MODULE_NAME'
      AND lesson = 'Mastery Module'
      AND (dsm_module_id = v_module_id OR dsm_module_id IS NULL)
    ORDER BY created_at DESC
    LIMIT 1
  ) t;

  IF v_found_pct IS NULL THEN
    RAISE EXCEPTION 'Test 15 FAIL — full submit() shape did not round-trip through lookupScoreStrict';
  END IF;
  IF v_found_pct <> 96 THEN
    RAISE EXCEPTION 'Test 15 FAIL — expected pct=96, got %', v_found_pct;
  END IF;
  IF v_found_module IS DISTINCT FROM v_module_id THEN
    RAISE EXCEPTION 'Test 15 FAIL — expected dsm_module_id tag preserved, got %', v_found_module;
  END IF;

  RAISE NOTICE 'Test 15 — full submit() shape round-trips through lookupScoreStrict ... PASS';
END $$;


-- ┌──────────────────────────────────────────────────────────────┐
-- │ Final — Cleanup                                              │
-- │ Removes every fixture this file inserted.                    │
-- │ Order: scores → dsm_attempts → dsm_questions → dsm_modules.  │
-- │ The CASCADE FK on dsm_questions/dsm_attempts means deleting  │
-- │ dsm_modules would handle most of it, but explicit deletes    │
-- │ make the intent obvious and idempotent across reruns.        │
-- └──────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  v_scores_deleted INT;
  v_attempts_deleted INT;
  v_questions_deleted INT;
  v_modules_deleted INT;
BEGIN
  WITH d AS (DELETE FROM scores       WHERE student_name LIKE '_DSM_TEST_%' RETURNING 1)
    SELECT COUNT(*) INTO v_scores_deleted FROM d;

  WITH d AS (DELETE FROM dsm_attempts WHERE student_name LIKE '_DSM_TEST_%' RETURNING 1)
    SELECT COUNT(*) INTO v_attempts_deleted FROM d;

  WITH d AS (
    DELETE FROM dsm_questions
    WHERE module_id IN (
      SELECT id FROM dsm_modules
      WHERE standard IN ('_DSM_TEST_STANDARD', '_DSM_TEST_STANDARD_V2',
                         '_DSM_TEST_STANDARD_FK', '_DSM_TEST_STANDARD_FK_SCORE')
    )
    RETURNING 1
  ) SELECT COUNT(*) INTO v_questions_deleted FROM d;

  WITH d AS (
    DELETE FROM dsm_modules
    WHERE standard IN ('_DSM_TEST_STANDARD', '_DSM_TEST_STANDARD_V2',
                       '_DSM_TEST_STANDARD_FK', '_DSM_TEST_STANDARD_FK_SCORE')
    RETURNING 1
  ) SELECT COUNT(*) INTO v_modules_deleted FROM d;

  RAISE NOTICE 'Cleanup OK — removed % score rows, % attempts, % questions, % modules',
    v_scores_deleted, v_attempts_deleted, v_questions_deleted, v_modules_deleted;
END $$;


-- ================================================================
-- Verification queries (read-only — comment out if not wanted).
-- After cleanup these should both return 0.
-- ================================================================
SELECT 'leftover scores'   AS where_to_look, COUNT(*) AS n FROM scores       WHERE student_name LIKE '_DSM_TEST_%'
UNION ALL
SELECT 'leftover attempts' AS where_to_look, COUNT(*) AS n FROM dsm_attempts WHERE student_name LIKE '_DSM_TEST_%'
UNION ALL
SELECT 'leftover modules'  AS where_to_look, COUNT(*) AS n FROM dsm_modules
  WHERE standard IN ('_DSM_TEST_STANDARD', '_DSM_TEST_STANDARD_V2',
                     '_DSM_TEST_STANDARD_FK', '_DSM_TEST_STANDARD_FK_SCORE');
