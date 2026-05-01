# DSM Mastery Gate Fix — 2026-05-01

**Commit:** `7bef639` — "Fix mastery gate bypass: score calculation + panel auto-unlock"
**Author:** Mark + Claude (Opus 4.6)
**Deployed:** Vercel auto-deploy from `main`

---

## Problem

Students were able to proceed past the Mastery Module without demonstrating mastery. Observed in teacher dashboard: Skylar Cole scored **1/25 (4%)** on the Unit 2 Mastery Module but the system recorded **100%** and allowed her to continue to the Study Guide, Practice Test, and Results.

Two independent bugs caused this:

### Bug 1: Score calculation in `complete()` used stale state

`dsm-player.js` tracked the score across rounds using three independent closure variables:
- `bestAttemptScore` (best % on any full attempt)
- `bestAttemptCorrect` (questions correct on the best attempt)
- `lastFullAttemptMissed` (missed count at end of most recent full attempt)

These variables were reset at different times by different functions (`start`, `startNextRound`, `startFreshFullAttempt`). When `complete()` ran, it tried to reconstruct the score from these stale values, with cascading fallbacks:

```javascript
// OLD — the dangerous fallback chain
var correct = bestAttemptCorrect;     // could be stale
var pct = bestAttemptScore;           // could be stale
if (correct === 0 && missed.length < fullPoolSize) {
    correct = fullPoolSize - lastFullAttemptMissed;
    pct = Math.round((correct / fullPoolSize) * 100);
}
if (correct === 0 && missed.length === 0) {
    correct = fullPoolSize;    // assumes perfect!
    pct = 100;                 // assumes mastery!
}
```

After multiple review/retake rounds, `missed` gets reset to `[]` while the score variables hold values from earlier attempts. The final fallback saw `correct === 0` and `missed.length === 0` and concluded "must be perfect" — stamping `pct: 100` regardless of actual performance. This pct was submitted to Supabase as the official score AND triggered `onComplete()` to unlock subsequent panels.

### Bug 2: `goTo()` auto-unlocked panels past the Mastery Module

The navigation function `goTo()` in every unit file had:

```javascript
if (!(n in gateRequired)) { unlockedPanels.add(n + 1); }
```

`gateRequired` only covered content lesson panels (0-5 or 0-6 depending on unit). The Mastery Module panel was never listed, so **simply visiting it** auto-unlocked the Study Guide, which auto-unlocked the Practice Test, which auto-unlocked Results. The DSM player's `onComplete` callback was supposed to be the sole gatekeeper, but `goTo()` opened the gates first.

### Secondary issue: `nextQuestion()` double-fire

Correct answers auto-advance via `setTimeout(nextQuestion, 800)`, but `nextQuestion` was also callable via the "Next Question" button (exposed in the public API). If both fired, `complete()` could execute twice, submitting duplicate scores.

---

## Fix

### dsm-player.js

1. **`complete(correct, total, pct)` now receives the actual score as arguments** from `nextQuestion()` at the exact moment mastery is proven. No reconstruction from stale state. The `pct` is always re-derived from `correct/total` as a single source of truth.

2. **Removed `bestAttemptScore`, `bestAttemptCorrect`, `lastFullAttemptMissed`** from the state block entirely. They are no longer used for score submission.

3. **Added `if (completed) return;` guard** at the top of `complete()` to prevent double-calls.

4. **Added `advancing` flag** to `handleAnswer()` / `nextQuestion()`. When a correct-answer auto-advance is pending (800ms timeout), manual `nextQuestion()` calls are blocked.

### unit-1.html through unit-8.html

1. **Added `var DSM_PANEL = N`** declaring the Mastery Module's panel number per unit.

2. **Fixed `goTo()` auto-unlock**: `&& n !== DSM_PANEL` prevents visiting the Mastery Module panel from auto-unlocking subsequent panels. Only `DSMPlayer.onComplete()` can open those gates.

DSM panel numbers by unit:

| Unit | DSM_PANEL | gateRequired covers |
|------|-----------|-------------------|
| 1 | 8 | 0-6 |
| 2 | 7 | 0-5 |
| 3 | 7 | 0-5 |
| 4 | 6 | 0-4 |
| 5 | 7 | 0-5 |
| 6 | 6 | 0-4 |
| 7 | 6 | 0-4 |
| 8 | 6 | 0-4 |

---

## Code paths verified

| Scenario | Result |
|----------|--------|
| Student aces first try (25/25, threshold 85%) | `complete(25, 25, 100)` — submits 25/25 at 100% |
| Student scores 22/25 (88%, threshold 85%) | `complete(22, 25, 88)` — submits 22/25 at 88% |
| Student scores 1/25 (4%, threshold 85%) | Does NOT call `complete()` — enters review mode |
| Student navigates to Mastery panel without completing | `goTo()` blocked by `n !== DSM_PANEL` — panels 8+ stay locked |
| localStorage says 'passed' on page load | `init()` shows completion, calls `onComplete()` — no score re-submitted |
| DSM fetch times out (5s) | `onSkip()` fires, unlocks panels — by design, no DSM available |
| `complete()` called twice (race condition) | Second call exits immediately via `if (completed) return;` |
| setTimeout + manual nextQuestion() race | Manual call blocked by `if (advancing) return;` |

---

## What was NOT changed

- Quiz flow students see (full attempt, review missed, retake fresh)
- `onComplete` / `onSkip` callbacks in unit HTML
- DSM question loading, rendering, or answer handling
- Supabase schema, API endpoints, or RLS policies
- `sol-api.js` or any backend code
- Any other feature (pretest locks, practice test retakes, vocab quiz, SSO)

---

## Follow-up: Auto-recover missing mastery scores

**Commit:** `9adaa50` — "Auto-recover missing mastery scores from pre-fix bypass"
**Date:** 2026-05-01 (same day, second deploy)

### Problem discovered after initial fix

Kiera Looney completed Unit 6 mastery but had no score on the dashboard. Investigation showed she (and likely many other students) had `localStorage sol_unit6_dsm = 'passed'` cached from sessions under the old buggy code. When loading the page after our fix, `DSMPlayer.init()` saw 'passed' in localStorage, showed "Mastery Achieved!", and skipped the quiz — **without ever submitting a score to Supabase**. Unit 7 worked because she'd never visited it before (no cached localStorage).

This affected every student who reached the Mastery Module panel under the old `goTo()` bypass — their browsers think mastery is done, but the database has no record.

### Fix

Modified `DSMPlayer.init()` to verify scores against the database when localStorage says 'passed':

1. If localStorage says 'passed' AND `studentName` is available AND `config.moduleName` is set:
   - Query `solAPI.hasPriorScore(studentName, moduleName, 'Mastery Module')`
   - **Score found** → show "Mastery Achieved!" as before (no change)
   - **No score found** → clear the localStorage flag, load the quiz fresh
2. Fallback (no student name yet or API unavailable): trust localStorage as before

This means every student who bypassed mastery under the old code will **automatically** get the real quiz next time they load any unit — no manual action needed from students or teacher.

### Changes

- **dsm-player.js:**
  - `init()` now verifies DB score when localStorage says 'passed'
  - Extracted `loadQuestions(container)` helper (was inline in `init()`)
  - Added `moduleName` to config schema
- **unit-1.html through unit-8.html:**
  - All 20 `DSMPlayer.init()` calls now include `moduleName` field

### Module names by unit

| Unit | moduleName |
|------|-----------|
| 1 | SOL Prep — Unit 1: Scientific Investigation |
| 2 | SOL Prep — Unit 2: Biochemistry & Energy |
| 3 | SOL Prep — Unit 3: Cell Structure & Function |
| 4 | SOL Prep — Unit 4: Bacteria & Viruses |
| 5 | SOL Prep — Unit 5: Genetics & Inheritance |
| 6 | SOL Prep — Unit 6: Classification & Diversity |
| 7 | SOL Prep — Unit 7: Evolution |
| 8 | SOL Prep — Unit 8: Ecology & Ecosystems |

### Updated code paths

| Scenario | Result |
|----------|--------|
| localStorage 'passed' + score exists in DB | Shows "Mastery Achieved!" — no quiz (correct) |
| localStorage 'passed' + NO score in DB | Clears localStorage, loads quiz fresh (auto-recovery) |
| localStorage 'passed' + student name not set yet | Falls back to trusting localStorage (safe default) |
| No localStorage flag at all | Normal flow — loads quiz from scratch |

---

## Summary of all commits (2026-05-01)

| Commit | What |
|--------|------|
| `7bef639` | Fix mastery gate bypass: score calculation + panel auto-unlock |
| `a1f3fc9` | Add DSM mastery gate fix documentation |
| `9adaa50` | Auto-recover missing mastery scores from pre-fix bypass |

---

## Remaining work (not part of this fix)

- **SSO rollout** — continues per `migrations/SSO-ACTIVATION-PLAN.md` (Phases 1-6)
- **RLS lockdown** — Phase 2 migration (`004-rls-phase2-lockdown.sql`) ready but not yet applied
- **Credential cleanup** — Phase 3 per `SECURITY-PLAN.md`
- **Existing bad scores in Supabase** — Skylar's 1/25 at 100% (and any similar records from other students) remain in the `scores` table. These could be cleaned up manually via Supabase SQL Editor:
  ```sql
  -- Find all suspicious mastery scores (score/total mismatch with pct)
  SELECT student_name, module, score, total, pct, created_at
  FROM scores
  WHERE lesson = 'Mastery Module'
    AND pct != ROUND((score::numeric / total) * 100)
  ORDER BY created_at DESC;

  -- Delete them if desired (students will retake automatically via the auto-recovery)
  ```
- **Students with no mastery scores at all** (bypassed via goTo, never triggered complete()) — these are handled automatically by the auto-recovery in `9adaa50`. No action needed.
