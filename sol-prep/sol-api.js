/* ================================================================
   SOL API — Shared Supabase Backend for SOL Prep
   Replaces Google Apps Script with Supabase PostgreSQL.

   SETUP: After creating your Supabase project, update the two
   config values below (URL and anon key). That's it.
   ================================================================ */

var solAPI = (function() {

  // ── CONFIG ─────────────────────────────────────────────────────
  // Single source of truth lives in shared/supabase-config.js (loaded
  // from login.html and dashboard.html). Hardcoded fallback below is
  // for unit pages and any HTML that hasn't yet been updated to load
  // supabase-config.js — keep it in sync until full centralization.
  // To rotate the key: change shared/supabase-config.js AND the two
  // hardcoded fallbacks below + in shared/portal-api.js.
  var SUPABASE_URL = (typeof window !== 'undefined' && window.SUPABASE_URL)
    || 'https://cogpsieldrgeqlemhosy.supabase.co';
  var SUPABASE_ANON_KEY = (typeof window !== 'undefined' && window.SUPABASE_ANON_KEY)
    || 'sb_publishable_Wn4L2S2gMPq2cLoiLt2tIQ_z4e7IUZU';

  // Lazy-loaded Supabase JS client (only when SSO is invoked).
  var SB_LIB_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.103.0';
  var SB_LIB_SRI = 'sha384-PsnFqJ58vyp7buRfuvdS2SrjRdUYinBv6lWwJXx3xQ17hWefo/UkwXowVBT53ubG';
  var _sbClient = null;
  var _sbLibPromise = null;

  // ── INTERNAL STATE ──
  var _classId = null;
  var _classCode = '';
  var _className = '';
  var _teacherName = '';
  var _examDate = null;
  var _allowRetakes = true;
  var _masteryThreshold = 100;

  // SSO session state (null when student is using legacy name-modal flow).
  var _session = null;
  var _studentId = null;
  var _studentEmail = '';
  var _studentDisplayName = '';

  // Single source of truth for auth.uid() — denormalized onto every
  // write payload so RLS can use a self-contained `auth_user_id =
  // auth.uid()` check (no cross-table subqueries; FERPA Phase 2).
  function _authUid() {
    return (_session && _session.user && _session.user.id) || null;
  }

  // ── SUPABASE REST HELPER ──
  function _rest(method, table, opts) {
    opts = opts || {};
    var url = SUPABASE_URL + '/rest/v1/' + table;
    if (opts.query) url += '?' + opts.query;

    var headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + ((_session && _session.access_token) ? _session.access_token : SUPABASE_ANON_KEY),
      'Content-Type': 'application/json'
    };
    if (opts.prefer) headers['Prefer'] = opts.prefer;

    var fetchOpts = { method: method, headers: headers };
    if (opts.body) fetchOpts.body = JSON.stringify(opts.body);
    if (opts.keepalive) fetchOpts.keepalive = true;

    return fetch(url, fetchOpts);
  }

  // ── OFFLINE BUFFER (failed critical writes queued in localStorage) ──
  // After _postWithRetry exhausts its retry, the row is parked in
  // localStorage and re-attempted on the next page load (when getStored()
  // restores the class). Caps + age limit prevent runaway accumulation
  // on a permanently-broken setup.
  var BUFFER_KEY = 'sol_pending_writes';
  var MAX_BUFFER_ROWS = 50;
  var MAX_BUFFER_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  var _drainPromise = null;

  function _readBuffer() {
    try {
      var raw = localStorage.getItem(BUFFER_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch(e) { return []; }
  }

  function _writeBuffer(rows) {
    try {
      localStorage.setItem(BUFFER_KEY, JSON.stringify(rows));
    } catch(e) {
      try {
        localStorage.setItem(BUFFER_KEY, JSON.stringify(rows.slice(Math.floor(rows.length / 2))));
      } catch(e2) {
        console.error('[solAPI] localStorage buffer write failed:', e2.message);
      }
    }
  }

  function _bufferFailedWrite(table, body, label) {
    var rows = _readBuffer();
    rows.push({ table: table, body: body, label: label, savedAt: Date.now() });
    while (rows.length > MAX_BUFFER_ROWS) rows.shift();
    _writeBuffer(rows);
    console.log('[solAPI] buffered ' + label + ' for retry on next page load (' + rows.length + ' pending)');
  }

  function _drainBuffer() {
    if (_drainPromise) return _drainPromise;
    var rows = _readBuffer();
    if (rows.length === 0) return Promise.resolve(0);
    var now = Date.now();
    rows = rows.filter(function(r) {
      return r && r.table && r.body && r.savedAt && (now - r.savedAt) < MAX_BUFFER_AGE_MS;
    });
    var remaining = [];
    var succeeded = 0;
    function processOne(i) {
      if (i >= rows.length) {
        _writeBuffer(remaining);
        if (succeeded > 0) {
          console.log('[solAPI] drained ' + succeeded + ' offline write(s); ' + remaining.length + ' still pending');
          if (typeof window.showToast === 'function') {
            window.showToast('\u2713 Saved ' + succeeded + ' offline ' + (succeeded === 1 ? 'submission' : 'submissions'));
          }
        }
        return succeeded;
      }
      var r = rows[i];
      // FERPA Phase 2 backwards-compat: writes buffered before this
      // deploy were serialized without auth_user_id. After RLS lockdown
      // those would be rejected forever. If we have a session now,
      // inject the field at drain time so the retry succeeds.
      var auid = _authUid();
      if (auid && r.body) {
        if (Array.isArray(r.body)) {
          r.body.forEach(function(row) {
            if (row && row.auth_user_id == null) row.auth_user_id = auid;
          });
        } else if (r.body.auth_user_id == null) {
          r.body.auth_user_id = auid;
        }
      }
      return _rest('POST', r.table, { body: r.body, prefer: 'return=representation' })
        .then(function(resp) {
          if (resp && resp.ok) succeeded++;
          else remaining.push(r);
        })
        .catch(function() { remaining.push(r); })
        .then(function() { return processOne(i + 1); });
    }
    _drainPromise = processOne(0).then(function(n) {
      _drainPromise = null;
      return n;
    });
    return _drainPromise;
  }

  // ── ERROR-AWARE WRITE HELPERS ──
  // _postWithRetry: critical student writes (score, quiz_detail, checkpoint).
  //   Validates HTTP status, retries once after 2s. On permanent failure,
  //   buffers the row to localStorage for re-attempt on next page load.
  // _postBestEffort: high-frequency non-critical writes (activity, beacon).
  //   Validates and logs, no retry, never blocks downstream code.
  function _postWithRetry(table, body, label) {
    // Prefer: return=representation makes RLS rejections surface as 401
    // with an error body — return=minimal historically masked them as 201s
    // (the "phantom-state" class of bug that silently lost student data).
    function attempt() {
      return _rest('POST', table, { body: body, prefer: 'return=representation' })
        .then(function(r) {
          if (!r.ok) {
            throw new Error('HTTP ' + r.status + ' ' + (r.statusText || ''));
          }
          return r;
        });
    }
    return attempt().catch(function(err1) {
      console.warn('[solAPI] ' + label + ' first attempt failed:', err1.message);
      return new Promise(function(resolve) { setTimeout(resolve, 2000); })
        .then(attempt)
        .then(function(r) {
          console.log('[solAPI] ' + label + ' retry succeeded');
          return r;
        })
        .catch(function(err2) {
          console.error('[solAPI] ' + label + ' FAILED after retry:', err2.message);
          _bufferFailedWrite(table, body, label);
          if (typeof window.showToast === 'function') {
            window.showToast('\u26A0 Saved ' + label + ' offline \u2014 will retry when you reload');
          }
          // Audit #12: return a sentinel so callers can differentiate
          // 'saved offline, will sync on next load' from 'this is live on
          // the server right now'. The UI used to lie ('Save failed - retry?')
          // for buffered writes - data was safe but the message looked like
          // a hard failure.
          return { buffered: true, label: label };
        });
    });
  }

  function _postBestEffort(table, body, label, opts) {
    var fetchOpts = { body: body, prefer: 'return=representation' };
    if (opts && opts.keepalive) fetchOpts.keepalive = true;
    return _rest('POST', table, fetchOpts)
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r;
      })
      .catch(function(err) {
        console.warn('[solAPI] ' + label + ' failed (non-critical):', err.message);
      });
  }

  // ── VALIDATE CLASS CODE ──────────────────────────────────────
  // Returns a promise: { valid: true, teacher, label } or { valid: false }
  function validateCode(code) {
    code = code.trim().toUpperCase();
    return _rest('GET', 'classes', {
      query: 'code=eq.' + encodeURIComponent(code) + '&is_active=eq.true&select=id,code,label,teacher_name,exam_date,allow_retakes,mastery_threshold'
    })
    .then(function(r) { return r.json(); })
    .then(function(rows) {
      if (!rows || rows.length === 0) return { valid: false };
      var c = rows[0];
      _classId = c.id;
      _classCode = c.code;
      _className = c.label;
      _teacherName = c.teacher_name;
      _examDate = c.exam_date || null;
      _allowRetakes = (c.allow_retakes !== false);
      _masteryThreshold = (c.mastery_threshold === 85 || c.mastery_threshold === 90) ? c.mastery_threshold : 100;
      return { valid: true, teacher: c.teacher_name, label: c.label, examDate: c.exam_date, allowRetakes: _allowRetakes, masteryThreshold: _masteryThreshold };
    })
    .catch(function() {
      return { valid: false };
    });
  }

  // ── NAME NORMALIZATION ──────────────────────────────────────
  // Canonicalize a student-entered name to a stable form so that
  // "wade clevinger" / "WADE CLEVINGER" / "  Wade Clevinger  " all
  // resolve to the same identity in the database. Without this, the
  // honor-system flow creates a new gradebook row per capitalization
  // variant. SSO eliminates this; until then, this is the patch.
  function canonicalizeName(s) {
    return (s || '').trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  }

  // ── SUBMIT DATA ──────────────────────────────────────────────
  // Drop-in replacement for the old send() logic.
  // Receives the full payload with: student, module, action, lesson, etc.
  // Routes to the correct Supabase table based on action.
  // Returns a Promise so callers can show a confirmation toast only
  // after the network round-trip succeeds. Resolves with the response
  // on success or with `undefined` on permanent failure.
  function submit(payload) {
    if (!_classId) return Promise.resolve();

    var action = payload.action;
    var student = payload.student;
    var module = payload.module;

    var auid = _authUid();

    if (action === 'score') {
      return _postWithRetry('scores', {
        class_id: _classId,
        student_id: _studentId,
        auth_user_id: auid,
        student_name: student,
        module: module,
        lesson: payload.lesson || '',
        score: payload.score,
        total: payload.total,
        pct: payload.pct,
        time_on_quiz: payload.timeOnQuiz || null,
        assignment_id: payload.assignmentId || null,
        // Tie a Mastery Module pass to the specific dsm_modules row the
        // student passed against. When the teacher republishes a DSM
        // (new module ID), lookups at init() no longer match this row
        // and the student is correctly required to retake.
        dsm_module_id: payload.dsmModuleId || null
      }, 'score');
    }
    else if (action === 'quizDetail') {
      var questions = payload.questions || [];
      var rows = questions.map(function(q) {
        return {
          class_id: _classId,
          student_id: _studentId,
          auth_user_id: auid,
          student_name: student,
          module: module,
          lesson: payload.lesson || '',
          q_num: q.qNum || 0,
          question_text: q.questionText || q.question || '',
          student_answer: q.studentAnswer || '',
          correct_answer: q.correctAnswer || '',
          is_correct: !!q.isCorrect,
          standard: q.std || null,
          assignment_id: payload.assignmentId || null
        };
      });
      if (rows.length > 0) {
        return _postWithRetry('quiz_detail', rows, 'quiz answers');
      }
      return Promise.resolve();
    }
    else if (action === 'checkpoint') {
      return _postWithRetry('checkpoints', {
        class_id: _classId,
        student_id: _studentId,
        auth_user_id: auid,
        student_name: student,
        module: module,
        lesson: payload.lesson || '',
        response_text: payload.response || payload.responseText || payload.text || '',
        score: payload.score || null
      }, 'checkpoint');
    }
    else if (action === 'activity') {
      // Collect extra fields into metadata
      var meta = {};
      var skip = { action:1, student:1, module:1, lesson:1, event:1, duration:1, classPeriod:1 };
      Object.keys(payload).forEach(function(k) {
        if (!skip[k]) meta[k] = payload[k];
      });
      return _postBestEffort('activity', {
        class_id: _classId,
        student_id: _studentId,
        auth_user_id: auid,
        student_name: student,
        module: module,
        lesson: payload.lesson || '',
        event: payload.event || 'unknown',
        duration: payload.duration || null,
        metadata: Object.keys(meta).length > 0 ? meta : null
      }, 'activity');
    }
    return Promise.resolve();
  }

  // ── CROSS-DEVICE PROGRESS SYNC ──────────────────────────────
  // Saves a JSON snapshot of in-progress quiz state to Supabase
  // keyed by (class_id, student_name, module). Lets a student
  // resume on a different machine after restoring the same name.
  // Save calls are debounced (1.5s) to coalesce rapid panel
  // transitions into one network round-trip.
  var _progressTimers = {};
  var PROGRESS_DEBOUNCE_MS = 1500;

  // Persist immediately (no debounce). Returns the fetch promise.
  function _saveProgressNow(module, studentName, progressData, keepalive) {
    if (!_classId || !studentName || !module) return Promise.resolve();
    // FERPA Phase 2.5: quiz_progress is now auth_user_id-scoped via RLS.
    // No session => no write (and no point — student couldn't read it back
    // either after the lockdown).
    var auid = _authUid();
    if (!auid) return Promise.resolve();
    var body = {
      class_id: _classId,
      auth_user_id: auid,
      student_name: studentName,
      module: module,
      progress_data: progressData
    };
    // UPSERT on (class_id, student_name, module) unique constraint
    return _rest('POST', 'quiz_progress', {
      query: 'on_conflict=class_id,student_name,module',
      body: body,
      prefer: 'resolution=merge-duplicates,return=representation',
      keepalive: !!keepalive
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    }).catch(function(err) {
      console.warn('[solAPI] saveProgress failed:', err.message);
    });
  }

  // Public: debounced save. Coalesces bursts of state changes.
  function saveProgress(module, studentName, progressData) {
    if (!_classId || !studentName || !module) return;
    var key = module + '|' + studentName;
    if (_progressTimers[key]) clearTimeout(_progressTimers[key]);
    _progressTimers[key] = setTimeout(function() {
      _progressTimers[key] = null;
      _saveProgressNow(module, studentName, progressData);
    }, PROGRESS_DEBOUNCE_MS);
  }

  // Public: fetch latest remote progress for this student/module.
  // Returns Promise<{progress_data, updated_at} | null>.
  function getProgress(module, studentName) {
    if (!_classId || !studentName || !module) return Promise.resolve(null);
    var q = 'class_id=eq.' + encodeURIComponent(_classId)
      + '&student_name=eq.' + encodeURIComponent(studentName)
      + '&module=eq.' + encodeURIComponent(module)
      + '&select=progress_data,updated_at&limit=1';
    return _rest('GET', 'quiz_progress', { query: q })
      .then(function(r) { return r.ok ? r.json() : []; })
      .then(function(rows) { return (rows && rows[0]) || null; })
      .catch(function(err) {
        console.warn('[solAPI] getProgress failed:', err.message);
        return null;
      });
  }

  // Public: delete remote progress (called on quiz completion or
  // an explicit "start fresh").
  function clearProgress(module, studentName) {
    if (!_classId || !studentName || !module) return Promise.resolve();
    // Cancel any pending debounced save first.
    var key = module + '|' + studentName;
    if (_progressTimers[key]) {
      clearTimeout(_progressTimers[key]);
      _progressTimers[key] = null;
    }
    var q = 'class_id=eq.' + encodeURIComponent(_classId)
      + '&student_name=eq.' + encodeURIComponent(studentName)
      + '&module=eq.' + encodeURIComponent(module);
    return _rest('DELETE', 'quiz_progress', { query: q, prefer: 'return=representation' })
      .catch(function(err) {
        console.warn('[solAPI] clearProgress failed:', err.message);
      });
  }

  // Public: synchronous flush — fire any pending debounced save
  // immediately. Use on page hide / quiz finish to avoid losing
  // the last few seconds of state.
  function flushProgress(module, studentName, progressData) {
    var key = module + '|' + studentName;
    if (_progressTimers[key]) {
      clearTimeout(_progressTimers[key]);
      _progressTimers[key] = null;
    }
    // keepalive=true so the request survives page-unload
    return _saveProgressNow(module, studentName, progressData, true);
  }

  // Heartbeat: tiny PATCH that bumps quiz_progress.updated_at without
  // resending progress_data. Lets the Live Pulse dashboard tell when
  // a student is reading vs walked away — the row's updated_at is now
  // a 'last seen working' signal as long as the page calls this on
  // a timer while the tab is visible + recently-active.
  // No-op if no row exists yet (student hasn't done a save).
  function pingProgress(module, studentName) {
    if (!_classId || !studentName || !module) return Promise.resolve();
    var q = 'class_id=eq.' + encodeURIComponent(_classId)
      + '&student_name=eq.' + encodeURIComponent(studentName)
      + '&module=eq.' + encodeURIComponent(module);
    return _rest('PATCH', 'quiz_progress', {
      query: q,
      body: { updated_at: new Date().toISOString() },
      prefer: 'return=representation'
    }).catch(function() { /* swallow — heartbeats are best-effort */ });
  }

  // ── MODULE RELEASE STATE (teacher-controlled lockout) ────
  // Returns Promise<bool>. True = students can use this module;
  // false = show locked overlay. Defaults to TRUE on any failure
  // (network error, missing row) so we don't accidentally lock the
  // whole site if Supabase is down.
  //
  // Resolution order:
  //   1. student_module_overrides for (_studentId, moduleKey) wins
  //      if a row exists. Lets a teacher force-OPEN a unit for one
  //      student when the class is locked, or force-CLOSED for one
  //      student when the class is open.
  //   2. Otherwise fall back to module_releases.unlocked (the
  //      class-wide default).
  //
  // The override lookup is skipped when _studentId is null (e.g.
  // the page loaded before SSO hydration finished). The unit pages
  // gate this call AFTER applySSOSession so _studentId is set, but
  // the null-guard means a stale call still works safely.
  function _getGlobalLock(moduleKey) {
    return _rest('GET', 'module_releases', {
      query: 'module_key=eq.' + encodeURIComponent(moduleKey) + '&select=unlocked&limit=1'
    })
    .then(function(r) { return r.ok ? r.json() : []; })
    .then(function(rows) {
      // No row = treat as unlocked (safe default).
      if (!rows || rows.length === 0) return true;
      return rows[0].unlocked !== false;
    })
    .catch(function() { return true; });
  }

  function isModuleUnlocked(moduleKey) {
    if (!moduleKey) return Promise.resolve(true);
    if (!_studentId) return _getGlobalLock(moduleKey);
    return _rest('GET', 'student_module_overrides', {
      query: 'student_id=eq.' + encodeURIComponent(_studentId)
        + '&module_key=eq.' + encodeURIComponent(moduleKey)
        + '&select=unlocked&limit=1'
    })
    .then(function(r) { return r.ok ? r.json() : []; })
    .then(function(rows) {
      if (rows && rows.length > 0) return rows[0].unlocked === true;
      return _getGlobalLock(moduleKey);
    })
    .catch(function() { return _getGlobalLock(moduleKey); });
  }

  // ── MODULE-RELEASE GATE UI ──────────────────────────────────
  // Centralized lock-overlay DOM management. Each entry page used
  // to inline this; now they call solAPI.runModuleReleaseGate(key)
  // on page-load AND after applySSOSession (so a per-student
  // override granted via student_module_overrides flips state
  // immediately when the student signs in).
  //
  // Idempotent: safe to call repeatedly. State transitions:
  //   locked   -> hides #name-modal, .panel, .top-bar, .main,
  //               .modal-overlay; shows #module-release-lock-overlay
  //   unlocked -> removes #module-release-lock-overlay; clears the
  //               inline display:none we set on lock-down so CSS
  //               default visibility resumes.
  var _LOCK_OVERLAY_ID = 'module-release-lock-overlay';
  var _LOCK_HIDE_SELECTORS = '.panel, .top-bar, .main, .modal-overlay';

  function _showLockOverlay() {
    var modal = document.getElementById('name-modal');
    if (modal) modal.style.display = 'none';
    document.querySelectorAll(_LOCK_HIDE_SELECTORS).forEach(function(el) {
      el.style.display = 'none';
    });
    if (document.getElementById(_LOCK_OVERLAY_ID)) return;
    var ov = document.createElement('div');
    ov.id = _LOCK_OVERLAY_ID;
    ov.style.cssText = 'position:fixed;inset:0;background:linear-gradient(135deg,#0f2240,#1e3a6e);color:#fff;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;text-align:center;font-family:Source Sans 3,sans-serif';
    ov.innerHTML =
      '<div style="font-size:5rem;margin-bottom:20px">🔒</div>' +
      '<h1 style="font-family:Playfair Display,serif;font-size:2.4rem;font-weight:900;margin-bottom:14px;letter-spacing:-0.5px">Not Yet Open</h1>' +
      '<p style="font-size:1.1rem;line-height:1.6;max-width:520px;color:rgba(255,255,255,0.78);margin-bottom:28px">This module isn\'t available yet. We open units in class so we can work through them together. See your teacher when it\'s time.</p>' +
      '<a href="index.html" style="background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.25);color:#fff;text-decoration:none;padding:10px 24px;border-radius:24px;font-size:.9rem;font-weight:600">← Back to Portal</a>';
    document.body.appendChild(ov);
  }

  function _hideLockOverlay() {
    var ov = document.getElementById(_LOCK_OVERLAY_ID);
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    var modal = document.getElementById('name-modal');
    if (modal && modal.style.display === 'none') modal.style.display = '';
    document.querySelectorAll(_LOCK_HIDE_SELECTORS).forEach(function(el) {
      if (el.style.display === 'none') el.style.display = '';
    });
  }

  function runModuleReleaseGate(moduleKey) {
    if (!moduleKey) return Promise.resolve(true);
    return isModuleUnlocked(moduleKey).then(function(open) {
      if (open) _hideLockOverlay();
      else _showLockOverlay();
      return open;
    });
  }

  // ── BEACON (page unload) ─────────────────────────────────────
  // Uses fetch with keepalive (sendBeacon can't set custom headers).
  function beacon(payload) {
    if (!_classId) return;

    var meta = {};
    var skip = { action:1, student:1, module:1, lesson:1, event:1, duration:1, classPeriod:1 };
    Object.keys(payload).forEach(function(k) {
      if (!skip[k]) meta[k] = payload[k];
    });

    _postBestEffort('activity', {
      class_id: _classId,
      student_id: _studentId,
      auth_user_id: _authUid(),
      student_name: payload.student || '',
      module: payload.module || '',
      lesson: payload.lesson || '',
      event: payload.event || 'session_end',
      duration: payload.duration || null,
      metadata: Object.keys(meta).length > 0 ? meta : null
    }, 'beacon', { keepalive: true });
  }

  // ── LOCAL STORAGE (class info persists across units) ──────────
  function getStored() {
    try {
      var data = JSON.parse(localStorage.getItem('sol_class') || 'null');
      if (data && data.classId) {
        _classId = data.classId;
        _classCode = data.code;
        _className = data.label;
        _teacherName = data.teacher;
        _examDate = data.examDate || null;
        _allowRetakes = (data.allowRetakes !== false);
        _masteryThreshold = (data.masteryThreshold === 85 || data.masteryThreshold === 90) ? data.masteryThreshold : 100;
        // Class restored — kick off any buffered offline writes.
        // Fire-and-forget; failures stay in the buffer for next reload.
        setTimeout(function() { _drainBuffer(); }, 0);
        return data;
      }
    } catch(e) {}
    return null;
  }

  function storeClass() {
    localStorage.setItem('sol_class', JSON.stringify({
      classId: _classId,
      code: _classCode,
      label: _className,
      teacher: _teacherName,
      examDate: _examDate,
      allowRetakes: _allowRetakes,
      masteryThreshold: _masteryThreshold
    }));
  }

  function clearClass() {
    _classId = null;
    _classCode = '';
    _className = '';
    _teacherName = '';
    _examDate = null;
    _allowRetakes = true;
    _masteryThreshold = 100;
    localStorage.removeItem('sol_class');
  }

  // ── PRIOR PRACTICE SCORE LOOKUP ────────────────────────────
  // Returns Promise<{score, total, pct, created_at} | null>.
  // Used by practice-test.html to enforce a one-attempt-per-student
  // policy when the class has allow_retakes=false.
  // Generic helper: most recent score for any (module, lesson) combo.
  // Returns Promise<{score, total, pct, created_at} | null>.
  function hasPriorScore(studentName, module, lesson) {
    if (!_classId || !studentName || !module) return Promise.resolve(null);
    var q = 'class_id=eq.' + encodeURIComponent(_classId)
      + '&student_name=eq.' + encodeURIComponent(studentName)
      + '&module=eq.' + encodeURIComponent(module);
    if (lesson) q += '&lesson=eq.' + encodeURIComponent(lesson);
    q += '&select=score,total,pct,created_at&order=created_at.desc&limit=1';
    return _rest('GET', 'scores', { query: q })
      .then(function(r) { return r.ok ? r.json() : []; })
      .then(function(rows) { return (rows && rows[0]) || null; })
      .catch(function() { return null; });
  }

  // Like hasPriorScore but THROWS on lookup failure (network error, RLS
  // reject, non-2xx) instead of returning null. Lets the caller distinguish
  // "no score in DB" from "we don't know" — important for the DSM auto-
  // recovery flow where a network blip should NOT silently wipe a
  // legitimate localStorage 'passed' flag.
  //
  // Optional dsmModuleId: when supplied, the query matches either rows
  // tagged with that module ID OR rows with NULL dsm_module_id (i.e.
  // historical mastery earned before the dsm_module_id column existed).
  // This lets the DSM player invalidate scores tied to a now-replaced
  // module without invalidating legitimate pre-migration mastery.
  function lookupScoreStrict(studentName, module, lesson, dsmModuleId) {
    if (!_classId || !studentName || !module) return Promise.resolve(null);
    var q = 'class_id=eq.' + encodeURIComponent(_classId)
      + '&student_name=eq.' + encodeURIComponent(studentName)
      + '&module=eq.' + encodeURIComponent(module);
    if (lesson) q += '&lesson=eq.' + encodeURIComponent(lesson);
    if (dsmModuleId) {
      // PostgREST OR syntax: match this module ID OR untagged historical rows.
      q += '&or=(dsm_module_id.eq.' + encodeURIComponent(dsmModuleId) + ',dsm_module_id.is.null)';
    }
    q += '&select=score,total,pct,created_at,dsm_module_id&order=created_at.desc&limit=1';
    return _rest('GET', 'scores', { query: q })
      .then(function(r) {
        if (!r.ok) throw new Error('lookupScoreStrict HTTP ' + r.status);
        return r.json();
      })
      .then(function(rows) { return (rows && rows[0]) || null; });
  }

  function hasPriorPracticeScore(studentName, assignmentId) {
    if (!_classId || !studentName) return Promise.resolve(null);
    var q = 'class_id=eq.' + encodeURIComponent(_classId)
      + '&student_name=eq.' + encodeURIComponent(studentName)
      + '&module=eq.' + encodeURIComponent('SOL Prep \u2014 Practice Test Generator');
    if (assignmentId) {
      q += '&assignment_id=eq.' + encodeURIComponent(assignmentId);
    } else {
      q += '&assignment_id=is.null';
    }
    q += '&select=score,total,pct,created_at&order=created_at.desc&limit=1';
    return _rest('GET', 'scores', { query: q })
      .then(function(r) { return r.ok ? r.json() : []; })
      .then(function(rows) { return (rows && rows[0]) || null; })
      .catch(function() { return null; });
  }

  // ── REAL-TIME PER-QUESTION SUBMISSION ─────────────────────────
  // Writes a single quiz_detail row the moment a student answers.
  // Best-effort (non-blocking, no retry) so it doesn't slow the quiz.
  // The batch quizDetail submission at the end serves as a fallback
  // for any per-question writes that silently failed.
  function submitOneAnswer(payload) {
    if (!_classId) return Promise.resolve();
    var auid = _authUid();
    return _postBestEffort('quiz_detail', {
      class_id: _classId,
      student_id: _studentId,
      auth_user_id: auid,
      student_name: payload.student || '',
      module: payload.module || '',
      lesson: payload.lesson || '',
      q_num: payload.qNum || 0,
      question_text: payload.questionText || '',
      student_answer: payload.studentAnswer || '',
      correct_answer: payload.correctAnswer || '',
      is_correct: !!payload.isCorrect,
      standard: payload.std || null,
      assignment_id: payload.assignmentId || null
    }, 'quiz answer');
  }

  // ── ASSIGNMENTS ───────────────────────────────────────────────
  // Fetch an active assignment's config so practice-test.html can
  // apply the teacher's settings (mode, seed, std_targets, etc.).
  function getAssignment(assignmentId) {
    if (!assignmentId) return Promise.resolve(null);
    return _rest('GET', 'assignments', {
      query: 'id=eq.' + encodeURIComponent(assignmentId)
        + '&is_active=eq.true'
        + '&select=title,mode,seed,question_count,std_targets,allow_retake,due_date'
        + '&limit=1'
    })
    .then(function(r) { return r.ok ? r.json() : []; })
    .then(function(rows) { return (rows && rows[0]) || null; })
    .catch(function() { return null; });
  }

  // ── DSM (Dynamic Study Modules) ───────────────────────────────
  // Fetch published DSM questions for a given standard.
  // Bounded by a 5s wall-clock timeout: if Supabase doesn't respond in
  // time, we resolve to the same "no module" shape so the unit page's
  // onSkip path fires and panels 9/10/11 unlock anyway. Without this,
  // a hung fetch left students stuck at the mastery screen with the
  // Practice Test button greyed out forever (no retry, no fallback).
  var DSM_FETCH_TIMEOUT_MS = 5000;

  function getDSMQuestions(standard) {
    var fetchChain = _rest('GET', 'dsm_modules', {
      query: 'standard=eq.' + encodeURIComponent(standard) + '&status=eq.published&select=id,question_count,title&limit=1&order=created_at.desc'
    })
    .then(function(r) { return r.json(); })
    .then(function(modules) {
      if (!modules || modules.length === 0) return { module: null, questions: [] };
      var mod = modules[0];
      return _rest('GET', 'dsm_questions', {
        query: 'module_id=eq.' + mod.id + '&is_active=eq.true&order=sort_order&select=id,question_text,option_a,option_b,option_c,option_d,correct_answer,explanation'
      })
      .then(function(r) { return r.json(); })
      .then(function(questions) {
        return { module: mod, questions: questions || [] };
      });
    })
    .catch(function() { return { module: null, questions: [] }; });

    var timeout = new Promise(function(resolve) {
      setTimeout(function() {
        resolve({ module: null, questions: [], timedOut: true });
      }, DSM_FETCH_TIMEOUT_MS);
    });

    return Promise.race([fetchChain, timeout]).then(function(result) {
      if (result && result.timedOut) {
        console.warn('[solAPI] DSM fetch timed out after ' + DSM_FETCH_TIMEOUT_MS + 'ms; falling through to onSkip');
      }
      return result;
    });
  }

  // Create a DSM attempt record. FERPA Phase 2: auth_user_id must
  // be on the body — RLS WITH CHECK (auth_user_id = auth.uid()).
  // Without it, the INSERT is silently rejected; the DSM player
  // proceeds with no `attemptId` and the Mastery never records.
  function createDSMAttempt(data) {
    return _rest('POST', 'dsm_attempts', {
      body: {
        class_id: _classId,
        student_id: _studentId,
        auth_user_id: _authUid(),
        student_name: data.studentName,
        module_id: data.moduleId,
        unit_number: data.unitNumber,
        total_questions: data.totalQuestions,
        rounds_completed: 0,
        questions_missed: [],
        completed: false
      },
      prefer: 'return=representation'
    }).then(function(r) {
      if (!r.ok) {
        return r.text().then(function(t) {
          console.error('[solAPI] createDSMAttempt failed:', r.status, t.slice(0, 200));
          throw new Error('HTTP ' + r.status);
        });
      }
      return r.json();
    });
  }

  // Update a DSM attempt (on completion or quit). RLS USING +
  // WITH CHECK both require auth_user_id = auth.uid(). The row was
  // created with the caller's auth_user_id by createDSMAttempt, so
  // the UPDATE check passes naturally for the row owner. Still
  // include auth_user_id in the body for defense-in-depth in case
  // someone passes a partial body that omits it.
  function updateDSMAttempt(attemptId, data) {
    return _rest('PATCH', 'dsm_attempts', {
      query: 'id=eq.' + attemptId,
      body: data,
      prefer: 'return=representation'
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    }).catch(function(err) {
      console.warn('[solAPI] DSM attempt update failed:', err.message);
    });
  }

  // ── SSO (Google Workspace) ─────────────────────────────────
  // Dormant until window.PORTAL_AUTH_MODE opts in. Lazy-loads
  // supabase-js so legacy SOL pages don't pay the load cost.

  function _loadSupabaseLib() {
    if (window.supabase) return Promise.resolve(window.supabase);
    if (_sbLibPromise) return _sbLibPromise;
    _sbLibPromise = new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = SB_LIB_URL;
      s.integrity = SB_LIB_SRI;
      s.crossOrigin = 'anonymous';
      s.onload = function() { resolve(window.supabase); };
      s.onerror = function() { reject(new Error('Failed to load Supabase JS')); };
      document.head.appendChild(s);
    });
    return _sbLibPromise;
  }

  function _getClient() {
    if (_sbClient) return Promise.resolve(_sbClient);
    return _loadSupabaseLib().then(function() {
      _sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      return _sbClient;
    });
  }

  function _hydrateStudentFromSession() {
    if (!_session || !_session.user) return Promise.resolve(null);
    var user = _session.user;
    var email = user.email || '';
    var meta = user.user_metadata || {};
    var name = meta.full_name || meta.name || (email ? email.split('@')[0] : 'Student');

    return _rest('GET', 'students', {
      query: 'auth_user_id=eq.' + encodeURIComponent(user.id) + '&select=id,email,display_name'
    })
    .then(function(r) { return r.json(); })
    .then(function(rows) {
      if (rows && rows.length > 0) {
        _studentId = rows[0].id;
        _studentEmail = rows[0].email;
        _studentDisplayName = rows[0].display_name;
        return rows[0];
      }
      return _rest('POST', 'students', {
        body: { auth_user_id: user.id, email: email, display_name: name },
        prefer: 'return=representation'
      })
      .then(function(r) { return r.json(); })
      .then(function(created) {
        var row = (created && created[0]) || created;
        if (row && row.id) {
          _studentId = row.id;
          _studentEmail = row.email;
          _studentDisplayName = row.display_name;
        }
        return row;
      });
    });
  }

  function initAuth() {
    return _getClient().then(function(client) {
      return client.auth.getSession();
    }).then(function(result) {
      var session = result && result.data && result.data.session;
      if (!session) return null;
      _session = session;
      return _hydrateStudentFromSession();
    }).catch(function() { return null; });
  }

  function signInWithGoogle(redirectTo) {
    return _getClient().then(function(client) {
      return client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectTo || window.location.href,
          queryParams: { hd: 'bcpsk12.com' }
        }
      });
    });
  }

  function signOut() {
    return _getClient().then(function(client) {
      return client.auth.signOut();
    }).then(function() {
      _session = null;
      _studentId = null;
      _studentEmail = '';
      _studentDisplayName = '';
    });
  }

  function enrollInClass(classId) {
    if (!_studentId || !classId) return Promise.resolve(null);
    return _rest('POST', 'student_classes', {
      body: { student_id: _studentId, class_id: classId },
      prefer: 'resolution=ignore-duplicates,return=representation'
    });
  }

  // ── PUBLIC API ───────────────────────────────────────────────
  return {
    validateCode: validateCode,
    submit: submit,
    beacon: beacon,
    getStored: getStored,
    storeClass: storeClass,
    clearClass: clearClass,
    getClassId: function() { return _classId; },
    getClassCode: function() { return _classCode; },
    getClassName: function() { return _className; },
    getTeacherName: function() { return _teacherName; },
    getExamDate: function() { return _examDate ? new Date(_examDate + 'T00:00:00') : null; },
    getDSMQuestions: getDSMQuestions,
    createDSMAttempt: createDSMAttempt,
    updateDSMAttempt: updateDSMAttempt,
    // SSO surface (no-ops in legacy mode)
    initAuth: initAuth,
    signInWithGoogle: signInWithGoogle,
    signOut: signOut,
    enrollInClass: enrollInClass,
    isAuthenticated: function() { return !!_session; },
    getStudentId: function() { return _studentId; },
    getStudentEmail: function() { return _studentEmail; },
    getStudentDisplayName: function() { return _studentDisplayName; },
    // Offline buffer (failed _postWithRetry writes)
    drainBuffer: _drainBuffer,
    getPendingWrites: function() { return _readBuffer().length; },
    // Cross-device progress sync
    saveProgress: saveProgress,
    getProgress: getProgress,
    clearProgress: clearProgress,
    flushProgress: flushProgress,
    pingProgress: pingProgress,
    canonicalizeName: canonicalizeName,
    isModuleUnlocked: isModuleUnlocked,
    runModuleReleaseGate: runModuleReleaseGate,
    // Practice-test retake policy
    getAllowRetakes: function() { return _allowRetakes; },
    getMasteryThreshold: function() { return _masteryThreshold; },
    hasPriorPracticeScore: hasPriorPracticeScore,
    getAssignment: getAssignment,
    submitOneAnswer: submitOneAnswer,
    hasPriorScore: hasPriorScore,
    lookupScoreStrict: lookupScoreStrict
  };

})();
