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

## Remaining work (not part of this fix)

- **SSO rollout** — continues per `migrations/SSO-ACTIVATION-PLAN.md` (Phases 1-6)
- **RLS lockdown** — Phase 2 migration (`004-rls-phase2-lockdown.sql`) ready but not yet applied
- **Credential cleanup** — Phase 3 per `SECURITY-PLAN.md`
- **Existing bad scores in Supabase** — Skylar's 1/25 at 100% (and any similar records from other students) remain in the `scores` table. These could be cleaned up manually via Supabase SQL Editor if needed, but the fix prevents new bad scores going forward.
