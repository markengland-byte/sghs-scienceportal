/* ================================================================
   SGHS SOL Prep — Unit Engine (Phase D)

   Replaces ~2500 LOC of duplicated inline JS in each unit-N.html
   with a single boot call: `UnitEngine.boot(window.UNIT_CONFIG)`.

   Architecture:
   - State lives in a single private object, accessed via UnitEngine.state
   - All writes go through state.set() which triggers debounced autosave
   - DOM event handlers are exposed on UnitEngine — the inline lesson
     HTML calls UnitEngine.onGateAnswer(this) etc. instead of per-unit
     functions
   - solAPI is the only network surface (REST + auth + buffer)
   - dsm-player.js is initialized once with studentName + callbacks

   This file is intentionally one piece — easier to read top-to-bottom
   than a folder of micro-modules. Sections are clearly delimited.

   Design doc: /PHASE-D-DESIGN-DOC.md
   ================================================================ */

window.UnitEngine = (function() {
  'use strict';

  // ── PRIVATE STATE ─────────────────────────────────────────
  var _config = null;
  var _state = _createInitialState();
  var _booted = false;
  var _saveTimer = null;
  var _hbInterval = null;
  var _hbLastActive = Date.now();
  var _lastScorePromise = null;

  var SAVE_DEBOUNCE_MS = 1500;
  var HEARTBEAT_MS = 60000;
  var HEARTBEAT_PRESENCE_WINDOW_MS = 90000;

  function _createInitialState() {
    return {
      // identity
      studentName:   '',
      classCode:     '',

      // panel progression
      currentPanel:  0,
      unlockedPanels: new Set([0]),
      panelStartTime: Date.now(),
      sessionStart:  Date.now(),

      // gate progress
      gateAnswered:  {},               // { panelId: Set<idx> }
      graphAnswered: {},               // generic key/value, populated by markAnswered()

      // pretest
      pretestAnswers:        [],
      pretestSent:           false,
      pretestAlreadySubmitted: false,
      priorPretestScore:     null,

      // vocab
      flippedCards:  new Set(),
      vqAnswers:     {},
      vqScore:       0,
      vocabPassed:   false,
      vocabSubmitted: false,

      // practice test
      pracAnswered:  0,
      pracCorrect:   0,
      practiceAlreadySubmitted: false,
      priorPracticeScore: null,

      // per-quiz start timestamps (for time_on_quiz metric — set on first interaction)
      pretestStart:  null,
      vocabStart:    null,
      practiceStart: null,

      // misc
      missedStds:    {},
      questionDetail: [],
      activityLog:   [],

      // SSO
      ssoActive:     false
    };
  }

  // ── STATE ACCESS ──────────────────────────────────────────
  // Simple dot-path accessor; not recursive subscribers — debounced
  // save runs after every set so callers don't need to opt in.
  function _stateGet(path) {
    var parts = path.split('.');
    var cur = _state;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function _stateSet(path, value, opts) {
    var parts = path.split('.');
    var cur = _state;
    for (var i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    if (!(opts && opts.silent)) _scheduleSave();
  }

  // ── SERIALIZATION (Set <-> Array, send + restore) ─────────
  function _serializeState() {
    var gateObj = {};
    for (var key in _state.gateAnswered) {
      gateObj[key] = Array.from(_state.gateAnswered[key]);
    }
    return {
      studentName:    _state.studentName,
      classCode:      _state.classCode,
      currentPanel:   _state.currentPanel,
      gateAnswered:   gateObj,
      graphAnswered:  _state.graphAnswered,
      pretestAnswers: _state.pretestAnswers,
      pretestSent:    _state.pretestSent,
      vqAnswers:      _state.vqAnswers,
      vqScore:        _state.vqScore,
      vocabPassed:    _state.vocabPassed,
      pracAnswered:   _state.pracAnswered,
      pracCorrect:    _state.pracCorrect,
      missedStds:     _state.missedStds,
      questionDetail: _state.questionDetail,
      activityLog:    _state.activityLog,
      sessionStart:   _state.sessionStart,
      unlockedPanels: Array.from(_state.unlockedPanels),
      flippedCards:   Array.from(_state.flippedCards),
      vocabSubmitted: _state.vocabSubmitted,
      pretestStart:   _state.pretestStart,
      vocabStart:     _state.vocabStart,
      practiceStart:  _state.practiceStart,
      savedAt:        Date.now()
    };
  }

  // Hydrate _state from a serialized blob (localStorage or quiz_progress).
  // Does NOT replay DOM — that's _replayDom() which fires after.
  function _hydrateState(data) {
    _state.studentName    = data.studentName || '';
    _state.classCode      = data.classCode || _state.classCode;
    _state.pretestAnswers = data.pretestAnswers || [];
    _state.pretestSent    = data.pretestSent || false;
    _state.vqAnswers      = data.vqAnswers || {};
    _state.vqScore        = data.vqScore || 0;
    _state.vocabPassed    = data.vocabPassed || false;
    _state.pracAnswered   = data.pracAnswered || 0;
    _state.pracCorrect    = data.pracCorrect || 0;
    _state.missedStds     = data.missedStds || {};
    _state.questionDetail = data.questionDetail || [];
    _state.activityLog    = data.activityLog || [];
    _state.sessionStart   = data.sessionStart || Date.now();
    _state.graphAnswered  = data.graphAnswered || {};
    _state.vocabSubmitted = data.vocabSubmitted || false;
    _state.pretestStart   = data.pretestStart  || null;
    _state.vocabStart     = data.vocabStart    || null;
    _state.practiceStart  = data.practiceStart || null;

    // Sets
    if (data.unlockedPanels) {
      _state.unlockedPanels = new Set(data.unlockedPanels);
    } else {
      // Backward-compat: unlock everything up to currentPanel.
      _state.unlockedPanels = new Set([0]);
      for (var i = 0; i <= (data.currentPanel || 0); i++) _state.unlockedPanels.add(i);
    }

    _state.gateAnswered = {};
    if (data.gateAnswered) {
      for (var pid in data.gateAnswered) {
        _state.gateAnswered[pid] = new Set(data.gateAnswered[pid]);
      }
    }

    _state.flippedCards = data.flippedCards ? new Set(data.flippedCards) : new Set();

    // Currently does NOT restore currentPanel — caller (boot or
    // restore) decides where to navigate. We go there explicitly.
  }

  // ── SAVE / RESTORE ────────────────────────────────────────
  function _scheduleSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_saveNow, SAVE_DEBOUNCE_MS);
  }

  function _saveNow() {
    var blob = _serializeState();
    try {
      localStorage.setItem('sol_' + _config.unitKey + '_progress', JSON.stringify(blob));
    } catch (e) { /* localStorage full — fall through */ }
    if (_state.studentName && solAPI.saveProgress) {
      solAPI.saveProgress(_config.unitKey.replace(/^unit/, 'unit-'), _state.studentName, blob);
    }
  }

  // Public: blocking flush for page-unload paths.
  function _flushSave() {
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    _saveNow();
  }

  // Restore from local OR remote, whichever is more recent (1s tolerance).
  function _tryRestore() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('sol_' + _config.unitKey + '_progress') || 'null'); } catch (e) {}
    if (!saved && !solAPI.getProgress) return Promise.resolve(null);
    if (!_state.studentName) return Promise.resolve(saved);

    return solAPI.getProgress(_config.unitKey.replace(/^unit/, 'unit-'), _state.studentName)
      .then(function(remote) {
        if (!remote || !remote.progress_data) return saved;
        var remoteData = remote.progress_data;
        if (!saved) return remoteData;
        var localAt = saved.savedAt || 0;
        var remoteAt = new Date(remote.updated_at).getTime();
        // 1s tolerance — if effectively a tie, prefer local (no network round-trip).
        return (remoteAt > localAt + 1000) ? remoteData : saved;
      })
      .catch(function() { return saved; });
  }

  // ── DOM REPLAY (called after _hydrateState during restore) ─
  // Walks every gate-q, vocab card, vocab quiz, and practice question
  // and re-applies the visual revealed/correct/incorrect classes
  // matching _state. This is the ugliest function in the engine and
  // matches the original restoreProgress DOM walk exactly.
  function _replayDom() {
    var c = _config;

    // Gate questions per panel
    for (var panelId in _state.gateAnswered) {
      var indices = _state.gateAnswered[panelId];
      var gateQs = document.querySelectorAll('#p' + panelId + ' .gate-q');
      indices.forEach(function(idx) {
        var qq = gateQs[idx];
        if (!qq) return;
        var ans = qq.dataset.ans;
        qq.querySelectorAll('.qo').forEach(function(o) {
          o.classList.add('revealed');
          if (o.dataset.v === ans) o.classList.add('correct');
        });
        var exp = qq.querySelector('.qexp');
        if (exp) { exp.classList.add('show'); exp.style.display = 'block'; }
      });
      _checkGate(parseInt(panelId));
    }

    // Graph questions (unit-1 panel 3 only). Replays the visual styling
    // so the chart-option highlights persist across reloads.
    ['graph1', 'graph2'].forEach(function(key, i) {
      if (!_state.graphAnswered[key]) return;
      var qId = i === 0 ? 'graph-q1' : 'graph-q2';
      var fbId = i === 0 ? 'graph-feedback' : 'graph2-feedback';
      document.querySelectorAll('#' + qId + ' .graph-q-opt').forEach(function(o) {
        var oc = o.getAttribute('onclick') || '';
        o.classList.add(oc.indexOf('true') !== -1 ? 'correct-ans' : 'neutral');
      });
      var fb = document.getElementById(fbId);
      if (fb) fb.style.display = 'block';
    });

    // Vocab cards
    var cards = document.querySelectorAll('.vcard');
    var vocabNeedsReset = (!_state.vocabPassed && Object.keys(_state.vqAnswers).length === 0);
    if (!vocabNeedsReset && _state.flippedCards.size > 0) {
      _state.flippedCards.forEach(function(idx) {
        if (cards[idx]) cards[idx].classList.add('flipped');
      });
      var countEl = document.getElementById('vocab-flip-count');
      if (countEl) countEl.textContent = _state.flippedCards.size + ' of ' + c.totalCards + ' cards studied';
      if (_state.flippedCards.size >= c.totalCards) {
        var gate = document.getElementById('vocab-flip-gate');
        if (gate) {
          gate.classList.add('unlocked');
          var msg = gate.querySelector('.gate-msg');
          if (msg) msg.textContent = 'All cards studied — Vocab Quiz unlocked!';
        }
        var quiz = document.getElementById('vquiz');
        if (quiz) quiz.style.display = 'block';
      }
    } else {
      _state.flippedCards = new Set();
      cards.forEach(function(card) { card.className = 'vcard'; });
      var quiz2 = document.getElementById('vquiz');
      if (quiz2) quiz2.style.display = 'none';
      var flipGate = document.getElementById('vocab-flip-gate');
      if (flipGate) {
        flipGate.classList.remove('unlocked');
        var fmsg = flipGate.querySelector('.gate-msg');
        if (fmsg) fmsg.textContent = 'Flip all ' + c.totalCards + ' flashcards to unlock the Vocab Quiz';
      }
      var flipCount = document.getElementById('vocab-flip-count');
      if (flipCount) flipCount.textContent = '0 of ' + c.totalCards + ' cards studied';
    }

    // Vocab quiz answers
    if (!vocabNeedsReset && Object.keys(_state.vqAnswers).length > 0) {
      for (var qNum in _state.vqAnswers) {
        var qq = document.getElementById('vq' + qNum);
        if (!qq) continue;
        var correct = c.vocab.correct[qNum];
        qq.querySelectorAll('.vq-opt').forEach(function(o) {
          o.classList.add('revealed');
          if (o.dataset.v === correct) o.classList.add('correct');
        });
        var res = document.getElementById('vqr' + qNum);
        if (res) {
          if (_state.vqAnswers[qNum]) {
            res.textContent = '✅ ' + (c.vocab.explain[qNum] || '');
            res.className = 'vq-result show';
          } else {
            res.textContent = '❌ ' + (c.vocab.explain[qNum] || '');
            res.className = 'vq-result show wrong';
          }
        }
      }
      // Show score box if graded.
      if (_state.vqScore > 0 || Object.keys(_state.vqAnswers).length >= c.vocab.total) {
        var box = document.getElementById('vquiz-score');
        // unit-1 markup uses #vq-score-n; units 2-8 use #vq-score-num.
        var nEl = document.getElementById('vq-score-n') || document.getElementById('vq-score-num');
        var msgEl = document.getElementById('vq-pass-msg');
        if (box && nEl && msgEl) {
          nEl.textContent = _state.vqScore + '/' + c.vocab.total;
          box.style.display = 'block';
          msgEl.textContent = _state.vocabPassed
            ? '✅ Passed! Mastery Module unlocked.'
            : '❌ Score ' + _state.vqScore + '/' + c.vocab.total + '. Need ' + c.vocab.pass + '/' + c.vocab.total + '. Review missed terms and retry.';
        }
      }
      if (_state.vocabPassed) {
        _state.unlockedPanels.add(c.dsmPanelId);
        _initDSMPlayer();
      }
    }

    // Practice test answers
    if (_state.questionDetail.length > 0) {
      var practicePanel = c.dsmPanelId + 2;  // typical layout: vocab=N, mastery=N+1, study=N+2, practice=N+3
      // Actually, practice is conventionally panel TOTAL_PANELS-2 (results=last, practice=second-to-last)
      practicePanel = c.totalPanels - 2;
      var solQs = document.querySelectorAll('#p' + practicePanel + ' .qq');
      _state.questionDetail.forEach(function(detail, i) {
        var qq = solQs[i];
        if (!qq) return;
        qq.querySelectorAll('.qo').forEach(function(o) {
          o.classList.add('revealed');
          if (o.dataset.v === detail.correct) o.classList.add('correct');
          else if (o.dataset.v === detail.chosen && !detail.isCorrect) o.classList.add('incorrect');
        });
        var exp = qq.querySelector('.qexp');
        if (exp) {
          exp.classList.add('show');
          if (!detail.isCorrect) exp.classList.add('qexp-wrong');
        }
      });
      var progMsg = document.getElementById('sol-progress-msg');
      if (progMsg) progMsg.textContent = _state.pracAnswered + ' of ' + c.totalSolQ + ' answered';
      if (_state.pracAnswered === c.totalSolQ) {
        var trBtn = document.getElementById('to-results-btn');
        if (trBtn) trBtn.disabled = false;
      }
    }
    if (_state.pracAnswered >= c.totalSolQ) _showDangerZone();
  }

  // ── BOOT ──────────────────────────────────────────────────
  function boot(config) {
    if (_booted) {
      console.warn('[UnitEngine] boot() called twice; ignoring');
      return Promise.resolve();
    }
    _booted = true;
    _config = config;
    _validateConfig();

    // Set page-title fragment if present
    if (_config.unitTitle) {
      document.title = 'SOL Prep — Unit ' + _config.unitNumber + ': ' + _config.unitTitle;
    }

    _wireGlobalListeners();
    _wireSSOAndStart();
    return Promise.resolve();
  }

  function _validateConfig() {
    var required = ['unitNumber','unitKey','standard','moduleName','totalPanels','dsmPanelId','stepNames','unlockOnMastery','gateRequired','vocab','totalCards','totalSolQ'];
    var missing = required.filter(function(k) { return _config[k] === undefined; });
    if (missing.length > 0) {
      console.error('[UnitEngine] config missing required fields:', missing);
      throw new Error('UnitEngine config invalid: missing ' + missing.join(', '));
    }
    if (!_config.dsm) _config.dsm = { containerId: 'dsm-container' };
  }

  function _wireGlobalListeners() {
    // Heartbeat presence detection — track last activity
    document.addEventListener('mousemove', function() { _hbLastActive = Date.now(); });
    document.addEventListener('keydown',  function() { _hbLastActive = Date.now(); });
    document.addEventListener('scroll',   function() { _hbLastActive = Date.now(); });

    // Beacon on session-end
    window.addEventListener('beforeunload', function() {
      if (!_state.studentName) return;
      var duration = Math.round((Date.now() - _state.sessionStart) / 1000);
      _flushSave();
      // Push the latest progress snapshot via keepalive so the request
      // survives page-unload (regular fetch gets cancelled).
      if (solAPI.flushProgress) {
        try {
          var snap = localStorage.getItem('sol_' + _config.unitKey + '_progress');
          if (snap) solAPI.flushProgress(_config.unitKey.replace(/^unit/, 'unit-'), _state.studentName, JSON.parse(snap));
        } catch (e) {}
      }
      if (solAPI.beacon) {
        solAPI.beacon({
          action: 'activity',
          student: _state.studentName,
          module: _config.moduleName,
          event: 'session_end',
          duration: duration,
          panelLog: JSON.stringify(_state.activityLog),
          totalSessionSeconds: duration
        });
      }
    });

    // Sign-out delegation
    document.addEventListener('click', function(e) {
      if (e.target && e.target.id === 'sso-signout') {
        e.preventDefault();
        if (solAPI.signOut) {
          solAPI.signOut().then(function() {
            _clearSSOSession();
            var f = document.getElementById('student-first-name');
            var l = document.getElementById('student-last-name');
            if (f) f.value = '';
            if (l) l.value = '';
          });
        }
      }
    });
  }

  function _wireSSOAndStart() {
    // Class-code-stored fast path: if a class was already validated, skip the modal.
    var stored = solAPI.getStored();

    // Welcome-back prefill (legacy SSO modal still has the name modal shell;
    // we don't render the names but the modal's class-code restoration matters).
    var pendingCode = sessionStorage.getItem('_sso_pending_code');
    if (pendingCode) {
      var codeEl = document.getElementById('class-code');
      if (codeEl) codeEl.value = pendingCode;
      sessionStorage.removeItem('_sso_pending_code');
    }

    _initMeta();

    if (solAPI.initAuth) {
      solAPI.initAuth().then(function(studentRow) {
        if (studentRow) _applySSOSession();
        if (solAPI.runModuleReleaseGate) solAPI.runModuleReleaseGate(_config.unitKey.replace(/^unit/, 'unit-'));
      }).catch(function(err) {
        console.warn('[UnitEngine] initAuth failed:', err);
      });
    }

    // Page-load module-release gate (uses GLOBAL state since student id not yet known).
    if (solAPI.runModuleReleaseGate) {
      solAPI.runModuleReleaseGate(_config.unitKey.replace(/^unit/, 'unit-'));
    }
  }

  // ── META (streak + countdown) ─────────────────────────────
  function _initMeta() {
    var today = new Date().toDateString();
    var yesterday = new Date(Date.now() - 86400000).toDateString();
    var streak = parseInt(localStorage.getItem('sol_streak') || '0');
    var last = localStorage.getItem('sol_streak_last');
    if (last === today) { /* same day */ }
    else if (last === yesterday) { streak++; localStorage.setItem('sol_streak', streak); localStorage.setItem('sol_streak_last', today); }
    else { streak = 1; localStorage.setItem('sol_streak', 1); localStorage.setItem('sol_streak_last', today); }
    var sv = document.getElementById('streak-val');
    if (sv) sv.textContent = streak;
    if (streak >= 3) {
      var f = document.getElementById('streak-fire');
      if (f) {
        f.style.animation = 'none';
        setTimeout(function() { f.style.animation = 'flamePop 0.5s ease'; }, 10);
      }
    }
    var cd = document.getElementById('sol-countdown');
    if (!cd) return;
    var examDate = solAPI.getExamDate && solAPI.getExamDate();
    if (examDate) {
      var days = Math.max(0, Math.ceil((examDate - new Date()) / (1000 * 60 * 60 * 24)));
      cd.textContent = days;
      cd.style.color = days <= 14 ? '#fca5a5' : days <= 21 ? '#fcd34d' : '#fff';
    } else {
      cd.textContent = '--';
    }
  }

  // ── SSO ──────────────────────────────────────────────────
  function _applySSOSession() {
    if (!solAPI.isAuthenticated || !solAPI.isAuthenticated()) return false;
    var fullName = (solAPI.getStudentDisplayName && solAPI.getStudentDisplayName()) || '';
    var email = (solAPI.getStudentEmail && solAPI.getStudentEmail()) || '';
    if (!fullName && !email) return false;
    if (!fullName) fullName = email.split('@')[0];
    var banner = document.getElementById('sso-signed-in');
    var nameDisp = document.getElementById('sso-name-display');
    var btn = document.getElementById('sso-signin-btn');
    if (banner) banner.style.display = 'block';
    if (nameDisp) nameDisp.textContent = fullName + (email ? ' (' + email + ')' : '');
    if (btn) btn.style.display = 'none';
    _state.ssoActive = true;
    _state.studentName = fullName;
    return true;
  }

  function _clearSSOSession() {
    var banner = document.getElementById('sso-signed-in');
    var btn = document.getElementById('sso-signin-btn');
    if (banner) banner.style.display = 'none';
    if (btn) btn.style.display = 'flex';
    _state.ssoActive = false;
  }

  function signInWithGoogle() {
    if (!solAPI.signInWithGoogle) {
      showToast('Sign-in not available on this browser');
      return;
    }
    var codeEl = document.getElementById('class-code');
    if (codeEl && codeEl.value.trim()) {
      sessionStorage.setItem('_sso_pending_code', codeEl.value.trim());
    }
    var btn = document.getElementById('sso-signin-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Redirecting...'; }
    solAPI.signInWithGoogle(window.location.href).catch(function(err) {
      console.error('[UnitEngine] sign-in failed:', err);
      if (btn) { btn.disabled = false; btn.textContent = 'Sign in with Google'; }
      var ce = document.getElementById('code-err');
      if (ce) { ce.textContent = 'Sign-in failed: ' + (err.message || 'unknown error'); ce.style.display = 'block'; }
    });
  }

  // ── START FLOW (validate class, restore or start fresh) ───
  function startUnit() {
    if (!_state.ssoActive) {
      showToast('Please sign in with Google before starting.');
      return;
    }
    var codeEl = document.getElementById('class-code');
    var code = codeEl ? codeEl.value.trim().toUpperCase() : '';
    if (!code) {
      var ce = document.getElementById('code-err');
      if (ce) { ce.textContent = 'Class code is required.'; ce.style.display = 'block'; }
      return;
    }
    solAPI.validateCode(code).then(function(res) {
      if (!res.valid) {
        var ce = document.getElementById('code-err');
        if (ce) { ce.textContent = 'Invalid or inactive class code.'; ce.style.display = 'block'; }
        return;
      }
      solAPI.storeClass();
      _state.classCode = code;
      _proceedStart(_state.studentName);
    });
  }

  function _proceedStart(name) {
    _state.studentName = name;
    var nameModal = document.getElementById('name-modal');
    if (nameModal) nameModal.style.display = 'none';

    _send({ action: 'activity', module: _config.moduleName, event: 'module_start', timestamp: new Date().toISOString() });
    _checkPretestLock();
    _checkPracticeLock();
    _startHeartbeat();

    // Try to restore prior state (local + remote)
    _tryRestore().then(function(saved) {
      if (saved && saved.currentPanel != null) {
        _hydrateState(saved);
        _replayDom();
        goTo(saved.currentPanel || 0);
      } else {
        goTo(0);
      }
      // Third DSM-init path (matches original code): if the user
      // previously passed vocab, ensure the player is initialized
      // even when saved state lacked vqAnswers. Without this, a
      // student returning to the Mastery panel after a vocab pass
      // sees a blank panel because _initDSMPlayer() inside
      // _replayDom only fires when vqAnswers has entries.
      var vocabFlag = localStorage.getItem('sol_' + _config.unitKey + '_vocab') === 'passed';
      if ((vocabFlag || _state.vocabPassed) && window.DSMPlayer) {
        _state.vocabPassed = true;
        _state.unlockedPanels.add(_config.dsmPanelId);
        _initDSMPlayer();
      }
    }).catch(function(err) {
      console.warn('[UnitEngine] restore failed:', err);
      goTo(0);
    });
  }

  // ── send (proxy to solAPI.submit with module + student injected) ──
  function _send(payload) {
    payload.student = _state.studentName;
    payload.module  = payload.module || _config.moduleName;
    var p = solAPI.submit ? (solAPI.submit(payload) || Promise.resolve()) : Promise.resolve();
    if (payload.action === 'score') _lastScorePromise = p;
    return p;
  }

  // ── PANEL NAVIGATION ─────────────────────────────────────
  function goTo(n) {
    if (n === (_config.totalPanels - 2) && _state.practiceAlreadySubmitted) _applyPracticeLockUI();
    if (n === 0 && _state.pretestAlreadySubmitted) _applyPretestLockUI();
    if (n > _state.currentPanel && !_state.unlockedPanels.has(n)) {
      showToast('Complete the questions on this page first!');
      return;
    }
    var duration = Math.round((Date.now() - _state.panelStartTime) / 1000);
    if (duration > 2) {
      _state.activityLog.push({ panel: _state.currentPanel, seconds: duration, timestamp: new Date().toISOString() });
      _send({ action: 'activity', lesson: _config.stepNames[_state.currentPanel] || 'Step ' + _state.currentPanel, event: 'page_view', duration: duration });
    }
    _state.panelStartTime = Date.now();

    document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
    var target = document.getElementById('p' + n);
    if (target) target.classList.add('active');
    document.querySelectorAll('.step-btn').forEach(function(b) { b.classList.remove('active'); });
    var sb = document.getElementById('sb' + n);
    if (sb) sb.classList.add('active');
    for (var i = 0; i < n; i++) {
      var prev = document.getElementById('sb' + i);
      if (prev) prev.classList.add('done');
    }
    _state.currentPanel = n;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    var pct = Math.round((n / (_config.totalPanels - 1)) * 100);
    var prog = document.getElementById('steps-prog');
    if (prog) prog.style.width = pct + '%';

    // Auto-unlock next panel for ungated panels (e.g. Study Guide).
    // Clamp at totalPanels-1 so we don't add a phantom panel beyond Results.
    if (!(n in _config.gateRequired) && n !== _config.dsmPanelId && (n + 1) <= (_config.totalPanels - 1)) {
      _state.unlockedPanels.add(n + 1);
    }
    localStorage.setItem('sol_' + _config.unitKey + '_panel', n);
    _scheduleSave();
  }

  // ── GATE QUESTIONS ───────────────────────────────────────
  function onGateAnswer(el) {
    var qq = el.closest('.qq');
    if (!qq || qq.querySelector('.qo.revealed')) return;
    var ans = qq.dataset.ans;
    var chosen = el.dataset.v;
    var panelId = parseInt(qq.dataset.panel || _state.currentPanel);

    // Stamp the pretest start time on first answered question.
    if (panelId === 0 && _state.pretestStart == null) _state.pretestStart = Date.now();

    qq.querySelectorAll('.qo').forEach(function(o) {
      o.classList.add('revealed');
      if (o.dataset.v === ans) o.classList.add('correct');
    });
    if (chosen !== ans) el.classList.add('incorrect');

    var exp = qq.querySelector('.qexp');
    if (exp) { exp.classList.add('show'); exp.style.display = 'block'; }

    if (!_state.gateAnswered[panelId]) _state.gateAnswered[panelId] = new Set();
    var qqs = document.querySelectorAll('#p' + panelId + ' .gate-q');
    var idx = Array.from(qqs).indexOf(qq);
    _state.gateAnswered[panelId].add(idx);

    // Pretest answers (panel 0) — capture detail for quizDetail later.
    if (panelId === 0) {
      var qNum = idx + 1;
      var stemEl = qq.querySelector('.q-stem');
      var stem = stemEl ? stemEl.textContent.trim() : '';
      var correctText = '';
      var chosenText = '';
      qq.querySelectorAll('.qo').forEach(function(o) {
        var label = (o.querySelector('.ol') ? o.querySelector('.ol').textContent + ' ' : '');
        var fullText = (o.textContent.replace(label, '').trim());
        if (o.dataset.v === ans) correctText = fullText;
        if (o.dataset.v === chosen) chosenText = fullText;
      });
      _state.pretestAnswers.push({
        qNum: qNum,
        questionText: stem,
        studentAnswer: chosenText,
        correctAnswer: correctText,
        isCorrect: chosen === ans
      });
    }

    _checkGate(panelId);
    _scheduleSave();
  }

  function _checkGate(panelId) {
    var required = _config.gateRequired[panelId];
    if (required == null) return;
    var answered = _state.gateAnswered[panelId] ? _state.gateAnswered[panelId].size : 0;

    // Special case for unit-1 panel 3: the "answered" count is a
    // combined pool of gate-questions + graph clicks. Original
    // behavior: 4 of any combination unlocks (matches the 4 .gate-q
    // questions + 2 graph clicks total of 6 possible engagement
    // points). Match the original'"'"'s permissive logic.
    var isUnit1Panel3 = (panelId === 3 && _config.unitNumber === 1);
    var graphPoints = isUnit1Panel3
      ? (_state.graphAnswered.graph1 ? 1 : 0) + (_state.graphAnswered.graph2 ? 1 : 0)
      : 0;
    var displayedAnswered = answered + graphPoints;

    // Live-update the visible "X of N answered" counter under each
    // panel. Use the count of actual rendered .gate-q elements (the
    // visible total) as the denominator, NOT the gateRequired minimum
    // — required is "min to unlock", not the visible question count.
    var countEl = document.getElementById('gate-count-' + panelId);
    if (countEl) {
      var visibleTotal;
      if (isUnit1Panel3) {
        // For unit-1 panel 3, denominator is the gate-required (4) so
        // the counter doesn'"'"'t exceed it (caps at "4 of 4 answered").
        visibleTotal = required;
        displayedAnswered = Math.min(displayedAnswered, required);
      } else {
        visibleTotal = document.querySelectorAll('#p' + panelId + ' .gate-q').length || required;
      }
      countEl.textContent = displayedAnswered + ' of ' + visibleTotal + ' answered';
    }

    // Combined-pool gate check for unit-1 panel 3; standard check elsewhere.
    if (isUnit1Panel3) {
      if ((answered + graphPoints) < required) return;
    } else {
      if (answered < required) return;
    }

    // Panel 0 → submit pretest score once
    if (panelId === 0 && !_state.pretestSent && _state.pretestAnswers.length === required) {
      var correct = _state.pretestAnswers.filter(function(a) { return a.isCorrect; }).length;
      var pretestSeconds = _state.pretestStart
        ? Math.round((Date.now() - _state.pretestStart) / 1000)
        : null;
      _send({
        action: 'score', module: _config.moduleName, lesson: 'Pretest',
        score: correct, total: _state.pretestAnswers.length,
        pct: Math.round((correct / _state.pretestAnswers.length) * 100),
        timeOnQuiz: pretestSeconds
      });
      _send({
        action: 'quizDetail', module: _config.moduleName, lesson: 'Pretest',
        questions: _state.pretestAnswers.map(function(a) {
          return { qNum: a.qNum, questionText: a.questionText, studentAnswer: a.studentAnswer, correctAnswer: a.correctAnswer, isCorrect: a.isCorrect };
        })
      });
      _state.pretestSent = true;
    }

    _state.unlockedPanels.add(panelId + 1);

    // Update the gate-status box: switch from locked-grey to unlocked-green
    // and replace the "Answer all questions..." text with the success message.
    var statusEl = document.getElementById('gate-status-' + panelId);
    if (statusEl) {
      statusEl.classList.add('unlocked');
      var msg = statusEl.querySelector('.gate-msg');
      if (msg) msg.textContent = 'All questions answered — next step unlocked!';
    }
    // Mark THIS panel's step button as done now that the gate cleared.
    var doneSb = document.getElementById('sb' + panelId);
    if (doneSb) doneSb.classList.add('done');

    // Inline lesson HTML uses <button class="nbtn next" id="next-N">.
    var nextBtn = document.getElementById('next-' + panelId)
      || document.querySelector('#p' + panelId + ' .nbtn.next');
    if (nextBtn) {
      nextBtn.disabled = false;
      // Strip the leading lock-emoji prefix once unlocked. Match both the
      // literal emoji and its surrogate-pair escape.
      nextBtn.innerHTML = nextBtn.innerHTML.replace(/^[\uD83D]?\uDD12\s*|^🔒\s*/, '');
    }
  }

  // Generic "panel-3 chart marker" for unit-1 (graph-1 / graph-2 in BIO.1c).
  // The lesson HTML calls this from its own click handlers.
  function markAnswered(key, value) {
    _state.graphAnswered[key] = !!value;
    _checkGate(_state.currentPanel);
    _scheduleSave();
  }

  // ── VOCAB ────────────────────────────────────────────────
  function onFlipCard(el) {
    el.classList.toggle('flipped');
    var allCards = document.querySelectorAll('.vcard');
    var idx = Array.from(allCards).indexOf(el);
    if (idx === -1) return;
    if (el.classList.contains('flipped')) _state.flippedCards.add(idx);

    var countEl = document.getElementById('vocab-flip-count');
    if (countEl) countEl.textContent = _state.flippedCards.size + ' of ' + _config.totalCards + ' cards studied';
    if (_state.flippedCards.size >= _config.totalCards) {
      var gate = document.getElementById('vocab-flip-gate');
      if (gate) {
        gate.classList.add('unlocked');
        var msg = gate.querySelector('.gate-msg');
        if (msg) msg.textContent = 'All cards studied — Vocab Quiz unlocked!';
      }
      var quiz = document.getElementById('vquiz');
      if (quiz) quiz.style.display = 'block';
    }
    _scheduleSave();
  }

  function onVqPick(el) {
    var vq = el.closest('.vq');
    if (!vq || vq.querySelector('.vq-opt.revealed')) return;
    var qNum = vq.dataset.qnum || vq.id.replace('vq', '');
    var chosen = el.dataset.v;
    var correct = _config.vocab.correct[qNum];
    var isCorrect = (chosen === correct);

    // Stamp the vocab start time on first answered question.
    if (_state.vocabStart == null) _state.vocabStart = Date.now();

    vq.querySelectorAll('.vq-opt').forEach(function(o) {
      o.classList.add('revealed');
      if (o.dataset.v === correct) o.classList.add('correct');
    });
    if (!isCorrect) el.classList.add('incorrect');

    var res = document.getElementById('vqr' + qNum);
    if (res) {
      var explainText = _config.vocab.explain[qNum] || '';
      res.textContent = (isCorrect ? '✅ ' : '❌ ') + explainText;
      res.className = isCorrect ? 'vq-result show' : 'vq-result show wrong';
    }

    _state.vqAnswers[qNum] = isCorrect;
    if (Object.keys(_state.vqAnswers).length === _config.vocab.total) _gradeVocab();
    _scheduleSave();
  }

  function _gradeVocab() {
    var c = _config;
    // Manual-trigger guard: if the student clicks the "Grade My Vocab Quiz"
    // button before answering all of them, refuse with a toast instead of
    // grading a partial set.
    if (Object.keys(_state.vqAnswers).length < c.vocab.total) {
      showToast('Answer all ' + c.vocab.total + ' vocab questions first!');
      return;
    }
    // Auto-grade fires on the 10th onVqPick AND the manual "Grade My Vocab
    // Quiz" button calls this too — without this guard the score posts twice.
    if (_state.vocabSubmitted) return;
    var score = Object.values(_state.vqAnswers).filter(function(v) { return v; }).length;
    _state.vqScore = score;

    var box = document.getElementById('vquiz-score');
    // unit-1 markup uses #vq-score-n; units 2-8 use #vq-score-num.
    var nEl = document.getElementById('vq-score-n') || document.getElementById('vq-score-num');
    var msgEl = document.getElementById('vq-pass-msg');
    if (box && nEl && msgEl) {
      nEl.textContent = score + '/' + c.vocab.total;
      box.style.display = 'block';
      if (score >= c.vocab.pass) {
        msgEl.textContent = '✅ Passed! Mastery Module unlocked.';
        _state.vocabPassed = true;
        _state.unlockedPanels.add(c.dsmPanelId);
        localStorage.setItem('sol_' + c.unitKey + '_vocab', 'passed');
        var vocabSeconds = _state.vocabStart
          ? Math.round((Date.now() - _state.vocabStart) / 1000)
          : null;
        _send({
          action: 'score', lesson: 'Vocab Lock-In',
          score: score, total: c.vocab.total,
          pct: Math.round((score / c.vocab.total) * 100),
          timeOnQuiz: vocabSeconds
        });
        _state.vocabSubmitted = true;
        _initDSMPlayer();
      } else {
        msgEl.textContent = '❌ Score ' + score + '/' + c.vocab.total + '. Need ' + c.vocab.pass + '/' + c.vocab.total + '. Review missed terms and retry.';
      }
    }
    _scheduleSave();
  }

  function retryVocab() {
    _state.vqAnswers = {};
    _state.vqScore = 0;
    document.querySelectorAll('.vq-opt').forEach(function(o) {
      o.classList.remove('revealed', 'correct', 'incorrect');
    });
    document.querySelectorAll('.vq-result').forEach(function(r) {
      r.className = 'vq-result';
      r.textContent = '';
    });
    var box = document.getElementById('vquiz-score');
    if (box) box.style.display = 'none';
    _scheduleSave();
  }

  // ── PRACTICE TEST ────────────────────────────────────────
  function onSolPick(opt) {
    var qq = opt.closest ? opt.closest('.qq') : null;
    // Compatibility with old API: solPick(opt) where opt is the chosen-letter
    // string AND we look up the question by closest from the click target.
    // Most call sites pass `this` so opt IS the element.
    if (!qq && opt && opt.target) qq = opt.target.closest('.qq');
    if (!qq) {
      // Fall back: opt may already be a value letter, but we have no element.
      console.warn('[UnitEngine] onSolPick called without an element');
      return;
    }
    if (qq.querySelector('.qo.revealed')) return;

    // Stamp the practice-test start time on first answered question.
    if (_state.practiceStart == null) _state.practiceStart = Date.now();

    var ans = qq.dataset.correct || qq.dataset.ans;
    var chosen = (opt.dataset && opt.dataset.v) || (typeof opt === 'string' ? opt : '');
    var standard = qq.dataset.std || qq.dataset.standard || null;
    var qNumAttr = qq.dataset.qNum || qq.dataset.qnum || qq.id || '';
    var qNum = parseInt(String(qNumAttr).replace(/\D/g, '')) || (_state.questionDetail.length + 1);

    qq.querySelectorAll('.qo').forEach(function(o) {
      o.classList.add('revealed');
      if (o.dataset.v === ans) o.classList.add('correct');
      else if (o.dataset.v === chosen && chosen !== ans) o.classList.add('incorrect');
    });
    var exp = qq.querySelector('.qexp');
    if (exp) {
      exp.classList.add('show');
      if (chosen !== ans) exp.classList.add('qexp-wrong');
    }

    var stemEl = qq.querySelector('.q-stem');
    var stem = stemEl ? stemEl.textContent.trim() : '';
    _state.questionDetail.push({
      std: standard, qNum: String(qNum), chosen: chosen, correct: ans,
      isCorrect: chosen === ans, questionText: stem,
      correctAnswer: '', studentAnswer: ''
    });

    _state.pracAnswered++;
    if (chosen === ans) _state.pracCorrect++;
    else if (standard) _state.missedStds[standard] = (_state.missedStds[standard] || 0) + 1;

    var progMsg = document.getElementById('sol-progress-msg');
    if (progMsg) progMsg.textContent = _state.pracAnswered + ' of ' + _config.totalSolQ + ' answered';

    if (_state.pracAnswered >= _config.totalSolQ) {
      _showDangerZone();
      // Auto-scroll to the danger-zone summary after the explanation
      // animation settles. Original behavior; gives the student a beat
      // before the page jumps.
      setTimeout(function() {
        var dz = document.getElementById('dz-result');
        if (dz) dz.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 800);
    }
    _scheduleSave();
  }

  function _showDangerZone() {
    var pct = _state.pracAnswered > 0
      ? Math.round((_state.pracCorrect / _config.totalSolQ) * 100)
      : 0;
    var waiting = document.getElementById('dz-waiting');
    if (waiting) waiting.style.display = 'none';
    var box = document.getElementById('dz-result');
    if (!box) {
      var trBtn = document.getElementById('to-results-btn');
      if (trBtn) trBtn.disabled = false;
      return;
    }
    box.style.display = 'block';

    var cls, emoji, label, msg;
    if (pct >= 80)      { cls='green';  emoji='🟢'; label='STRONG — You\'re in good shape on ' + _config.standard; msg='Score: '+pct+'%. You\'re above the 80% threshold.'; }
    else if (pct >= 60) { cls='yellow'; emoji='🟡'; label='CAUTION — Review needed on ' + _config.standard; msg='Score: '+pct+'%. Review missed standards before the SOL.'; }
    else                { cls='red';    emoji='🔴'; label='DANGER ZONE — ' + _config.standard + ' needs work'; msg='Score: '+pct+'%. Re-read all sections and retake.'; }
    box.className = 'dz-box ' + cls;

    var s  = document.getElementById('dz-score');  if (s)  s.textContent  = _state.pracCorrect + '/' + _config.totalSolQ;
    var em = document.getElementById('dz-emoji');  if (em) em.textContent = emoji;
    var lb = document.getElementById('dz-label');  if (lb) lb.textContent = label;
    var mg = document.getElementById('dz-msg');    if (mg) mg.textContent = msg;

    var stdKeys = Object.keys(_state.missedStds);
    var smap = _config.standardsMap || {};
    if (stdKeys.length > 0) {
      var missed = document.getElementById('dz-missed');
      var list   = document.getElementById('dz-missed-list');
      if (missed) missed.style.display = 'block';
      if (list) list.innerHTML = stdKeys.map(function(k) {
        return '<div class="dz-missed-item"><strong>' + k + '</strong>: '
          + (smap[k] || k) + ' — missed ' + _state.missedStds[k] + ' question(s)</div>';
      }).join('');
    }

    var trBtn = document.getElementById('to-results-btn');
    if (trBtn) trBtn.disabled = false;
    var sbLast = document.getElementById('sb' + (_config.totalPanels - 1));
    if (sbLast) sbLast.classList.add('done');

    try {
      localStorage.setItem('sol_'+_config.unitKey+'_score',  _state.pracCorrect+'/'+_config.totalSolQ);
      localStorage.setItem('sol_'+_config.unitKey+'_pct',    pct);
      localStorage.setItem('sol_'+_config.unitKey+'_status', cls);
      localStorage.setItem('sol_'+_config.unitKey+'_done',   'true');
    } catch (e) {}
  }

  function submitFinalScore() {
    if (_state.pracAnswered < _config.totalSolQ) {
      showToast('Answer all ' + _config.totalSolQ + ' questions first!');
      return;
    }
    var pct = Math.round((_state.pracCorrect / _config.totalSolQ) * 100);

    // Disable the submit button immediately so the student can't double-click.
    var dzBtn = document.getElementById('dz-submit-btn');
    if (dzBtn) dzBtn.disabled = true;

    var practiceSeconds = _state.practiceStart
      ? Math.round((Date.now() - _state.practiceStart) / 1000)
      : null;
    _send({
      action: 'score', lesson: 'Practice Test',
      score: _state.pracCorrect, total: _config.totalSolQ, pct: pct,
      timeOnQuiz: practiceSeconds
    });
    _send({
      action: 'quizDetail', lesson: 'Practice Test',
      questions: _state.questionDetail
    });
    _state.unlockedPanels.add(_config.totalPanels - 1);

    // Wait for the score write to land before declaring success/failure.
    Promise.resolve(_lastScorePromise || Promise.resolve()).then(function(result) {
      _state.practiceAlreadySubmitted = true;
      _state.priorPracticeScore = { score: _state.pracCorrect, total: _config.totalSolQ, pct: pct };
      var rb = document.getElementById('dz-retake-btn');
      if (rb) rb.style.display = 'none';
      if (dzBtn) {
        if (result && result.buffered) {
          dzBtn.textContent = '✓ Saved offline — will sync on reload';
        } else if (result) {
          dzBtn.textContent = '✅ Score Sent!';
        } else {
          dzBtn.textContent = '⚠ Save failed — retry?';
          dzBtn.disabled = false;
        }
      }
      // Don't auto-navigate — student clicks "Continue to Results" via #to-results-btn.
    });
  }

  function retakePractice() {
    if (_state.practiceAlreadySubmitted) {
      showToast('Practice test is locked — retake disabled by your teacher.');
      return;
    }
    _state.pracAnswered = 0;
    _state.pracCorrect = 0;
    _state.questionDetail = [];
    _state.missedStds = {};
    document.querySelectorAll('#p' + (_config.totalPanels - 2) + ' .qq').forEach(function(qq) {
      qq.querySelectorAll('.qo').forEach(function(o) {
        o.classList.remove('revealed', 'correct', 'incorrect');
      });
      var exp = qq.querySelector('.qexp');
      if (exp) { exp.classList.remove('show', 'qexp-wrong'); exp.style.display = ''; }
    });
    // Reset the danger-zone visual state to its pre-submit defaults.
    var dzr  = document.getElementById('dz-result');
    if (dzr) { dzr.style.display = 'none'; dzr.className = 'dz-box'; }
    var dm   = document.getElementById('dz-missed');      if (dm)   dm.style.display   = 'none';
    var dml  = document.getElementById('dz-missed-list'); if (dml)  dml.innerHTML      = '';
    var ds   = document.getElementById('dz-submit-btn');  if (ds)   { ds.textContent  = '📤 Submit Score to Mr. England'; ds.disabled = false; }
    var trb  = document.getElementById('to-results-btn'); if (trb)  trb.disabled       = true;
    var wait = document.getElementById('dz-waiting');     if (wait) wait.style.display = 'block';
    var progMsg = document.getElementById('sol-progress-msg');
    if (progMsg) progMsg.textContent = '0 of ' + _config.totalSolQ + ' answered';
    _scheduleSave();
  }

  // ── PRETEST + PRACTICE LOCKS ─────────────────────────────
  function _checkPretestLock() {
    if (!solAPI.getAllowRetakes || solAPI.getAllowRetakes()) return;
    if (!_state.studentName || !solAPI.hasPriorScore) return;
    solAPI.hasPriorScore(_state.studentName, _config.moduleName, 'Pretest').then(function(prior) {
      if (!prior) return;
      _state.pretestAlreadySubmitted = true;
      _state.priorPretestScore = prior;
      _applyPretestLockUI();
    });
  }

  function _applyPretestLockUI() {
    if (!_state.pretestAlreadySubmitted || !_state.priorPretestScore) return;
    var p = _state.priorPretestScore;
    var p0 = document.getElementById('p0');
    if (p0 && !document.getElementById('pretest-already-banner')) {
      var banner = document.createElement('div');
      banner.id = 'pretest-already-banner';
      banner.style.cssText = 'background:#dcfce7;border:2px solid #16a34a;color:#166534;padding:14px 18px;border-radius:10px;margin:16px 0;font-weight:600;line-height:1.5';
      banner.innerHTML = '✓ Pretest already submitted: ' + p.score + '/' + p.total + ' (' + (p.pct || 0) + '%). The pretest is a one-time diagnostic — you can continue to the lesson below.';
      var lc = p0.querySelector('.lc');
      (lc || p0).insertBefore(banner, (lc || p0).firstChild);
    }
    // Hide the pretest questions so a re-enrolled student can't re-take.
    document.querySelectorAll('#p0 .qq, #p0 .gate-q').forEach(function(qq) { qq.style.display = 'none'; });
    _state.pretestSent = true;
    // Pre-fill gate-answered set with sentinel keys so _checkGate(0) unlocks panel 1.
    if (!_state.gateAnswered[0]) _state.gateAnswered[0] = new Set();
    var req = (_config.gateRequired && _config.gateRequired[0]) || 5;
    for (var i = 0; i < req; i++) _state.gateAnswered[0].add('pretest-locked-' + i);
    _state.unlockedPanels.add(1);
    _checkGate(0);
  }

  function _checkPracticeLock() {
    if (!solAPI.getAllowRetakes || solAPI.getAllowRetakes()) return;
    if (!_state.studentName || !solAPI.hasPriorScore) return;
    solAPI.hasPriorScore(_state.studentName, _config.moduleName, 'Practice Test').then(function(prior) {
      if (!prior) return;
      _state.practiceAlreadySubmitted = true;
      _state.priorPracticeScore = prior;
      _applyPracticeLockUI();
    });
  }

  function _applyPracticeLockUI() {
    if (!_state.practiceAlreadySubmitted || !_state.priorPracticeScore) return;
    var p = _state.priorPracticeScore;
    var locked = document.getElementById('practice-test-locked');
    if (locked) {
      locked.innerHTML =
        '<div class="practice-locked-icon">✓</div>' +
        '<div class="practice-locked-title">Practice Test Already Submitted</div>' +
        '<div class="practice-locked-sub">Your score: ' + p.score + '/' + p.total + ' (' + (p.pct || 0) + '%). Talk to your teacher if you need to retake.</div>';
      locked.style.display = '';
    }
    var box = document.getElementById('sol-practice-box');  if (box) box.style.display = 'none';
    var rb  = document.getElementById('dz-retake-btn');     if (rb)  rb.style.display  = 'none';
    _state.unlockedPanels.add(_config.totalPanels - 1);
  }

  // ── HEARTBEAT ────────────────────────────────────────────
  function _startHeartbeat() {
    _stopHeartbeat();
    _hbInterval = setInterval(function() {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - _hbLastActive > HEARTBEAT_PRESENCE_WINDOW_MS) return;
      if (!_state.studentName || !_config) return;
      var moduleKey = _config.unitKey.replace(/^unit/, 'unit-');
      if (solAPI.pingProgress) solAPI.pingProgress(moduleKey, _state.studentName);
    }, HEARTBEAT_MS);
  }

  function _stopHeartbeat() {
    if (_hbInterval) clearInterval(_hbInterval);
    _hbInterval = null;
  }

  // ── DSM PLAYER ───────────────────────────────────────────
  function _initDSMPlayer() {
    if (!window.DSMPlayer || !DSMPlayer.init) return;
    DSMPlayer.init({
      unitNumber:   _config.unitNumber,
      moduleName:   _config.moduleName,
      standard:     _config.standard,
      unitKey:      _config.unitKey,
      panelId:      _config.dsmPanelId,
      containerId:  _config.dsm.containerId,
      unlockPanels: _config.unlockOnMastery,
      studentName:  _state.studentName,
      onComplete:   _onMasteryComplete,
      onSkip:       _onMasterySkip
    });
  }

  function _onMasteryComplete() {
    _config.unlockOnMastery.forEach(function(p) { _state.unlockedPanels.add(p); });
    var lockOverlay = document.getElementById('practice-locked');
    if (lockOverlay) lockOverlay.style.display = 'none';
    if (!_state.practiceAlreadySubmitted) {
      var tl = document.getElementById('practice-test-locked'); if (tl) tl.style.display = 'none';
      var tb = document.getElementById('sol-practice-box'); if (tb) tb.style.display = 'block';
    } else {
      _applyPracticeLockUI();
    }
    _scheduleSave();
  }

  function _onMasterySkip() {
    _config.unlockOnMastery.forEach(function(p) { _state.unlockedPanels.add(p); });
    var lockOverlay = document.getElementById('practice-locked');
    if (lockOverlay) lockOverlay.style.display = 'none';
    if (!_state.practiceAlreadySubmitted) {
      var tl = document.getElementById('practice-test-locked'); if (tl) tl.style.display = 'none';
      var tb = document.getElementById('sol-practice-box'); if (tb) tb.style.display = 'block';
    } else {
      _applyPracticeLockUI();
    }
  }

  // ── UI HELPERS ───────────────────────────────────────────
  function showToast(msg) {
    var t = document.getElementById('toast');
    var m = document.getElementById('toast-msg');
    // Prefer the inner span (HTML uses <div id="toast">📤 <span id="toast-msg">…</span></div>);
    // fall back to overwriting the toast div text content.
    if (m) m.textContent = msg;
    else if (t) t.textContent = msg;
    else {
      t = document.createElement('div');
      t.id = 'toast';
      t.className = 'toast';
      t.textContent = msg;
      document.body.appendChild(t);
    }
    if (t) {
      t.style.display = 'flex';
      setTimeout(function() { t.style.display = 'none'; }, 3500);
    }
  }

  function startFresh() {
    if (solAPI.clearProgress && _state.studentName) {
      solAPI.clearProgress(_config.unitKey.replace(/^unit/, 'unit-'), _state.studentName);
    }
    localStorage.removeItem('sol_' + _config.unitKey + '_progress');
    localStorage.removeItem('sol_' + _config.unitKey + '_vocab');
    if (solAPI.clearClass) solAPI.clearClass();
    location.reload();
  }

  // ── PUBLIC API ───────────────────────────────────────────
  return {
    boot: boot,
    state: {
      get: _stateGet,
      set: _stateSet
    },
    // DOM event handlers (called from inline lesson HTML)
    onGateAnswer:   onGateAnswer,
    onVqPick:       onVqPick,
    onFlipCard:     onFlipCard,
    onSolPick:      onSolPick,
    goTo:           goTo,
    retakePractice: retakePractice,
    submitFinalScore: submitFinalScore,
    showDangerZone:   _showDangerZone,
    showToast:        showToast,
    markAnswered:     markAnswered,
    retryVocab:       retryVocab,
    gradeVocab:       _gradeVocab,
    startUnit:        startUnit,
    startFresh:       startFresh,
    signInWithGoogle: signInWithGoogle,
    flushSave:        _flushSave
  };
})();
