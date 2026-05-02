# Phase D — Unit-Engine Refactor

**Status:** approved 2026-05-02; execution starting same evening
**Authors:** Mark + Claude
**Audit reference:** items #4 (unit-engine extraction) + #5 (state-management contract)
**Window:** weekend 2026-05-02 → 2026-05-03 (lockout in effect)

---

## Why this exists

Each `sol-prep/unit-N.html` is ~3500 LOC and ~80% of that mass is duplicated across the 9 entry pages (unit-1..8 + practice-test). Pain we've felt:

- **Today's gate-helper change** (commit `fc5a77b`) needed a Python propagation script that hand-edited 8 files because the same IIFE existed 9 places.
- **Today's `auth_user_id` fix** (commit `8a61d4e`) had to add the field to `submit()` once but the parallel `createDSMAttempt` path was missed and shipped broken — a class-wide regression that took student bug reports to surface (commit `8a6b81d` hotfix). That's the per-page-duplication tax.
- **The Phase B + Phase 2 + Phase 2.5 client commits** all touched 9-10 files just to bump cache-bust and inject one or two function calls.

Phase D extracts shared logic into `sol-prep/unit-engine.js` so future changes touch one file. Each unit page becomes ~800-1000 LOC of unit-specific lesson HTML + a single `UnitEngine.boot(config)` call.

---

## Scope decision: Option A (logic-only)

Three options were presented; chose A:

| Option | Extracted | Per-page LOC after | Effort |
|---|---|---|---|
| **A** | All shared JS → `unit-engine.js`; shared CSS → `unit-styles.css`. Lesson HTML stays inline. | ~800-1000 | 4-5 evenings |
| B | A + shared HTML shell (modal, top-bar, panel framework) | ~400-600 | 6-8 |
| C | B + lessons themselves in config data structure | ~50-100 | 10-14 |

A is the highest impact-per-evening, lowest blast radius. B can come later as Phase D2 if appetite remains.

**Out of scope for this weekend:** `practice-test.html` (structurally different — standalone, not panel-stack). Engine will be designed to accommodate it later but it stays on the old pattern for now.

---

## Architecture in one paragraph

`sol-prep/unit-engine.js` exports `UnitEngine.boot(config)`. The config object names the unit (number, title, standard), the question banks (vocab, pretest, practice), and the DSM module key. The engine renders nothing on its own — it wires the existing inline-HTML panels to a state object, manages panel transitions / vocab gate / pretest scoring / Mastery integration / practice-test scoring, calls into `solAPI` for all writes, calls into `DSMPlayer.init` at the Mastery step, and calls `solAPI.runModuleReleaseGate` for the lock overlay. Nothing about how the panels look changes; only the ~2500 LOC of inline JS goes away.

---

## Execution plan

### Step 1 — Survey + design doc (this evening, ~1 hr)

Read every line of `unit-1.html`'s `<script>` block. For each function, classify as:

- **shared** — same logic across all 9 pages, goes to engine
- **per-unit** — same shape, different content (e.g., the question banks), goes to config
- **per-page** — genuinely unique (e.g., custom panel rendering for a specific lesson), stays inline

Then diff against unit-2..8 to confirm the classification holds. Where it doesn't, decide: "promote to shared with config flag" vs "leave per-page."

**Output:** `PHASE-D-DESIGN-DOC.md` containing:
- Proposed `UnitEngine.boot(config)` signature
- The `config` shape (TypeScript-style interface as JSDoc)
- The `state` shape (every key currently on the global state object)
- Lifecycle hooks (`onPanelEnter`, `onVocabPass`, etc.) — only if needed; prefer NOT to add them if the engine can own everything
- Migration recipe per unit (what gets deleted vs. what stays)

**Gate before Step 2:** Mark reviews the design doc and either approves or redirects. Cheap to iterate at this stage; expensive after engine code exists.

### Step 2 — Build `unit-engine.js` (1-2 evenings)

Implement the engine to spec. Composition:
- **boot()** — entry point; waits for `solAPI.initAuth()` + class hydration, then mounts panels
- **state** — single source of truth, autosaved to localStorage + `quiz_progress`
- **panel transitions** — `goToPanel(n)`, lock check, activity log, autosave
- **vocab gate** — score, retry, persist `vocabPassed`
- **pretest** — per-question logging, `submit()` once, panel unlock
- **mastery integration** — calls `DSMPlayer.init({ ...config.dsm })` with a `state.set` callback
- **practice test** — same shape as pretest, longer
- **results** — read state, render summary
- **autosave** — debounced quiz_progress write on every state change
- **heartbeat** — `solAPI.pingProgress` on visibility-aware timer
- **session-end beacon** — `solAPI.beacon` on unload

Engine integrates with already-extracted modules:
- `sol-api.js` — REST + auth + buffer + module-release gate
- `dsm-player.js` — mastery quiz UI

**Tests:** unit tests against the engine API (state transitions, scoring math, panel locks). NOT browser tests yet; that's Step 3.

### Step 3 — Pilot: migrate unit-1.html (~30 min)

Replace unit-1's inline `<script>` (everything between `<script>` and `</script>` after sol-api.js loads) with:

```html
<script src="unit-engine.js?v=2026-05-03-phaseD"></script>
<script src="unit-1-config.js?v=2026-05-03-phaseD"></script>
<script>UnitEngine.boot(window.UNIT_1_CONFIG);</script>
```

Where `unit-1-config.js` is a new file holding the per-unit data (~300 LOC of question banks + metadata).

**Verification:**
1. Local Playwright smoke test passes
2. Push to a preview branch; manual end-to-end on Vercel preview URL:
   - Sign in via Google
   - Pretest 5 questions, see scores land in DB with `auth_user_id` populated
   - Vocab pass
   - Mastery completes, DSM attempt + score rows land
   - Practice test 20 questions land
   - Reload mid-flow, state restored from `quiz_progress`
   - Sign out, sign in as different user, no state leak

**Gate before Step 4:** Mark sees pilot working end-to-end.

### Step 4 — Propagate to unit-2..8 (~1 evening)

Mechanical translation following the unit-1 recipe. Each migration:
1. Extract per-unit data to `unit-N-config.js`
2. Replace inline `<script>` with the 3-line boot
3. Smoke test the unit
4. Commit (one commit per unit so revert is targeted)

Use a Python script for the boilerplate (similar to `tools/cachebust-sol-api.py`). Don't try to extract the lesson HTML itself; that's Phase D2.

### Step 5 — Cleanup + cross-unit regression (~30 min)

- Delete dead per-page code paths
- Update `dsm-player.js` if needed (it currently reads per-unit globals; engine should provide them or DSM moves to `state`-passing)
- Update `tests/unit-1-smoke.spec.js` to verify against multiple units
- Update memory + AGENTS.md / CLAUDE.md
- Bump cache-bust everywhere to `?v=2026-05-03-phaseD`
- Final regression: complete end-to-end on unit-1, unit-3, unit-7 (varied content, different units)

### Step 6 — Unlock and monitor (Monday)

- Re-flip `module_releases.unlocked = true` per unit as you start the school day
- Watch live activity for the first class period
- Have the rollback commit handy: any unit-N.html commit can be reverted independently
- Phase 2 RLS is in place, so any silent data-loss bug surfaces as 401s in the buffer (Audit #12 toast)

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Engine bug = 9 units broken | Pilot Step 3 with full verification before propagation |
| DSM player coupling to per-unit globals | Step 5 updates dsm-player.js if needed; engine provides what player expects |
| In-flight student state lost | Lockout is up; nobody is mid-quiz. Fresh state on Monday. |
| Practice-test.html drift | Defer to Phase D2; engine designed to accommodate later |
| Cache-bust forgotten on a page | Final regression catches; `?v=2026-05-03-phaseD` consistent across all 9 |
| Phase 2 RLS regression | Already shipped + tested; engine inherits via solAPI calls |

## Rollback

Every step is its own commit. Per-unit migration is one commit each. If unit-3 breaks post-deploy, `git revert <unit-3-commit>` recovers that page only — others stay on the new engine. Lockout is the broader safety net: re-flipping `unlocked = false` on a unit kills student access while you investigate.

---

## What stays out of scope

- **practice-test.html** — Phase D2 candidate
- **Lesson HTML extraction** — Option B / Phase D2
- **Config-driven lessons** — Option C / Phase D3
- **Phase 2.5b** (denormalize teacher tables) — separate track
- **FERPA Phase 6** (audit logging) — separate track
- **Class-code UX rework** (one-click invite links) — separate track

---

## Effort estimate

| Step | Hours |
|---|---|
| 1 — Survey + design doc | 1-2 |
| 2 — Build engine | 4-6 |
| 3 — Pilot unit-1 | 0.5-1 |
| 4 — Propagate unit-2..8 | 2-3 |
| 5 — Cleanup + regression | 0.5-1 |
| 6 — Unlock + monitor | 0.5 |
| **Total** | **8-13** |

Realistic: 10-12 hours over the weekend with margin for one "huh, that's weird."

---

## Decisions log

- 2026-05-02: Scope = **Option A** (logic-only)
- 2026-05-02: practice-test.html = **deferred** to Phase D2
- 2026-05-02: Pilot unit = **unit-1** (already smoke-tested)
- 2026-05-02: Lockout strategy = **all units locked** until Monday morning per-unit unlock
