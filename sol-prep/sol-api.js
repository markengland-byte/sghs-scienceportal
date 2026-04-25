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

  // ── ERROR-AWARE WRITE HELPERS ──
  // _postWithRetry: critical student writes (score, quiz_detail, checkpoint).
  //   Validates HTTP status, retries once after 2s, surfaces toast via
  //   window.showToast on permanent failure, logs every step.
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
          if (typeof window.showToast === 'function') {
            window.showToast('\u26A0 Could not save ' + label + ' \u2014 please tell your teacher');
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
      query: 'code=eq.' + encodeURIComponent(code) + '&is_active=eq.true&select=id,code,label,teacher_name,exam_date'
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
      return { valid: true, teacher: c.teacher_name, label: c.label, examDate: c.exam_date };
    })
    .catch(function() {
      return { valid: false };
    });
  }

  // ── SUBMIT DATA ──────────────────────────────────────────────
  // Drop-in replacement for the old send() logic.
  // Receives the full payload with: student, module, action, lesson, etc.
  // Routes to the correct Supabase table based on action.
  function submit(payload) {
    if (!_classId) return;

    var action = payload.action;
    var student = payload.student;
    var module = payload.module;

    if (action === 'score') {
      _postWithRetry('scores', {
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
        _postWithRetry('quiz_detail', rows, 'quiz answers');
      }
    }
    else if (action === 'checkpoint') {
      _postWithRetry('checkpoints', {
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
      _postBestEffort('activity', {
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
      examDate: _examDate
    }));
  }

  function clearClass() {
    _classId = null;
    _classCode = '';
    _className = '';
    _teacherName = '';
    _examDate = null;
    localStorage.removeItem('sol_class');
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
    getStudentDisplayName: function() { return _studentDisplayName; }
  };

})();
