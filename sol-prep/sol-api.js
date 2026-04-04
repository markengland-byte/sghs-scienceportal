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

  // ── INTERNAL STATE ──
  var _classId = null;
  var _classCode = '';
  var _className = '';
  var _teacherName = '';

  // ── SUPABASE REST HELPER ──
  function _rest(method, table, opts) {
    opts = opts || {};
    var url = SUPABASE_URL + '/rest/v1/' + table;
    if (opts.query) url += '?' + opts.query;

    var headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    };
    if (opts.prefer) headers['Prefer'] = opts.prefer;

    var fetchOpts = { method: method, headers: headers };
    if (opts.body) fetchOpts.body = JSON.stringify(opts.body);
    if (opts.keepalive) fetchOpts.keepalive = true;

    return fetch(url, fetchOpts);
  }

  // ── VALIDATE CLASS CODE ──────────────────────────────────────
  // Returns a promise: { valid: true, teacher, label } or { valid: false }
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
      _rest('POST', 'scores', {
        body: {
          class_id: _classId,
          student_name: student,
          module: module,
          lesson: payload.lesson || '',
          score: payload.score,
          total: payload.total,
          pct: payload.pct,
          time_on_quiz: payload.timeOnQuiz || null,
          assignment_id: payload.assignmentId || null
        },
        prefer: 'return=minimal'
      }).catch(function(){});
    }
    else if (action === 'quizDetail') {
      var questions = payload.questions || [];
      var rows = questions.map(function(q) {
        return {
          class_id: _classId,
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
        _rest('POST', 'quiz_detail', {
          body: rows,
          prefer: 'return=minimal'
        }).catch(function(){});
      }
    }
    else if (action === 'checkpoint') {
      _rest('POST', 'checkpoints', {
        body: {
          class_id: _classId,
          student_name: student,
          module: module,
          lesson: payload.lesson || '',
          response_text: payload.response || payload.responseText || payload.text || '',
          score: payload.score || null
        },
        prefer: 'return=minimal'
      }).catch(function(){});
    }
    else if (action === 'activity') {
      // Collect extra fields into metadata
      var meta = {};
      var skip = { action:1, student:1, module:1, lesson:1, event:1, duration:1, classPeriod:1 };
      Object.keys(payload).forEach(function(k) {
        if (!skip[k]) meta[k] = payload[k];
      });

      _rest('POST', 'activity', {
        body: {
          class_id: _classId,
          student_name: student,
          module: module,
          lesson: payload.lesson || '',
          event: payload.event || 'unknown',
          duration: payload.duration || null,
          metadata: Object.keys(meta).length > 0 ? meta : null
        },
        prefer: 'return=minimal'
      }).catch(function(){});
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

    _rest('POST', 'activity', {
      body: {
        class_id: _classId,
        student_name: payload.student || '',
        module: payload.module || '',
        lesson: payload.lesson || '',
        event: payload.event || 'session_end',
        duration: payload.duration || null,
        metadata: Object.keys(meta).length > 0 ? meta : null
      },
      prefer: 'return=minimal',
      keepalive: true
    }).catch(function(){});
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
      teacher: _teacherName
    }));
  }

  function clearClass() {
    _classId = null;
    _classCode = '';
    _className = '';
    _teacherName = '';
    localStorage.removeItem('sol_class');
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
    getTeacherName: function() { return _teacherName; }
  };

})();
