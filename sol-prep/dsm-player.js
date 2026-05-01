/* ================================================================
   DSM Player — Dynamic Study Module Mastery Quiz Engine
   Shared across all SOL Prep unit pages.

   Usage: DSMPlayer.init({ ... }) called from each unit file.
   Requires sol-api.js to be loaded first.

   Hardened 2026-05-01 against the 14 issues identified in
   DSM_AUDIT_REPORT.md (root of repo) plus the round-parity
   misclassification documented in DSM-MASTERY-FIX.md.
   ================================================================ */

var DSMPlayer = (function() {

  // ── CONFIG (set by init) ──
  var config = {
    unitNumber: 0,
    standard: '',        // e.g. 'BIO.4'
    unitKey: '',         // e.g. 'unit4'
    moduleName: '',      // e.g. 'SOL Prep — Unit 4: Bacteria & Viruses'
    panelId: 0,          // which panel number the DSM is on
    containerId: '',     // DOM id of the container div
    unlockPanels: [],    // panel numbers to unlock on completion
    onComplete: null,    // callback when mastery achieved
    onSkip: null         // callback when no DSM is available
  };

  // ── STATE ──
  var questions = [];      // all questions from Supabase
  var moduleId = null;     // dsm_modules.id
  var pool = [];           // current round's question indices
  var currentIdx = 0;      // position in pool
  var round = 1;           // 1=full attempt, 2=review missed, 3=review again, ...
  var attemptNumber = 1;   // counts FULL attempts only
  var missed = [];         // indices missed this round
  var allMissed = [];      // { round, questionId, questionText } across all rounds
  var attemptId = null;
  var attemptCreatePromise = null;  // chain target for completion update (#7)
  var completed = false;
  var started = false;
  var totalAnswered = 0;
  var advancing = false;   // guards next-question races (#12)

  // ── INIT ──────────────────────────────────────────────────────
  // Idempotent (#8). Fetches the current published DSM module FIRST so
  // we know its ID, then probes the DB scoped by module ID (#11) plus
  // student/lesson. This means a republished DSM (new module ID) does
  // not credit a student who passed the old module. Historical mastery
  // (rows with NULL dsm_module_id from before that column existed)
  // continues to count.
  //
  // #9: Distinguishes "no row" from "lookup failed" via
  // lookupScoreStrict — a network blip never wipes a legitimate
  // 'passed' flag.
  // #10: Always probes DB when student name available (cross-device).
  function init(opts) {
    config = Object.assign(config, opts);
    var container = document.getElementById(config.containerId);
    if (!container) return;

    // Guard against re-init while a quiz is in progress (#8).
    if (started && !completed) return;

    // Reset state. Don't reset `completed` — that's set deliberately.
    questions = [];
    moduleId = null;
    pool = [];
    currentIdx = 0;
    round = 1;
    attemptNumber = 1;
    missed = [];
    allMissed = [];
    attemptId = null;
    attemptCreatePromise = null;
    started = false;
    totalAnswered = 0;
    advancing = false;

    container.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280">'
      + '<div style="font-size:1.5rem;margin-bottom:8px">Loading Mastery Module&hellip;</div></div>';

    // Step 1: fetch the current published module + questions. This
    // gives us the moduleId that subsequent lookups must match.
    solAPI.getDSMQuestions(config.standard).then(function(result) {
      // Defense-in-depth (#2): require a real array.
      if (!result || !result.module || !Array.isArray(result.questions) || result.questions.length === 0) {
        container.innerHTML = dsmNotAvailableHTML();
        if (config.onSkip) config.onSkip();
        return;
      }
      moduleId = result.module.id;
      questions = result.questions;

      // Step 2: probe DB scoped by THIS module ID (or NULL for historical).
      var sName = (typeof studentName !== 'undefined' && studentName) ? studentName : '';
      var hasName = !!sName;
      var lsPassed = (localStorage.getItem('sol_' + config.unitKey + '_dsm') === 'passed');

      if (hasName && config.moduleName && typeof solAPI.lookupScoreStrict === 'function') {
        solAPI.lookupScoreStrict(sName, config.moduleName, 'Mastery Module', moduleId)
          .then(function(prior) {
            if (prior) {
              // Score for THIS module (or historical NULL) — credit it.
              localStorage.setItem('sol_' + config.unitKey + '_dsm', 'passed');
              completed = true;
              container.innerHTML = dsmCompletedHTML();
              if (config.onComplete) config.onComplete();
            } else {
              // No matching score. Clear stale localStorage flag if it
              // was for a since-replaced module; show ready screen.
              if (lsPassed) localStorage.removeItem('sol_' + config.unitKey + '_dsm');
              container.innerHTML = dsmReadyHTML();
            }
          })
          .catch(function(err) {
            // Lookup FAILED (network/RLS). Trust localStorage as fallback.
            console.warn('[DSM] lookupScoreStrict failed; trusting localStorage:', err && err.message);
            if (lsPassed) {
              completed = true;
              container.innerHTML = dsmCompletedHTML();
              if (config.onComplete) config.onComplete();
            } else {
              container.innerHTML = dsmReadyHTML();
            }
          });
      } else {
        // No name yet OR no lookupScoreStrict. Trust localStorage.
        if (lsPassed) {
          completed = true;
          container.innerHTML = dsmCompletedHTML();
          if (config.onComplete) config.onComplete();
        } else {
          container.innerHTML = dsmReadyHTML();
        }
      }
    });
  }

  // ── START ─────────────────────────────────────────────────────
  function start() {
    if (started) return;
    started = true;
    round = 1;
    attemptNumber = 1;
    missed = [];
    allMissed = [];
    totalAnswered = 0;
    advancing = false;
    completed = false;

    // Shuffle all questions for round 1 (full attempt)
    pool = shuffleArray(Array.from({ length: questions.length }, function(_, i) { return i; }));
    currentIdx = 0;

    // #4: Use the page-scope `studentName` (set by proceedStart). The
    // old `document.getElementById('student-name')` lookup never matched
    // anything on SOL-prep pages — those use student-first-name +
    // student-last-name and the page-scope variable. Result of the bug:
    // every dsm_attempts row across all 8 units said 'Unknown'.
    var sName = (typeof studentName !== 'undefined' && studentName) ? studentName : 'Unknown';

    // #7: Track the create promise so completion can chain to it if the
    // student finishes faster than the network round-trip (Slow 3G case).
    attemptCreatePromise = solAPI.createDSMAttempt({
      studentName: sName,
      moduleId: moduleId,
      unitNumber: config.unitNumber,
      totalQuestions: questions.length
    }).then(function(data) {
      if (data && data.length > 0) attemptId = data[0].id;
      return attemptId;
    }).catch(function() { return null; });

    if (typeof send === 'function') {
      send({ action: 'activity', event: 'dsm_start', lesson: 'Mastery Module',
        timestamp: new Date().toISOString() });
    }

    showQuestion();
  }

  // ── SHOW QUESTION ─────────────────────────────────────────────
  function showQuestion() {
    var container = document.getElementById(config.containerId);
    var qIdx = pool[currentIdx];
    var q = questions[qIdx];
    var remaining = pool.length - currentIdx;

    var html = '<div class="dsm-progress-bar">';
    html += '<div class="dsm-round-info">Round ' + round + ' &middot; Question ' + (currentIdx + 1) + ' of ' + pool.length + '</div>';
    html += '<div class="dsm-remaining">' + remaining + ' remaining</div>';
    html += '</div>';

    var pct = Math.round((currentIdx / pool.length) * 100);
    html += '<div class="dsm-track"><div class="dsm-track-fill" style="width:' + pct + '%"></div></div>';

    // data-answered guards against double-click/touch reentrance (#12)
    html += '<div class="dsm-question-card" id="dsm-active-card" data-answered="0">';
    html += '<div class="dsm-q-stem-live">' + escDSM(q.question_text) + '</div>';
    html += '<div class="dsm-opts-live">';
    var opts = [
      { letter: 'A', text: q.option_a, value: 'a' },
      { letter: 'B', text: q.option_b, value: 'b' },
      { letter: 'C', text: q.option_c, value: 'c' },
      { letter: 'D', text: q.option_d, value: 'd' }
    ];
    opts.forEach(function(o) {
      html += '<div class="dsm-opt-live" data-value="' + o.value + '" onclick="DSMPlayer.handleAnswer(\'' + o.value + '\')">';
      html += '<div class="dsm-opt-letter">' + o.letter + '</div>';
      html += '<div class="dsm-opt-text">' + escDSM(o.text) + '</div>';
      html += '</div>';
    });
    html += '</div>';
    html += '<div class="dsm-explanation" id="dsm-explanation" style="display:none">' + escDSM(q.explanation) + '</div>';
    html += '<button class="dsm-next-btn" id="dsm-next-btn" style="display:none" onclick="DSMPlayer.nextQuestion()">Next Question &rarr;</button>';
    html += '</div>';

    container.innerHTML = html;
  }

  // ── HANDLE ANSWER ─────────────────────────────────────────────
  function handleAnswer(chosen) {
    // #12: Per-card answer guard. Once an answer has been recorded for
    // this card, subsequent clicks/touches on options are ignored. Catches
    // ghost-clicks on Chromebook touchscreens and keyboard repeat events.
    var card = document.getElementById('dsm-active-card');
    if (card && card.dataset.answered === '1') return;
    if (card) card.dataset.answered = '1';

    var qIdx = pool[currentIdx];
    var q = questions[qIdx];
    var correctAns = q.correct_answer;
    var isCorrect = chosen === correctAns;

    totalAnswered++;

    var allOpts = document.querySelectorAll('.dsm-opt-live');
    allOpts.forEach(function(el) {
      el.style.pointerEvents = 'none';
      if (el.dataset.value === correctAns) el.classList.add('dsm-correct');
      if (el.dataset.value === chosen && !isCorrect) el.classList.add('dsm-incorrect');
    });

    if (isCorrect) {
      // Auto-advance after delay. `advancing` flag prevents manual
      // nextQuestion() calls during the timeout from double-firing.
      advancing = true;
      setTimeout(function() { advancing = false; nextQuestion(); }, 800);
    } else {
      missed.push(qIdx);
      allMissed.push({ round: round, questionId: q.id, questionText: q.question_text });
      var expEl = document.getElementById('dsm-explanation');
      if (expEl) expEl.style.display = 'block';
      var nextBtn = document.getElementById('dsm-next-btn');
      if (nextBtn) nextBtn.style.display = 'inline-block';
    }
  }

  // ── NEXT QUESTION ─────────────────────────────────────────────
  function nextQuestion() {
    if (advancing) return;
    currentIdx++;

    if (currentIdx >= pool.length) {
      // Bug 3 fix: anchor "full attempt" detection on what `full` actually
      // means — the pool covers every question. Round parity was fragile:
      // startNextRound() incremented `round` even when continuing within
      // a review cycle, breaking parity-based logic and producing bogus
      // 1/N=100% score rows like Kiera Looney's 4-row burst on 2026-05-01.
      var isFullAttempt = (pool.length === questions.length);

      if (isFullAttempt) {
        var correct = pool.length - missed.length;
        var total = pool.length;
        var pct = total > 0 ? Math.round((correct / total) * 100) : 0;
        var threshold = (typeof solAPI.getMasteryThreshold === 'function')
          ? solAPI.getMasteryThreshold() : 100;

        if (pct >= threshold) {
          complete(correct, total, pct);
          return;
        }
        // Below threshold. If missed.length === 0 here, something is
        // structurally wrong (impossible if threshold ≤ 100). Log and
        // bail rather than trying to "fail-safe" by completing (#6).
        if (missed.length === 0) {
          console.error('[DSM] unreachable: full attempt with 0 missed but pct ' + pct + ' < threshold ' + threshold);
          // Don't call complete(); show the review prompt anyway so the
          // student isn't credited with mastery they didn't demonstrate.
          showFullAttemptReviewPrompt();
          return;
        }
        showFullAttemptReviewPrompt();
      } else {
        // Review round just finished.
        if (missed.length === 0) {
          // #5: Student demonstrated mastery on review — credit it.
          // The prior strict-spec behavior (forcing a fresh full attempt)
          // punished clean recovery and was the loop that fed Bug 3's
          // misclassification. Lenient: every question has now been
          // answered correctly at some point, so award mastery with the
          // full pool size as both `correct` and `total`.
          complete(questions.length, questions.length, 100);
        } else {
          showRoundInterstitial();
        }
      }
    } else {
      showQuestion();
    }
  }

  // ── FULL-ATTEMPT REVIEW PROMPT (after odd round below threshold) ─
  function showFullAttemptReviewPrompt() {
    var container = document.getElementById(config.containerId);
    var correct = pool.length - missed.length;
    var pct = pool.length > 0 ? Math.round((correct / pool.length) * 100) : 0;
    var threshold = (typeof solAPI.getMasteryThreshold === 'function')
      ? solAPI.getMasteryThreshold() : 100;

    var html = '<div class="dsm-interstitial">';
    html += '<div class="dsm-inter-icon">&#128221;</div>';
    html += '<div class="dsm-inter-title">Attempt ' + attemptNumber + ' Complete</div>';
    html += '<div class="dsm-inter-stat">' + correct + ' / ' + pool.length + ' correct (' + pct + '%)</div>';
    html += '<div class="dsm-inter-msg">You need <strong>' + threshold + '%</strong> for mastery. Let\'s review the ones you missed before trying again.</div>';
    html += '<div class="dsm-inter-sub">' + missed.length + ' question' + (missed.length !== 1 ? 's' : '') + ' to review.</div>';
    html += '<button class="dsm-start-btn" onclick="DSMPlayer.startNextRound()">Begin Review &rarr;</button>';
    html += '</div>';

    container.innerHTML = html;

    if (typeof send === 'function') {
      send({ action: 'activity', event: 'dsm_attempt_complete', lesson: 'Mastery Module',
        metadata: JSON.stringify({ attempt: attemptNumber, correct: correct, total: pool.length, pct: pct, threshold: threshold }) });
    }
  }

  // ── ROUND INTERSTITIAL (mid-review when still missing some) ────
  function showRoundInterstitial() {
    var container = document.getElementById(config.containerId);
    var missedCount = missed.length;

    var html = '<div class="dsm-interstitial">';
    html += '<div class="dsm-inter-icon">&#128257;</div>';
    html += '<div class="dsm-inter-title">Keep Reviewing</div>';
    html += '<div class="dsm-inter-stat">' + (pool.length - missedCount) + ' / ' + pool.length + ' correct in this review</div>';
    html += '<div class="dsm-inter-msg">' + missedCount + ' question' + (missedCount !== 1 ? 's' : '') + ' to keep reviewing.</div>';
    html += '<button class="dsm-start-btn" onclick="DSMPlayer.startNextRound()">Continue &rarr;</button>';
    html += '</div>';

    container.innerHTML = html;
  }

  // Cycle missed (review). Round increments — used to mean "even round =
  // review", but with Bug 3's fix the round counter is informational only;
  // round-type detection now uses pool.length === questions.length.
  function startNextRound() {
    round++;
    pool = shuffleArray(missed.slice());
    missed = [];
    currentIdx = 0;
    showQuestion();
  }

  // Reshuffle ALL questions for a fresh full attempt.
  function startFreshFullAttempt() {
    round++;
    attemptNumber++;
    pool = shuffleArray(Array.from({ length: questions.length }, function(_, i) { return i; }));
    missed = [];
    currentIdx = 0;
    showQuestion();
  }

  // ── COMPLETE ──────────────────────────────────────────────────
  // Receives the actual score from the call site. No reconstruction.
  function complete(correct, total, pct) {
    if (completed) return;  // double-call guard
    completed = true;

    // #1, #3: defensive validation. If caller passed garbage, log and
    // bail with safe zeros rather than silently substituting questions.length.
    if (typeof correct !== 'number' || typeof total !== 'number' || total <= 0) {
      console.error('[DSM] complete() invalid args', { correct: correct, total: total, pct: pct });
      correct = 0;
      total = (questions.length > 0) ? questions.length : 1;
      pct = 0;
    } else {
      // Re-derive pct as single source of truth, but only if the caller's
      // value disagrees by more than 1 (FP rounding tolerance).
      var derived = Math.round((correct / total) * 100);
      if (typeof pct !== 'number' || Math.abs(pct - derived) > 1) pct = derived;
    }

    localStorage.setItem('sol_' + config.unitKey + '_dsm', 'passed');

    // #7: Update the attempts row, chaining to the create promise if
    // the row hasn't been created yet (slow network case).
    function applyAttemptUpdate() {
      if (!attemptId) return Promise.resolve();
      return solAPI.updateDSMAttempt(attemptId, {
        completed: true,
        completed_at: new Date().toISOString(),
        rounds_completed: round,
        questions_missed: allMissed
      });
    }
    if (attemptId) {
      applyAttemptUpdate();
    } else if (attemptCreatePromise) {
      attemptCreatePromise.then(applyAttemptUpdate);
    }

    // #13: Submit the score. Hold the promise so we can transition the UI
    // *after* the write fires onto the wire — guaranteeing the student
    // doesn't navigate away before _postWithRetry has had a chance to
    // attempt the request. The buffered-retry layer handles transient
    // failures, but synchronous tab-close mid-fetch can still cancel.
    //
    // #11: Tag the score with the dsm_modules.id so a future republish
    // (new module ID) correctly invalidates this row at lookup time.
    var scorePromise = (typeof send === 'function')
      ? send({ action: 'score', lesson: 'Mastery Module', score: correct, total: total, pct: pct, dsmModuleId: moduleId })
      : Promise.resolve();

    // _postWithRetry never rejects (it buffers on failure), so this .then
    // always fires.
    Promise.resolve(scorePromise).then(function() {
      if (typeof send === 'function') {
        send({ action: 'activity', event: 'dsm_complete', lesson: 'Mastery Module',
          metadata: JSON.stringify({ rounds: round, attempts: attemptNumber, score: pct, totalMissed: allMissed.length }) });
      }
      var container = document.getElementById(config.containerId);
      if (container) container.innerHTML = dsmCompleteScreenHTML(correct, total, pct);
      if (config.onComplete) config.onComplete();
      if (typeof saveProgress === 'function') saveProgress();
    });
  }

  // ── QUIT ──────────────────────────────────────────────────────
  // Currently unreachable (not exposed in public API) but kept correct
  // in case it's re-exposed. #14: full state reset.
  function quit() {
    if (!confirm('Quit the Mastery Module? Your score will be recorded as 0. You can try again later.')) return;

    if (attemptId) {
      solAPI.updateDSMAttempt(attemptId, {
        completed: false,
        rounds_completed: round,
        questions_missed: allMissed
      });
    }
    if (typeof send === 'function') {
      send({ action: 'score', lesson: 'Mastery Module', score: 0, total: questions.length, pct: 0 });
    }

    // Full state reset for clean retry — match init()'s reset block.
    started = false;
    advancing = false;
    completed = false;
    pool = [];
    currentIdx = 0;
    round = 1;
    attemptNumber = 1;
    missed = [];
    allMissed = [];
    totalAnswered = 0;
    attemptId = null;
    attemptCreatePromise = null;

    var container = document.getElementById(config.containerId);
    container.innerHTML = dsmReadyHTML();
  }

  // ── HTML TEMPLATES ────────────────────────────────────────────
  function dsmReadyHTML() {
    var threshold = (typeof solAPI.getMasteryThreshold === 'function')
      ? solAPI.getMasteryThreshold() : 100;
    return '<div class="dsm-ready">'
      + '<div class="dsm-ready-icon">&#129504;</div>'
      + '<div class="dsm-ready-title">Mastery Module</div>'
      + '<div class="dsm-ready-sub">' + questions.length + ' questions &middot; ' + config.standard + '</div>'
      + '<div class="dsm-ready-desc">Reach <strong>' + threshold + '%</strong> on a full attempt to achieve mastery, OR get every missed question right on review. Whichever comes first.</div>'
      + '<div class="dsm-ready-rules">'
      + '<div class="dsm-rule">&#10003; Correct answers advance automatically</div>'
      + '<div class="dsm-rule">&#10007; Wrong answers show the explanation</div>'
      + '<div class="dsm-rule">&#127942; Mastery = ' + threshold + '% on full attempt OR clean review pass</div>'
      + '</div>'
      + '<button class="dsm-start-btn" onclick="DSMPlayer.start()">Begin Mastery Module &rarr;</button>'
      + '</div>';
  }

  function dsmNotAvailableHTML() {
    return '<div class="dsm-ready">'
      + '<div class="dsm-ready-icon">&#128203;</div>'
      + '<div class="dsm-ready-title">Mastery Module</div>'
      + '<div class="dsm-ready-sub">Not yet available for this unit</div>'
      + '<div class="dsm-ready-desc">Your teacher hasn\'t set up the Mastery Module for ' + config.standard + ' yet. You can continue to the Study Guide and Practice Test.</div>'
      + '</div>';
  }

  function dsmCompletedHTML() {
    return '<div class="dsm-ready">'
      + '<div class="dsm-ready-icon">&#127942;</div>'
      + '<div class="dsm-ready-title">Mastery Achieved!</div>'
      + '<div class="dsm-ready-sub">You\'ve mastered ' + config.standard + '</div>'
      + '<div class="dsm-ready-desc">Great work! Continue to the Practice Test to measure your SOL proficiency.</div>'
      + '</div>';
  }

  function dsmCompleteScreenHTML(correct, total, pct) {
    correct = (correct == null) ? questions.length : correct;
    total = (total == null) ? questions.length : total;
    pct = (pct == null) ? 100 : pct;
    var perfect = (pct === 100);
    var subtitle = perfect
      ? (attemptNumber === 1 ? 'Perfect — first try!' : 'Took ' + attemptNumber + ' attempts, but you nailed it.')
      : 'You hit the mastery threshold on attempt ' + attemptNumber + '.';
    return '<div class="dsm-complete-screen">'
      + '<div class="dsm-complete-icon">&#127881;</div>'
      + '<div class="dsm-complete-title">Mastery Achieved!</div>'
      + '<div class="dsm-complete-stat">' + correct + '/' + total + ' correct (' + pct + '%)</div>'
      + '<div class="dsm-complete-sub">' + subtitle + '</div>'
      + '<div class="dsm-complete-detail">'
      + (allMissed.length > 0 ? '<div style="margin-top:12px;font-size:.85rem;color:#64748b">Total questions reviewed: ' + totalAnswered + ' &middot; Unique misses: ' + allMissed.length + '</div>' : '')
      + '</div>'
      + '<button class="dsm-start-btn" onclick="goTo(' + (config.panelId + 1) + ')">Continue to Study Guide &rarr;</button>'
      + '</div>';
  }

  // ── HELPERS ───────────────────────────────────────────────────
  function shuffleArray(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function escDSM(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── PUBLIC API ────────────────────────────────────────────────
  // quit() exists in this module but is intentionally NOT exposed —
  // students must complete mastery before proceeding.
  return {
    init: init,
    start: start,
    handleAnswer: handleAnswer,
    nextQuestion: nextQuestion,
    startNextRound: startNextRound,
    startFreshFullAttempt: startFreshFullAttempt,
    isCompleted: function() { return completed; }
  };

})();
