/* ================================================================
   SOL API — Shared Supabase Backend for SOL Prep
   Replaces Google Apps Script with Supabase PostgreSQL.

   SETUP: After creating your Supabase project, update the two
   config values below (URL and anon key). That's it.
   ================================================================ */

var solAPI = (function() {

  // ── CONFIG — update these after creating your Supabase project ──
  var SUPABASE_URL = 'https://cogpsieldrgeqlemhosy.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_Wn4L2S2gMPq2cLoiLt2tIQ_z4e7IUZU';

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

  // SSO session state (null when student is using legacy name-modal flow).
  var _session = null;
  var _studentId = null;
  var _studentEmail = '';
  var _studentDisplayName = '';

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
      return _rest('POST', r.table, { body: r.body, prefer: 'return=minimal' })
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
    function attempt() {
      return _rest('POST', table, { body: body, prefer: 'return=minimal' })
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
          // Error already surfaced — swallow to avoid unhandled-rejection warning.
        });
    });
  }

  function _postBestEffort(table, body, label, opts) {
    var fetchOpts = { body: body, prefer: 'return=minimal' };
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
      query: 'code=eq.' + encodeURIComponent(code) + '&is_active=eq.true&select=id,code,label,teacher_name,exam_date,allow_retakes'
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
      return { valid: true, teacher: c.teacher_name, label: c.label, examDate: c.exam_date, allowRetakes: _allowRetakes };
    })
    .catch(function() {
      return { valid: false };
    });
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

    if (action === 'score') {
      return _postWithRetry('scores', {
        class_id: _classId,
        student_id: _studentId,
        student_name: student,
        module: module,
        lesson: payload.lesson || '',
        score: payload.score,
        total: payload.total,
        pct: payload.pct,
        time_on_quiz: payload.timeOnQuiz || null,
        assignment_id: payload.assignmentId || null
      }, 'score');
    }
    else if (action === 'quizDetail') {
      var questions = payload.questions || [];
      var rows = questions.map(function(q) {
        return {
          class_id: _classId,
          student_id: _studentId,
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
    var body = {
      class_id: _classId,
      student_name: studentName,
      module: module,
      progress_data: progressData
    };
    // UPSERT on (class_id, student_name, module) unique constraint
    return _rest('POST', 'quiz_progress', {
      query: 'on_conflict=class_id,student_name,module',
      body: body,
      prefer: 'resolution=merge-duplicates,return=minimal',
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
    return _rest('DELETE', 'quiz_progress', { query: q, prefer: 'return=minimal' })
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
      allowRetakes: _allowRetakes
    }));
  }

  function clearClass() {
    _classId = null;
    _classCode = '';
    _className = '';
    _teacherName = '';
    _examDate = null;
    _allowRetakes = true;
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

  // ── DSM (Dynamic Study Modules) ───────────────────────────────
  // Fetch published DSM questions for a given standard
  function getDSMQuestions(standard) {
    return _rest('GET', 'dsm_modules', {
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
  }

  // Create a DSM attempt record
  function createDSMAttempt(data) {
    return _rest('POST', 'dsm_attempts', {
      body: {
        class_id: _classId,
        student_id: _studentId,
        student_name: data.studentName,
        module_id: data.moduleId,
        unit_number: data.unitNumber,
        total_questions: data.totalQuestions,
        rounds_completed: 0,
        questions_missed: [],
        completed: false
      },
      prefer: 'return=representation'
    }).then(function(r) { return r.json(); });
  }

  // Update a DSM attempt (on completion or quit)
  function updateDSMAttempt(attemptId, data) {
    return _rest('PATCH', 'dsm_attempts', {
      query: 'id=eq.' + attemptId,
      body: data,
      prefer: 'return=minimal'
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
      prefer: 'resolution=ignore-duplicates,return=minimal'
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
    // Practice-test retake policy
    getAllowRetakes: function() { return _allowRetakes; },
    hasPriorPracticeScore: hasPriorPracticeScore,
    hasPriorScore: hasPriorScore
  };

})();
