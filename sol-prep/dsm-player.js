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
  var round = 1;
  var missed = [];         // indices missed this round
  var allMissed = [];      // { round, questionId, questionText } across all rounds
  var attemptId = null;
  var completed = false;
  var started = false;
  var totalAnswered = 0;

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
    missed = [];
    allMissed = [];
    totalAnswered = 0;

    // Shuffle all questions for round 1
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
      // Round complete
      if (missed.length === 0) {
        // All correct this round — mastery achieved!
        complete();
      } else {
        // Start new round with missed questions
        showRoundInterstitial();
      }
    } else {
      showQuestion();
    }
  }

  // ── ROUND INTERSTITIAL ────────────────────────────────────────
  function showRoundInterstitial() {
    var container = document.getElementById(config.containerId);
    var missedCount = missed.length;

    var html = '<div class="dsm-interstitial">';
    html += '<div class="dsm-inter-icon">' + (round === 1 ? '📝' : '💪') + '</div>';
    html += '<div class="dsm-inter-title">Round ' + round + ' Complete</div>';
    html += '<div class="dsm-inter-stat">' + (pool.length - missedCount) + ' / ' + pool.length + ' correct</div>';
    html += '<div class="dsm-inter-msg">' + missedCount + ' question' + (missedCount !== 1 ? 's' : '') + ' missed — they\'ll come back in Round ' + (round + 1) + '.</div>';
    html += '<div class="dsm-inter-sub">Keep going! You need to get every question right in a single round to achieve mastery.</div>';
    html += '<button class="dsm-start-btn" onclick="DSMPlayer.startNextRound()">Start Round ' + (round + 1) + ' &rarr;</button>';
    html += '</div>';

    container.innerHTML = html;

    // Log round
    if (typeof send === 'function') {
      send({ action: 'activity', event: 'dsm_round_complete', lesson: 'Mastery Module',
        metadata: JSON.stringify({ round: round, missed: missedCount, total: pool.length }) });
    }
  }

  function startNextRound() {
    round++;
    pool = shuffleArray(missed.slice());
    missed = [];
    currentIdx = 0;
    showQuestion();
  }

  // ── COMPLETE ──────────────────────────────────────────────────
  function complete() {
    completed = true;
    localStorage.setItem('sol_' + config.unitKey + '_dsm', 'passed');

    // Update attempt
    if (attemptId) {
      solAPI.updateDSMAttempt(attemptId, {
        completed: true,
        completed_at: new Date().toISOString(),
        rounds_completed: round,
        questions_missed: allMissed
      });
    }

    // Submit score (100%)
    if (typeof send === 'function') {
      send({ action: 'score', lesson: 'Mastery Module', score: questions.length, total: questions.length, pct: 100 });
      send({ action: 'activity', event: 'dsm_complete', lesson: 'Mastery Module',
        metadata: JSON.stringify({ rounds: round, totalMissed: allMissed.length }) });
    }

    // Show completion screen
    var container = document.getElementById(config.containerId);
    container.innerHTML = dsmCompleteScreenHTML();

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
    return '<div class="dsm-ready">' +
      '<div class="dsm-ready-icon">🧠</div>' +
      '<div class="dsm-ready-title">Mastery Module</div>' +
      '<div class="dsm-ready-sub">' + questions.length + ' questions · ' + config.standard + '</div>' +
      '<div class="dsm-ready-desc">Answer every question correctly to achieve mastery. Missed questions will cycle back until you get them all right in a single round.</div>' +
      '<div class="dsm-ready-rules">' +
      '<div class="dsm-rule">✓ Correct answers advance automatically</div>' +
      '<div class="dsm-rule">✗ Wrong answers show the explanation and cycle back</div>' +
      '<div class="dsm-rule">🏆 100% in a round = Mastery achieved</div>' +
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

  function dsmCompleteScreenHTML() {
    return '<div class="dsm-complete-screen">' +
      '<div class="dsm-complete-icon">🎉</div>' +
      '<div class="dsm-complete-title">Mastery Achieved!</div>' +
      '<div class="dsm-complete-stat">' + questions.length + '/' + questions.length + ' correct in Round ' + round + '</div>' +
      '<div class="dsm-complete-sub">' + (round === 1 ? 'Perfect — first try!' : 'It took ' + round + ' rounds, but you got there!') + '</div>' +
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
    quit: quit,
    isCompleted: function() { return completed; }
  };

})();
