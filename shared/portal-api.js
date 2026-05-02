/* ================================================================
   Portal API — Shared Supabase Backend for AP, Biology & Physics
   Forked from sol-api.js. Uses the same Supabase project and tables
   but a separate localStorage key (portal_class) to avoid collision
   with SOL Prep modules that use sol_class.

   Usage: portalAPI.validateCode('ENG-3B').then(...)
          portalAPI.submit({ action:'score', student:'...', ... })
   ================================================================ */

var portalAPI = (function() {

  // Single source of truth lives in shared/supabase-config.js (loaded
  // from login.html / dashboard.html). Hardcoded fallback for HTML
  // pages that haven't yet been updated to load supabase-config.js.
  // Rotation: change supabase-config.js AND these two fallbacks +
  // sol-prep/sol-api.js.
  var SUPABASE_URL = (typeof window !== 'undefined' && window.SUPABASE_URL)
    || 'https://cogpsieldrgeqlemhosy.supabase.co';
  var SUPABASE_ANON_KEY = (typeof window !== 'undefined' && window.SUPABASE_ANON_KEY)
    || 'sb_publishable_Wn4L2S2gMPq2cLoiLt2tIQ_z4e7IUZU';

  // Lazy-loaded Supabase JS client (only when SSO is invoked).
  var SB_LIB_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.103.0';
  var SB_LIB_SRI = 'sha384-PsnFqJ58vyp7buRfuvdS2SrjRdUYinBv6lWwJXx3xQ17hWefo/UkwXowVBT53ubG';
  var _sbClient = null;
  var _sbLibPromise = null;

  var _classId = null;
  var _classCode = '';
  var _className = '';
  var _teacherName = '';

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
  // _postWithRetry: for time-sensitive student writes (score, quiz_detail,
  //   checkpoint). Validates HTTP status, retries once after 2s on failure,
  //   logs to console at every step, and surfaces a toast to the student
  //   via window.showToast when both attempts fail. Returns a promise that
  //   resolves on success and rejects on permanent failure.
  // _postBestEffort: for high-frequency non-critical writes (activity logs,
  //   beacon). Validates HTTP status and logs warnings but does not retry
  //   or notify the student. Always resolves (errors are swallowed after
  //   logging) so it never blocks downstream code.
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
      console.warn('[portalAPI] ' + label + ' first attempt failed:', err1.message);
      return new Promise(function(resolve) { setTimeout(resolve, 2000); })
        .then(attempt)
        .then(function(r) {
          console.log('[portalAPI] ' + label + ' retry succeeded');
          return r;
        })
        .catch(function(err2) {
          console.error('[portalAPI] ' + label + ' FAILED after retry:', err2.message);
          if (typeof window.showToast === 'function') {
            window.showToast('\u26A0 Could not save ' + label + ' \u2014 please tell your teacher');
          }
          // Audit #12: return a sentinel so callers can differentiate
          // buffered-saved from live-saved. UI used to lie 'Save failed -
          // retry?' for buffered writes; data was safe but message wrong.
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
        console.warn('[portalAPI] ' + label + ' failed (non-critical):', err.message);
      });
  }

  // ── VALIDATE CLASS CODE ──
  function validateCode(code) {
    code = code.trim().toUpperCase();
    return _rest('GET', 'classes', {
      query: 'code=eq.' + encodeURIComponent(code) + '&is_active=eq.true&select=id,code,label,teacher_name'
    })
    .then(function(r) { return r.json(); })
    .then(function(rows) {
      if (!rows || rows.length === 0) return { valid: false };
      var c = rows[0];
      _classId = c.id;
      _classCode = c.code;
      _className = c.label;
      _teacherName = c.teacher_name;
      return { valid: true, teacher: c.teacher_name, label: c.label };
    })
    .catch(function() { return { valid: false }; });
  }

  // ── SUBMIT DATA ──
  // Returns a Promise so callers (e.g. portal-quiz.js) can show a
  // confirmation toast only after the network round-trip succeeds.
  // The Promise resolves with the response on success or with `undefined`
  // on permanent failure (after retry). Callers should test the resolved
  // value before showing positive confirmation.
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
        time_on_quiz: payload.timeOnQuiz || null
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
          is_correct: !!q.isCorrect
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
      var meta = {};
      var skip = { action:1, student:1, module:1, lesson:1, event:1, duration:1 };
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

  // ── BEACON (page unload — keepalive fetch) ──
  function beacon(payload) {
    if (!_classId) return;

    var meta = {};
    var skip = { action:1, student:1, module:1, lesson:1, event:1, duration:1 };
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

  // ── LOCAL STORAGE (class info persists across modules) ──
  function getStored() {
    try {
      var data = JSON.parse(localStorage.getItem('portal_class') || 'null');
      if (data && data.classId) {
        _classId = data.classId;
        _classCode = data.code;
        _className = data.label;
        _teacherName = data.teacher;
        return data;
      }
    } catch(e) {}
    return null;
  }

  function storeClass() {
    localStorage.setItem('portal_class', JSON.stringify({
      classId: _classId,
      code: _classCode,
      label: _className,
      teacher: _teacherName
    }));
  }

  function clearClass() {
    _classId = null;
    _classCode = '';
    _className = '';
    _teacherName = '';
    localStorage.removeItem('portal_class');
  }

  // ── SSO (Google Workspace) ─────────────────────────────────
  // These functions are dormant until AUTH_MODE === 'sso' or 'both'
  // is set on the consuming page. They lazy-load supabase-js so the
  // legacy modules don't pay the load cost when SSO is unused.

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

  // Restores the in-memory student record after a Google sign-in
  // (or on page load if a session already exists). Auto-creates
  // a row in `students` on first sign-in.
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

  // Initialize SSO state on a page that opts in. Returns the
  // current student record, or null if no session.
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

  // Begin Google OAuth. Browser will redirect to Google, then back
  // to `redirectTo` (defaults to current URL). Caller should call
  // initAuth() on page load to pick up the resulting session.
  function signInWithGoogle(redirectTo) {
    return _getClient().then(function(client) {
      return client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectTo || window.location.href,
          // Hints Google to default to school accounts. Real domain
          // restriction is enforced in Supabase provider config.
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

  // Add the current student to a class enrollment. Idempotent —
  // duplicate (student_id, class_id) is silently ignored thanks to
  // the UNIQUE constraint and resolution=ignore-duplicates.
  function enrollInClass(classId) {
    if (!_studentId || !classId) return Promise.resolve(null);
    return _rest('POST', 'student_classes', {
      body: { student_id: _studentId, class_id: classId },
      prefer: 'resolution=ignore-duplicates,return=representation'
    });
  }

  // Auto-load stored class on script init
  getStored();

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
    // SSO surface (no-ops in legacy mode — only invoked when AUTH_MODE opts in)
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
