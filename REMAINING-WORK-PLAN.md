# Remaining Work — Plan in Logical Order

**Status:** Phase D core done; verification + cleanup + post-Monday roadmap below.
**Generated:** 2026-05-03 mid-day, after the second audit-agent sweep + 2 more bug fixes.

---

## Tier 1 — Before Monday morning class (CRITICAL)

These must complete tonight or early Monday before students arrive. Window: ~3-4 hours of work, achievable today.

### 1.1  End-to-end verification walk (Phase D Step 5)
**Time:** 15-20 min
**Why first:** Everything else assumes the engine works. One full walk is the gate.
**What:** Sign in fresh → enter ENG-3 → answer Pretest (5 q) → walk panels 1-7 → pass Vocab → complete Mastery → submit Practice Test → see results page. Watch console for any errors.
**Done when:** All scores land in DB with `auth_user_id` populated; no console errors; no blank panels.

### 1.2  Re-lock all 9 modules
**Time:** 30 sec (one SQL UPDATE)
**Why second:** I unlocked unit-1, unit-2, unit-3, unit-7 during testing. Lockout must be fully restored before Monday so class period decides who enters.
**What:** `UPDATE module_releases SET unlocked = false, unlocked_at = null;`

### 1.3  Phase D Step 5 cleanup — delete obsolete tooling
**Time:** 10 min
**Why third:** Auto cache-bust replaced manual bumping. Old scripts are now dead weight.
**Files to delete:**
- `tools/cachebust-engine.py`
- `tools/cachebust-sol-api.py`
- `tools/convert-to-hash-placeholders.py` (one-shot, done its job)
- `tools/fix-broken-cachebust.py` (one-shot hotfix, done)
- `tools/fix-grade-vocab-onclick.py` (one-shot, done)
- `tools/check-deployed-tags.py` (debug script)
- `tools/b3-propagate-gate.py` (Phase B propagation, done)
**Keep:**
- `tools/build-cache-bust.js` (active — runs on every Vercel build)
- `tools/phaseD-migrate-unit.py` (might still be useful for future unit additions)
- `tools/phaseD-extract-configs.py` (reference, low overhead)
- `tools/phaseD-layout-fix.py` (one-shot, but reference for future)

### 1.4  Update Playwright smoke test for the engine
**Time:** 20-30 min
**Why fourth:** The smoke test was written before Phase D. It tests legacy behaviors that don't exist anymore. Without this update, CI will fail on every push and we'll start ignoring it.
**What:** Update `tests/unit-1-smoke.spec.js` to verify the engine flow: SSO modal present, click Sign in works, after-mock-sign-in modal dismisses, panel 0 visible. Keep state-aware about lockout.

### 1.5  Memory update
**Time:** 5 min
**Why fifth:** Compaction may hit before tomorrow morning. Memory needs to reflect Phase D shipped + auto cache-bust + lockout state + Monday plan.

### 1.6  Final commit + push
Bundle 1.3 + 1.4 + 1.5 into one cleanup commit.

---

## Tier 2 — Monday morning at school (live)

### 2.1  Unlock all 9 modules
**Time:** 30 sec
**When:** Just before first class period.
**What:** `UPDATE module_releases SET unlocked = true, unlocked_at = now();`

### 2.2  Watch first class period live
**Time:** 1 class period (~50 min)
**Why:** First contact with real student traffic. Most likely to surface anything the audits missed.
**What to watch:**
- Live Pulse dashboard tab in real time
- DB queries via MCP: count of new `scores` rows / `dsm_attempts` rows since unlock; verify `auth_user_id` populated
- Watch for `client_error` activity events (Audit #7 reporter)
- If anything breaks for >2 students, lock the affected unit and investigate

### 2.3  Post-class debrief
After the first period, scan for:
- Buffered writes count (`localStorage` from any failed writes)
- Mastery completions on units other than 2 (which we already know works)
- Any `auth_user_id IS NULL` rows from authenticated paths (would indicate engine bug)

---

## Tier 3 — This week (post-Monday)

These are smaller, one-evening tasks. Order picked so each builds on or pairs naturally with the previous.

### 3.1  Class-code UX rework — one-click invite links
**Time:** 1-1.5 hours
**Why first:** Pairs naturally with the rename. Students see the new system and the new code at the same moment. Documented in memory as queued work.
**What:** Each unit page reads `?class=<code>` from URL on load; if present, prefill or hide the class-code field, auto-validate, dismiss after SSO. Mark posts the right link per period in Google Classroom. Eliminates "what's my code?" questions.

### 3.2  ENG- → BIO- class code rename
**Time:** 5 min (one SQL UPDATE)
**Why second:** Pairs with 3.1 — change the codes at the same time you change the link surface.
**What:** `UPDATE classes SET code = REPLACE(code, 'ENG-', 'BIO-');` — student_classes references class_id (UUID), not code, so this is a cosmetic-only rename.

### 3.3  Practice-test.html migration (Phase D2-lite)
**Time:** 1-2 evenings
**Why third:** Standalone, doesn't share the unit-page panel framework. Deferred during Phase D weekend; should not stay deferred indefinitely. Engine can grow a "practice-test mode" hook.

### 3.4  Phase 2.5b — denormalize teacher tables
**Time:** 2-3 hours
**Why fourth:** Closes the remaining 4 advisor warnings about SECURITY DEFINER cross-table-subquery RLS on `classes` / `dsm_modules` / `dsm_questions` / `students` / `student_classes`. Same pattern as the Phase 2 denormalization but on teacher-facing tables.
**Risk:** Low — these tables are low-write-volume (teacher-only). But touches the same patterns we're now familiar with.

---

## Tier 4 — Next 1-2 weeks

### 4.1  ENG → BIO complete sweep
**Time:** 30 min
**What:** Update any place that hardcodes "ENG-" (probably none in code — it's all DB-driven — but worth grep-checking).

### 4.2  Watch for engine regressions across units
**Why:** Different units exercise different paths. Unit-1 has charts, unit-2 has macromolecules diagrams, unit-3 has cell-organelle drag-and-drop (if any), etc. As students hit each unit for the first time, edge cases surface.

### 4.3  Audit `client_error` writes
**Why:** The error reporter is now logging to `activity.event='client_error'`. Once Phase 2 RLS is on, anon writes to activity are blocked — error reporter writes from authenticated session works, but unauthenticated errors (e.g. on the index page) get rejected. Decide: route error reporter through service-role endpoint, or accept that we miss some unauth errors.

---

## Tier 5 — Summer / off-cycle (after exams)

### 5.1  Phase D3 — HTML shell extraction
**Time:** 6-8 evenings
**Why summer:** Each unit page still has ~700-1000 LOC of duplicated shell HTML (top-bar, modal, panel framework). Extracting that to a shared template shrinks each unit page to ~50 LOC of pure lesson content. Big-bang refactor, mid-semester risk.

### 5.2  FERPA Phase 6 — audit logging
**Time:** 4-6 hours
**Why later:** Adds an `access_logs` table with who-read-what-and-when. Useful for FERPA compliance documentation but not blocking anything.

### 5.3  SOL pipeline residuals
- `2004-26` table data incomplete
- `2007-46` chart x-axis labels mismatch
- `2015-44` Elodea misaligned crop
- Bank-wide `imageNote` audit
**These are content fixes, not engineering. Separate workstream.**

---

## Decision log — what's deferred indefinitely

- **Audit #5 — state-management contract** — substantially satisfied by the engine's `_state` object + `_serializeState`/`_hydrateState`. No further formalization needed.
- **Audit #17 — git history scrub** — old apps-script password is in a dead system. Not worth the rewrite hassle.
- **Service workers** — wrong tool for this scale (decided 2026-05-03 morning).
- **Full content-hash filename rewrite (Flavor A)** — Flavor B (query string) ships the same value with less complexity.

---

## Time budget

| Tier | Item | Time | Cumulative |
|---|---|---|---|
| 1 | 1.1 verify | 0:20 | 0:20 |
| 1 | 1.2 lock | 0:01 | 0:21 |
| 1 | 1.3 cleanup | 0:10 | 0:31 |
| 1 | 1.4 smoke test | 0:30 | 1:01 |
| 1 | 1.5 memory | 0:05 | 1:06 |
| 1 | 1.6 commit | 0:05 | 1:11 |
| 2 | 2.1 unlock | 0:01 | n/a Mon morning |
| 2 | 2.2 watch | 0:50 | n/a class period |
| 3 | 3.1 invite links | 1:30 | one evening |
| 3 | 3.2 BIO rename | 0:05 | with 3.1 |
| 3 | 3.3 practice-test | 2:00 | one evening |
| 3 | 3.4 Phase 2.5b | 2:30 | one evening |

**Tier 1 total: ~70 minutes today.**
**Tier 3 total: ~6 hours spread across this week.**

---

## What I need from Mark to start

1. **Approve Tier 1 order** (or say "do it" if it's right)
2. **Start the verification walk** — that's 1.1, only Mark can do it; everything else cascades after
3. **Confirm Tier 3 order** — particularly: do you want invite-link UX before or after the BIO rename? My plan says together.

Hit me with go/no-go and I'll execute Tier 1 in order.
