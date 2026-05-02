# Phase D — Unit Engine Design

**Status:** draft, awaiting Mark's review before Step 2 (build)
**Generated:** 2026-05-02 from a survey of `unit-1.html` and `unit-2.html` (with cross-checks against unit-3..8)

---

## What I found in the survey

`unit-1.html` and `unit-2.html` define **the same 28 functions** with **the same names** and the same call shapes. The differences are:

1. **Per-unit constants:** `UNIT`, `TOTAL_PANELS`, `TOTAL_SOL_Q`, `TOTAL_CARDS`, `VQ_TOTAL`, `VQ_PASS`, `DSM_PANEL`
2. **Per-unit data:** `VQ_CORRECT` (vocab answer key), `VQ_EXPLAIN` (explanations), `gateRequired` (per-panel question counts), `stepNames`
3. **Per-unit strings:** `moduleName` ('SOL Prep — Unit X: ...'), `standard` ('BIO.X')
4. **Per-unit DSM init:** `unlockPanels` (which panels open after Mastery)
5. **Lesson HTML:** the actual content of panels 0-N — unique per unit
6. **Unit-1 only:** `graphPick`, `graphPick2`, `initCharts` — chart-question UI specific to BIO.1c

`DSMPlayer.init({...})` is called **three times** in unit-1 with the same config — same in every unit page. The engine will call it **once**.

The 28 shared functions cluster into 7 concerns:

| Concern | Functions | Notes |
|---|---|---|
| Lifecycle | `startUnit`, `proceedStart`, `startFresh`, `initMeta` | wires class hydration → SSO → vocab pass restoration → DSM init |
| State + sync | `saveProgress`, `restoreProgress`, `send` | already proxies to `solAPI.submit/saveProgress` |
| Heartbeat | `startHeartbeat`, `stopHeartbeat` | identical across all 9 |
| Panel nav | `goTo`, gate-required + DSM-panel branching | `stepNames`, `gateRequired`, `DSM_PANEL` are per-unit data |
| Gate Qs | `gateAnswer`, `checkGate` | reads `data-ans` from inline HTML; engine doesn't need per-unit logic |
| Vocab | `flipCard`, `vqPick`, `gradeVocab`, `retryVocab` | uses `VQ_CORRECT` / `VQ_EXPLAIN` from config |
| Practice + results | `solPick`, `showDangerZone`, `submitFinalScore`, `retakePractice` | reads `data-correct` from inline HTML |
| Locks (pretest/practice) | `checkPretestLock`, `applyPretestLockUI`, `checkPracticeRetakeLock`, `applyPracticeLockUI` | identical across units |
| SSO | `applySSOSession`, `clearSSOSession`, `signInWithGoogle` | identical |
| UI | `showToast` | identical |

**Conclusion:** Option A (logic-only extraction) is the right call. ~80% of the per-page JS is engine-bound. Lesson HTML stays inline. `data-*` attributes on lesson HTML are the contract between page and engine — no per-unit JS handlers needed.

---

## Proposed `UnitEngine.boot(config)` API

### Loading

The unit page loads three scripts in order:

```html
<script src="sol-api.js?v=2026-05-03-phaseD"></script>
<script src="dsm-player.js?v=2026-05-03-phaseD"></script>
<script src="unit-engine.js?v=2026-05-03-phaseD"></script>

<!-- per-unit config (all the per-unit data from the table above) -->
<script src="config/unit-1.js?v=2026-05-03-phaseD"></script>

<script>UnitEngine.boot(window.UNIT_CONFIG);</script>
```

`config/unit-N.js` is a new sibling directory (`sol-prep/config/`) holding the per-unit data files. Each is ~150-300 LOC of pure data, no logic.

### Config shape (the contract)

```js
window.UNIT_CONFIG = {
  // ── Identity ───────────────────────────────────
  unitNumber:    1,                                                 // 1-8
  unitKey:       'unit1',                                           // localStorage key prefix
  standard:      'BIO.1',                                           // DSM module standard
  moduleName:    'SOL Prep — Unit 1: Scientific Investigation', // display + DB module field
  unitTitle:     'Scientific Investigation',                        // page-title fragment

  // ── Panel structure ───────────────────────────
  totalPanels:   12,
  dsmPanelId:    8,                          // which panel hosts the Mastery quiz
  stepNames: [
    'SOL Focus', 'Hypotheses & Variables', 'Planning Investigations',
    'Data Tables & Graphs', 'Conclusions & Evidence', 'Scientific Models',
    'Evaluating Sources', 'Vocab Lock-In', 'Mastery Module',
    'Study Guide', 'Practice Test', 'Results'
  ],
  unlockOnMastery: [9, 10, 11],              // panels to unlock after DSMPlayer.onComplete

  // ── Gate (per-panel question requirements) ────
  gateRequired: { 0: 5, 1: 2, 2: 2, 3: 4, 4: 2, 5: 2, 6: 2 },

  // ── Vocab gate ────────────────────────────────
  vocab: {
    total:   10,
    pass:    8,
    correct: { 1:'b', 2:'c', 3:'b', 4:'c', 5:'b', 6:'c', 7:'d', 8:'c', 9:'b', 10:'a' },
    explain: { 1: '...', 2: '...', /* etc */ }
  },

  // ── Counts (used for progress UI + scoring) ──
  totalCards:     18,
  totalSolQ:      20,

  // ── DSM player options (passed to DSMPlayer.init) ─
  dsm: {
    containerId:  'dsm-container',
    timeoutMs:    5000   // override default if needed
  }
};
```

That's the entire config. ~50 lines of declarative data per unit. Anything that isn't in this object is either inline HTML (lessons) or in the engine.

### Engine surface

```js
window.UnitEngine = {
  /**
   * Wire a unit page to a fully-managed lifecycle. Call once on load.
   * Returns a Promise that resolves once initial hydration is complete.
   */
  boot: function(config) { ... },

  /**
   * State accessor — useful for inline HTML hooks like the chart panels
   * in unit-1 that need to mark `state.graphAnswered.graph1 = true`.
   * Reads/writes are tracked, autosaved, and broadcast to subscribers.
   */
  state: {
    get: function(path) { ... },
    set: function(path, value) { ... },
    subscribe: function(path, fn) { ... }
  },

  /**
   * DOM event handlers that inline HTML buttons call directly.
   * Replace per-page implementations of the same names.
   */
  onGateAnswer:  function(el) { ... },
  onVqPick:      function(el) { ... },
  onFlipCard:    function(el) { ... },
  onSolPick:     function(opt) { ... },
  goTo:          function(panelId) { ... },
  retakePractice:function() { ... },
  submitFinalScore: function() { ... },
  showDangerZone: function() { ... },
  showToast:     function(msg) { ... },

  /**
   * Per-unit escape hatch — for unit-1's graphs and any future
   * unit-specific gates that need to mark something answered.
   */
  markAnswered: function(key, value) { /* state.graphAnswered[key] = value */ }
};
```

Pages call `UnitEngine.onGateAnswer(this)` from inline `<button onclick="UnitEngine.onGateAnswer(this)">` instead of `<button onclick="gateAnswer(this)">`. That's the only HTML change required.

### State shape (single source of truth)

```js
state = {
  // identity
  studentName:   '',
  classCode:     '',
  classId:       null,

  // panel progression
  currentPanel:  0,
  unlockedPanels: new Set([0]),
  panelStartTime: Date.now(),
  sessionStart:  Date.now(),

  // gate progress
  gateAnswered:  {},                 // { panelId: Set<idx> }
  graphAnswered: {},                 // generic key/value, populated by markAnswered()

  // pretest
  pretestAnswers:        [],
  pretestSent:           false,
  pretestAlreadySubmitted: false,    // populated by checkPretestLock
  priorPretestScore:     null,

  // vocab
  flippedCards:  new Set(),
  vqAnswers:     {},                 // { qNum: chosenLetter }
  vqScore:       0,
  vocabPassed:   false,

  // practice
  pracAnswered:  0,
  pracCorrect:   0,
  practiceAlreadySubmitted: false,
  priorPracticeScore: null,

  // misc
  missedStds:    {},                 // { 'BIO.1a': count }
  questionDetail: [],                // detailed log for quiz_detail writes
  activityLog:   [],                 // panel-time log
  activeSession: false               // set true after vocab pass
};
```

Every `state.set(path, value)` triggers:
1. The change is applied
2. `saveProgress()` is debounced (1.5s)
3. Subscribers are notified

This replaces the dozens of `saveProgress()` calls scattered across each page.

### Lifecycle hooks (only if needed)

The engine should NOT need any per-unit hooks for Option A. If a unit needs special behavior (e.g., unit-1's chart questions), it uses `state.set` / `markAnswered` from inline HTML, not a hook.

If we discover a hook IS needed during build (e.g., a unit has a panel with a custom JS interaction that doesn't fit the generic gate pattern), we add it as a config field:

```js
config.onPanelEnter = { 3: function(state) { /* unit-1 chart init */ } };
```

But we don't add it speculatively. YAGNI.

---

## Migration recipe per unit

Each unit migration is exactly these five edits, applied mechanically:

### 1. Add the script tags
```html
<script src="sol-api.js?v=2026-05-03-phaseD"></script>
<script src="dsm-player.js?v=2026-05-03-phaseD"></script>
<script src="unit-engine.js?v=2026-05-03-phaseD"></script>
<script src="config/unit-1.js?v=2026-05-03-phaseD"></script>
```

### 2. Delete the inline `<script>` block
Everything between the existing `<script>` and `</script>` after `sol-api.js` loads — gone. ~2500 LOC removed.

### 3. Replace with the boot call
```html
<script>UnitEngine.boot(window.UNIT_CONFIG);</script>
```

### 4. Update `onclick=` handlers in the lesson HTML
- `gateAnswer(this)` → `UnitEngine.onGateAnswer(this)`
- `vqPick(this)` → `UnitEngine.onVqPick(this)`
- `flipCard(this)` → `UnitEngine.onFlipCard(this)`
- `solPick('a')` → `UnitEngine.onSolPick('a')`
- `goTo(N)` → `UnitEngine.goTo(N)`
- `retakePractice()` → `UnitEngine.retakePractice()`
- etc.

### 5. Unit-specific escape-hatch updates (unit-1 only)
- `graphPick(opt, correct)` → inline lesson HTML calls `UnitEngine.markAnswered('graph1', isCorrect)` and updates DOM directly
- `initCharts()` stays in unit-1.html as per-page logic (it's chart rendering for BIO.1c)

Output per unit: page LOC drops from ~3500 to ~700-1000 (almost all of it is lesson HTML).

---

## What dsm-player.js needs from us

`DSMPlayer.init({...})` currently reads from per-unit globals (`UNIT`, `studentName`, etc.). Two paths:

**Path A (preferred):** Engine passes everything explicitly.
```js
DSMPlayer.init({
  unitNumber:   config.unitNumber,
  moduleName:   config.moduleName,
  standard:     config.standard,
  unitKey:      config.unitKey,
  panelId:      config.dsmPanelId,
  containerId:  config.dsm.containerId,
  unlockPanels: config.unlockOnMastery,
  studentName:  state.studentName,        // engine provides
  onComplete:   () => engine._onMasteryComplete(),
  onSkip:       () => engine._onMasterySkip()
});
```

If `dsm-player.js` doesn't currently accept `studentName` as a config param, we add it. Quick edit, low risk.

**Path B (fallback):** Engine writes to a `window.__unitContext` namespace that DSMPlayer reads from. Less clean but doesn't require touching dsm-player.js.

**Decision:** start with Path A. Reads cleaner. If dsm-player.js turns out to be more entangled than it looks, switch to Path B.

---

## What stays per-page

Only inline lesson HTML. Nothing else. Specifically:

- Panel `<div class="panel" id="p0">...</div>` markup with `data-ans`, `data-correct`, etc.
- Pretest questions (HTML with `data-correct`)
- Vocab cards (HTML with vocab-card class)
- Practice test questions
- Unit-1's `<canvas>` elements + `initCharts()` script (chart rendering — special for BIO.1c)
- Any per-unit images, video embeds, custom panel layouts

The engine doesn't render lessons. It wires events.

---

## Test plan for engine (Step 2)

Before Step 3 (pilot migration), the engine ships with a small test harness.

```js
// tests/unit-engine.spec.js (Playwright + browser tests)
test('boot() with valid config initializes state', async () => { ... });
test('goTo(n) blocks navigation to locked panels', async () => { ... });
test('checkGate unlocks next panel when all qs answered', async () => { ... });
test('vocab pass triggers DSMPlayer.init', async () => { ... });
test('saveProgress writes auth_user_id to quiz_progress', async () => { ... });
test('restoreProgress hydrates state from JSONB blob', async () => { ... });
test('SSO sign-out clears state but preserves activeSession=false', async () => { ... });
```

Run before Step 3 starts.

---

## Risks I'm watching during build

1. **Set serialization.** State has `unlockedPanels` and `flippedCards` as `Set`. JSONB storage in `quiz_progress` needs them as arrays. Engine handles serialization/deserialization explicitly — currently each unit does it ad hoc and the bug surface is real (saw "Set is not iterable" in old commits).

2. **`data-*` attribute drift.** If unit-3.html uses `data-answer` instead of `data-ans`, the engine breaks for unit-3. Step 1 add-on: grep all 9 pages for `data-` attributes and document the actual attribute names. Will do this between this doc and Step 2.

3. **Pretest question logging.** unit-1 has a sub-flow that captures `pretestAnswers[]` with question text + chosen + correct + isCorrect. The engine reads this from `data-` attributes plus the chosen button. Need to make sure the data we capture matches what `solAPI.submit({action: 'quizDetail'})` expects.

4. **Mid-deploy failure recovery.** If the engine boots but the config script fails to load, the page shows a blank screen. Add a `window.UNIT_CONFIG` existence check + visible error banner.

---

## Decisions I want from Mark before building

1. **Engine file location.** Propose `sol-prep/unit-engine.js` (sibling to `sol-api.js` and `dsm-player.js`). Configs in `sol-prep/config/unit-N.js`. OK?

2. **`dsm-player.js` adjustments allowed?** Path A above requires adding `studentName` as a config arg. Small change. Yes/no?

3. **Test harness.** Build the test file in Step 2, OR ship the engine without tests and rely on the smoke test + manual run-through? (My preference: ship with tests, ~30 min extra. Tests pay back during Step 4 propagation.)

4. **Anything in the proposed config shape that looks wrong/missing?**

Once you've answered those, I'll proceed to Step 2.
