/* ================================================================
   DSM Player — Dynamic Study Module Mastery Quiz Engine
   Shared across all SOL Prep unit pages.

   Usage: DSMPlayer.init({ ... }) called from each unit file.
   Requires sol-api.js to be loaded first.
   ================================================================ */

var DSMPlayer = (function() {

  // ── CONFIG (set by init) ──
  var config = {
    unitNumber: 0,
    standard: '',        // e.g. 'BIO.4'
    unitKey: '',         // e.g. 'unit4'
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
  var round = 1;           // 1=full attempt, 2=review missed, 3=full again, ...
  var attemptNumber = 1;   // counts FULL attempts only (rounds 1, 3, 5, ...)
  var missed = [];         // indices missed this round
  var allMissed = [];      // { round, questionId, questionText } across all rounds
  var attemptId = null;
  var completed = false;
  var started = false;
  var totalAnswered = 0;
  var bestAttemptScore = 0;       // best % achieved on any FULL attempt
  var bestAttemptCorrect = 0;     // questions correct on the best full attempt
  var lastFullAttemptMissed = 0;  // missed.length at end of most-recent FULL attempt

  // ── INIT ──────────────────────────────────────────────────────
  function init(opts) {
    config = Object.assign(config, opts);
    var container = document.getElementById(config.containerId);
    if (!container) return;

    // Check if already completed (from localStorage)
    if (localStorage.getItem('sol_' + config.unitKey + '_dsm') === 'passed') {
      completed = true;
      container.innerHTML = dsmCompletedHTML();
      if (config.onComplete) config.onComplete();
      return;
    }

    // Show loading state
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280"><div style="font-size:1.5rem;margin-bottom:8px">Loading Mastery Module...</div></div>';

    // Load questions
    solAPI.getDSMQuestions(config.standard).then(function(result) {
      if (!result.module || result.questions.length === 0) {
        // No DSM published for this standard — skip gracefully
        container.innerHTML = dsmNotAvailableHTML();
        if (config.onSkip) config.onSkip();
        return;
      }

      moduleId = result.module.id;
      questions = result.questions;
      container.innerHTML = dsmReadyHTML();
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
    bestAttemptScore = 0;
    bestAttemptCorrect = 0;
    lastFullAttemptMissed = 0;

    // Shuffle all questions for round 1 (full attempt)
    pool = shuffleArray(Array.from({ length: questions.length }, function(_, i) { return i; }));
    currentIdx = 0;

    // Create attempt record
    var studentName = document.getElementById('student-name') ?
      document.getElementById('student-name').value.trim() : '';

    solAPI.createDSMAttempt({
      studentName: studentName || 'Unknown',
      moduleId: moduleId,
      unitNumber: config.unitNumber,
      totalQuestions: questions.length
    }).then(function(data) {
      if (data && data.length > 0) attemptId = data[0].id;
    });

    // Log activity
    if (typeof send === 'function') {
      send({ action: 'activity', event: 'dsm_start', lesson: 'Mastery Module', timestamp: new Date().toISOString() });
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

    // Progress track
    var pct = Math.round((currentIdx / pool.length) * 100);
    html += '<div class="dsm-track"><div class="dsm-track-fill" style="width:' + pct + '%"></div></div>';

    html += '<div class="dsm-question-card" id="dsm-active-card">';
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

    html += '<div style="text-align:center;margin-top:16px"><button class="dsm-quit-btn" onclick="DSMPlayer.quit()">Quit Early (score: 0)</button></div>';

    container.innerHTML = html;
  }

  // ── HANDLE ANSWER ─────────────────────────────────────────────
  function handleAnswer(chosen) {
    var qIdx = pool[currentIdx];
    var q = questions[qIdx];
    var correct = q.correct_answer;
    var isCorrect = chosen === correct;

    totalAnswered++;

    // Disable all options
    var allOpts = document.querySelectorAll('.dsm-opt-live');
    allOpts.forEach(function(el) {
      el.style.pointerEvents = 'none';
      if (el.dataset.value === correct) {
        el.classList.add('dsm-correct');
      }
      if (el.dataset.value === chosen && !isCorrect) {
        el.classList.add('dsm-incorrect');
      }
    });

    if (isCorrect) {
      // Correct — auto-advance after delay
      setTimeout(function() { nextQuestion(); }, 800);
    } else {
      // Wrong — show explanation, require manual advance
      missed.push(qIdx);
      allMissed.push({ round: round, questionId: q.id, questionText: q.question_text });

      var expEl = document.getElementById('dsm-explanation');
      if (expEl) { expEl.style.display = 'block'; }
      var nextBtn = document.getElementById('dsm-next-btn');
      if (nextBtn) { nextBtn.style.display = 'inline-block'; }
    }
  }

  // ── NEXT QUESTION ─────────────────────────────────────────────
  function nextQuestion() {
    currentIdx++;

    if (currentIdx >= pool.length) {
      // Round complete. Two cases:
      //   - Full attempt (odd rounds: 1, 3, 5, ...) — check threshold
      //   - Review of missed (even rounds: 2, 4, 6, ...) — show "now retake" prompt
      var isFullAttempt = (round % 2) === 1;
      if (isFullAttempt) {
        var correct = pool.length - missed.length;
        var pct = Math.round((correct / pool.length) * 100);
        // Track best score across all full attempts.
        if (pct > bestAttemptScore) {
          bestAttemptScore = pct;
          bestAttemptCorrect = correct;
        }
        lastFullAttemptMissed = missed.length;
        var threshold = (typeof solAPI.getMasteryThreshold === 'function')
          ? solAPI.getMasteryThreshold() : 100;
        if (pct >= threshold) {
          complete();
          return;
        }
        // Below threshold — into review mode (Round 2 = missed only).
        if (missed.length === 0) {
          // Edge: somehow 0 missed but still below threshold (only possible
          // if threshold>100, which the schema disallows). Fail-safe: complete.
          complete();
          return;
        }
        showFullAttemptReviewPrompt();
      } else {
        // Even round — review of missed just finished.
        // If they got all missed right, prompt them to retake the full quiz.
        // If still missed some, give them another review pass.
        if (missed.length === 0) {
          showRetakeFullPrompt();
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
    var pct = Math.round((correct / pool.length) * 100);
    var threshold = (typeof solAPI.getMasteryThreshold === 'function')
      ? solAPI.getMasteryThreshold() : 100;

    var html = '<div class="dsm-interstitial">';
    html += '<div class="dsm-inter-icon">📝</div>';
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

  // ── RETAKE-FULL PROMPT (after even round, all review correct) ───
  function showRetakeFullPrompt() {
    var container = document.getElementById(config.containerId);
    var threshold = (typeof solAPI.getMasteryThreshold === 'function')
      ? solAPI.getMasteryThreshold() : 100;

    var html = '<div class="dsm-interstitial">';
    html += '<div class="dsm-inter-icon">💪</div>';
    html += '<div class="dsm-inter-title">Review Complete!</div>';
    html += '<div class="dsm-inter-msg">Nice work on the review. Now try a fresh full attempt to demonstrate mastery.</div>';
    html += '<div class="dsm-inter-sub">All ' + questions.length + ' questions, fresh shuffle. You need ' + threshold + '% to master.</div>';
    html += '<button class="dsm-start-btn" onclick="DSMPlayer.startFreshFullAttempt()">Start Attempt ' + (attemptNumber + 1) + ' &rarr;</button>';
    html += '</div>';

    container.innerHTML = html;

    if (typeof send === 'function') {
      send({ action: 'activity', event: 'dsm_review_complete', lesson: 'Mastery Module',
        metadata: JSON.stringify({ attempt: attemptNumber, round: round }) });
    }
  }

  // ── ROUND INTERSTITIAL (only fires mid-review when still missing some) ─
  function showRoundInterstitial() {
    var container = document.getElementById(config.containerId);
    var missedCount = missed.length;

    var html = '<div class="dsm-interstitial">';
    html += '<div class="dsm-inter-icon">🔁</div>';
    html += '<div class="dsm-inter-title">Keep Reviewing</div>';
    html += '<div class="dsm-inter-stat">' + (pool.length - missedCount) + ' / ' + pool.length + ' correct in this review</div>';
    html += '<div class="dsm-inter-msg">' + missedCount + ' question' + (missedCount !== 1 ? 's' : '') + ' to keep reviewing.</div>';
    html += '<button class="dsm-start-btn" onclick="DSMPlayer.startNextRound()">Continue &rarr;</button>';
    html += '</div>';

    container.innerHTML = html;
  }

  // Cycle missed (review). Round increments to next even number.
  function startNextRound() {
    round++;
    pool = shuffleArray(missed.slice());
    missed = [];
    currentIdx = 0;
    showQuestion();
  }

  // Reshuffle ALL questions for a fresh full attempt. Round increments to
  // next odd number; attemptNumber increments.
  function startFreshFullAttempt() {
    round++;
    attemptNumber++;
    pool = shuffleArray(Array.from({ length: questions.length }, function(_, i) { return i; }));
    missed = [];
    currentIdx = 0;
    showQuestion();
  }

  // ── COMPLETE ──────────────────────────────────────────────────
  function complete() {
    completed = true;
    localStorage.setItem('sol_' + config.unitKey + '_dsm', 'passed');

    // Score for this completion = best full-attempt score so far. The
    // student just hit threshold (or got 100% on a perfect attempt).
    var fullPoolSize = questions.length;
    var correct = bestAttemptCorrect;
    var pct = bestAttemptScore;
    // If complete() is called from a round 1 perfect attempt before
    // bestAttemptScore is updated (race-safety), recompute from current state.
    if (correct === 0 && missed.length < fullPoolSize) {
      correct = fullPoolSize - lastFullAttemptMissed;
      pct = Math.round((correct / fullPoolSize) * 100);
    }
    // Fallback if everything else is 0 (shouldn't happen): treat as 100%.
    if (correct === 0 && missed.length === 0) {
      correct = fullPoolSize;
      pct = 100;
    }

    // Update attempt
    if (attemptId) {
      solAPI.updateDSMAttempt(attemptId, {
        completed: true,
        completed_at: new Date().toISOString(),
        rounds_completed: round,
        questions_missed: allMissed
      });
    }

    // Submit score
    if (typeof send === 'function') {
      send({ action: 'score', lesson: 'Mastery Module', score: correct, total: fullPoolSize, pct: pct });
      send({ action: 'activity', event: 'dsm_complete', lesson: 'Mastery Module',
        metadata: JSON.stringify({ rounds: round, attempts: attemptNumber, score: pct, totalMissed: allMissed.length }) });
    }

    // Show completion screen
    var container = document.getElementById(config.containerId);
    container.innerHTML = dsmCompleteScreenHTML(correct, fullPoolSize, pct);

    // Unlock next panels
    if (config.onComplete) config.onComplete();

    // Save progress
    if (typeof saveProgress === 'function') saveProgress();
  }

  // ── QUIT ──────────────────────────────────────────────────────
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

    // Reset state for retry
    started = false;
    pool = [];
    currentIdx = 0;
    round = 1;
    missed = [];
    allMissed = [];
    attemptId = null;

    var container = document.getElementById(config.containerId);
    container.innerHTML = dsmReadyHTML();
  }

  // ── HTML TEMPLATES ────────────────────────────────────────────
  function dsmReadyHTML() {
    var threshold = (typeof solAPI.getMasteryThreshold === 'function')
      ? solAPI.getMasteryThreshold() : 100;
    return '<div class="dsm-ready">' +
      '<div class="dsm-ready-icon">🧠</div>' +
      '<div class="dsm-ready-title">Mastery Module</div>' +
      '<div class="dsm-ready-sub">' + questions.length + ' questions · ' + config.standard + '</div>' +
      '<div class="dsm-ready-desc">Reach <strong>' + threshold + '%</strong> on a full attempt to achieve mastery. Below the threshold? Review the ones you missed, then try a fresh full attempt.</div>' +
      '<div class="dsm-ready-rules">' +
      '<div class="dsm-rule">✓ Correct answers advance automatically</div>' +
      '<div class="dsm-rule">✗ Wrong answers show the explanation</div>' +
      '<div class="dsm-rule">🏆 ' + threshold + '% on a full attempt = Mastery achieved</div>' +
      '</div>' +
      '<button class="dsm-start-btn" onclick="DSMPlayer.start()">Begin Mastery Module &rarr;</button>' +
      '</div>';
  }

  function dsmNotAvailableHTML() {
    return '<div class="dsm-ready">' +
      '<div class="dsm-ready-icon">📋</div>' +
      '<div class="dsm-ready-title">Mastery Module</div>' +
      '<div class="dsm-ready-sub">Not yet available for this unit</div>' +
      '<div class="dsm-ready-desc">Your teacher hasn\'t set up the Mastery Module for ' + config.standard + ' yet. You can continue to the Study Guide and Practice Test.</div>' +
      '</div>';
  }

  function dsmCompletedHTML() {
    return '<div class="dsm-ready">' +
      '<div class="dsm-ready-icon">🏆</div>' +
      '<div class="dsm-ready-title">Mastery Achieved!</div>' +
      '<div class="dsm-ready-sub">You\'ve mastered ' + config.standard + '</div>' +
      '<div class="dsm-ready-desc">Great work! Continue to the Practice Test to measure your SOL proficiency.</div>' +
      '</div>';
  }

  function dsmCompleteScreenHTML(correct, total, pct) {
    correct = (correct == null) ? questions.length : correct;
    total = (total == null) ? questions.length : total;
    pct = (pct == null) ? 100 : pct;
    var perfect = (pct === 100);
    var subtitle = perfect
      ? (attemptNumber === 1 ? 'Perfect — first try!' : 'Took ' + attemptNumber + ' attempts, but you nailed it.')
      : 'You hit the mastery threshold on attempt ' + attemptNumber + '.';
    return '<div class="dsm-complete-screen">' +
      '<div class="dsm-complete-icon">🎉</div>' +
      '<div class="dsm-complete-title">Mastery Achieved!</div>' +
      '<div class="dsm-complete-stat">' + correct + '/' + total + ' correct (' + pct + '%)</div>' +
      '<div class="dsm-complete-sub">' + subtitle + '</div>' +
      '<div class="dsm-complete-detail">' +
      (allMissed.length > 0 ? '<div style="margin-top:12px;font-size:.85rem;color:#64748b">Total questions reviewed: ' + totalAnswered + ' · Unique misses: ' + allMissed.length + '</div>' : '') +
      '</div>' +
      '<button class="dsm-start-btn" onclick="goTo(' + (config.panelId + 1) + ')">Continue to Study Guide &rarr;</button>' +
      '</div>';
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
  return {
    init: init,
    start: start,
    handleAnswer: handleAnswer,
    nextQuestion: nextQuestion,
    startNextRound: startNextRound,
    startFreshFullAttempt: startFreshFullAttempt,
    quit: quit,
    isCompleted: function() { return completed; }
  };

})();
