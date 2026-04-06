/* ══════════════════════════════════════════════════════════════
   SGHS Science Portal — Shared Quiz, Navigation & Tracking JS
   v3.0 — Supabase + class codes + progress persistence

   USAGE: Each module sets window.MODULE_CONFIG before loading:
   window.MODULE_CONFIG = {
     name: 'Module Name',
     appsScriptUrl: 'https://script.google.com/...',  // legacy fallback
     panelCount: N,
     lessonCount: N-1,
     cpMin: 100,
     lessons: ['Overview','L1: Title',...]
   };
   ══════════════════════════════════════════════════════════════ */

/* ── Auto-load portal-api.js if not already present ── */
(function() {
  if (window.portalAPI) return;
  var me = document.currentScript;
  var base = me ? me.src.replace(/[^/]*$/, '') : '../shared/';
  var s = document.createElement('script');
  s.src = base + 'portal-api.js';
  document.head.appendChild(s);
})();

(function() {
  'use strict';

  var CFG = window.MODULE_CONFIG || {};
  var API = CFG.appsScriptUrl || '';
  var CP_MIN = CFG.cpMin || 100;

  var studentName = '';
  var completedLessons = new Set();
  var currentPanel = 0;
  var panelEnterTime = null;
  var moduleStartTime = null;
  var quizStartTimes = {};
  var quizDetails = {};
  var answeredCount = {};
  var answeredCorrect = {};
  var totalQuestions = {};

  /* ══════════════════════════════════════
     LOCAL PROGRESS PERSISTENCE
     ══════════════════════════════════════ */
  var STORE_KEY = 'sghs_' + (CFG.name || 'module').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

  function saveProgress() {
    if (!studentName) return;
    try {
      var data = {
        studentName: studentName,
        currentPanel: currentPanel,
        completedLessons: Array.from(completedLessons),
        timestamp: Date.now()
      };
      var cpTexts = {};
      document.querySelectorAll('.cp-textarea').forEach(function(ta) {
        if (ta.value.trim().length > 0) {
          var id = ta.id || (ta.closest('.checkpoint-box, .checkpoint') || {}).id || '';
          if (id) cpTexts[id] = ta.value;
        }
      });
      if (Object.keys(cpTexts).length > 0) data.checkpoints = cpTexts;
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch(e) {}
  }

  function loadProgress() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (data.timestamp && (Date.now() - data.timestamp) > 30 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(STORE_KEY);
        return null;
      }
      return data;
    } catch(e) { return null; }
  }

  function restoreProgress(data) {
    if (data.completedLessons) {
      data.completedLessons.forEach(function(n) {
        completedLessons.add(n);
        var links = document.querySelectorAll('.sb-link');
        if (links[n]) links[n].classList.add('done');
      });
    }
    if (data.checkpoints) {
      Object.keys(data.checkpoints).forEach(function(id) {
        var ta = document.getElementById(id);
        if (ta) {
          ta.value = data.checkpoints[id];
          var panelId = id.replace(/\D/g, '');
          if (panelId && window.cpCheck) window.cpCheck(parseInt(panelId));
        }
      });
    }
    updateProgress();
    if (data.currentPanel > 0) {
      window.goTo(data.currentPanel);
    }
  }

  function clearProgress() {
    try { localStorage.removeItem(STORE_KEY); } catch(e) {}
  }

  /* ══════════════════════════════════════
     SEND DATA — Supabase primary, Google Sheets fallback
     ══════════════════════════════════════ */
  function send(payload) {
    if (!studentName) return;
    payload.student = studentName;
    payload.module = CFG.name || 'Unknown';

    // Primary: Supabase via portalAPI
    if (window.portalAPI && portalAPI.getClassId()) {
      portalAPI.submit(payload);
    }

    // Fallback: Google Sheets (kept during transition)
    if (API) {
      try {
        fetch(API, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(function() {});
      } catch(e) {}
    }
  }

  /* ══════════════════════════════════════
     CLASS CODE — Inject field into name modal
     ══════════════════════════════════════ */
  function injectClassCode() {
    var nameInput = document.getElementById('student-name');
    if (!nameInput || document.getElementById('class-code')) return;

    var insertAfter = document.getElementById('name-err') || nameInput;
    var container = insertAfter.parentElement;

    // Build class code elements
    var wrapper = document.createElement('div');
    wrapper.id = 'class-code-wrap';
    wrapper.style.cssText = 'margin-top:16px;';
    wrapper.innerHTML =
      '<label style="font-size:.8rem;font-weight:700;color:#0f2240;letter-spacing:.5px;display:block;margin-bottom:6px;">CLASS CODE</label>' +
      '<input id="class-code" type="text" placeholder="e.g. ENG-3B" autocomplete="off" style="width:100%;padding:12px 16px;border:2px solid #dde3ef;border-radius:10px;font-size:1rem;font-family:\'Source Sans 3\',sans-serif;outline:none;transition:border .2s;text-transform:uppercase;">' +
      '<div id="class-info" style="display:none;font-size:.82rem;color:#0d9488;margin-top:6px;padding:4px 0;font-weight:600;"></div>' +
      '<div id="code-err" style="color:#c0392b;font-size:.8rem;margin-top:6px;display:none;">Invalid class code. Please check with your teacher.</div>';

    // Insert after name-err
    if (insertAfter.nextSibling) {
      container.insertBefore(wrapper, insertAfter.nextSibling);
    } else {
      container.appendChild(wrapper);
    }

    // Add helper links at bottom of modal
    var startBtn = container.querySelector('button[onclick*="startModule"]');
    if (startBtn) {
      var helpers = document.createElement('div');
      helpers.style.cssText = 'margin-top:10px;text-align:center;';
      helpers.innerHTML =
        '<a href="#" id="clear-progress-link" style="font-size:.75rem;color:#5e6e8a;text-decoration:underline;" onclick="event.preventDefault();localStorage.removeItem(\'' + STORE_KEY + '\');if(window.portalAPI)portalAPI.clearClass();location.reload();">Start fresh (clear saved progress)</a>' +
        '<br><a href="#" id="change-class-link" style="font-size:.72rem;color:#5e6e8a;text-decoration:underline;margin-top:4px;display:inline-block;" onclick="event.preventDefault();if(window.portalAPI)portalAPI.clearClass();var ci=document.getElementById(\'class-code\');if(ci){ci.value=\'\';ci.focus();}document.getElementById(\'class-info\').style.display=\'none\';">Change class code</a>';
      startBtn.parentNode.insertBefore(helpers, startBtn.nextSibling);
    }

    // Pre-fill from stored class
    if (window.portalAPI) {
      var stored = portalAPI.getStored();
      if (stored) {
        var codeInput = document.getElementById('class-code');
        codeInput.value = stored.code || '';
        var info = document.getElementById('class-info');
        if (stored.teacher && stored.label) {
          info.textContent = '✓ ' + stored.label + ' — ' + stored.teacher;
          info.style.display = 'block';
        }
      }
    }

    // Live validation on blur
    var codeInput = document.getElementById('class-code');
    codeInput.addEventListener('blur', function() {
      var code = codeInput.value.trim();
      if (!code || !window.portalAPI) return;
      var info = document.getElementById('class-info');
      var err = document.getElementById('code-err');
      info.style.display = 'none';
      err.style.display = 'none';
      portalAPI.validateCode(code).then(function(result) {
        if (result.valid) {
          portalAPI.storeClass();
          info.textContent = '✓ ' + result.label + ' — ' + result.teacher;
          info.style.display = 'block';
          codeInput.style.borderColor = '#0d9488';
        } else {
          err.style.display = 'block';
          codeInput.style.borderColor = '#c0392b';
        }
      });
    });

    // Also validate on Enter
    codeInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        codeInput.blur(); // triggers validation
      }
    });
  }

  /* ══════════════════════════════════════
     NAME MODAL — Start / Resume
     ══════════════════════════════════════ */
  window.startModule = function() {
    var input = document.getElementById('student-name');
    if (!input) return;
    var v = input.value.trim();
    var parts = v.split(/\s+/);
    if (parts.length < 2 || parts[0].length < 1) {
      var err = document.getElementById('name-err');
      if (err) err.style.display = 'block';
      input.style.borderColor = '#c0392b';
      return;
    }

    // Validate class code if present
    var codeInput = document.getElementById('class-code');
    var codeErr = document.getElementById('code-err');
    if (codeInput) {
      var code = codeInput.value.trim();
      if (code && window.portalAPI && !portalAPI.getClassId()) {
        // Need to validate first
        if (codeErr) codeErr.style.display = 'none';
        portalAPI.validateCode(code).then(function(result) {
          if (result.valid) {
            portalAPI.storeClass();
            proceedStart(v);
          } else {
            if (codeErr) codeErr.style.display = 'block';
            codeInput.style.borderColor = '#c0392b';
          }
        });
        return;
      }
    }

    proceedStart(v);
  };

  function proceedStart(name) {
    studentName = name;
    moduleStartTime = Date.now();
    var modal = document.getElementById('name-modal');
    if (modal) modal.style.display = 'none';
    var badge = document.getElementById('student-badge') || document.querySelector('.tb-badge');
    if (badge) badge.textContent = studentName;

    // Check for saved progress
    var saved = loadProgress();
    if (saved && saved.studentName === studentName && saved.currentPanel > 0) {
      restoreProgress(saved);
      send({ action: 'activity', lesson: 'Overview', event: 'module_resume', duration: '' });
    } else {
      if (saved && saved.studentName !== studentName) clearProgress();
      send({ action: 'activity', lesson: 'Overview', event: 'module_start', duration: '' });
    }
    panelEnterTime = Date.now();
  }

  document.addEventListener('DOMContentLoaded', function() {
    var input = document.getElementById('student-name');
    if (input) {
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') window.startModule();
      });

      // Inject class code field into modal
      injectClassCode();

      // Check for saved progress — show "Welcome Back!" prompt
      var saved = loadProgress();
      if (saved && saved.studentName) {
        input.value = saved.studentName;
        // Try both inline-style and class-based modals
        var title = document.querySelector('.nm-title') || document.querySelector('#name-modal h2');
        if (title) title.textContent = 'Welcome Back!';
        var sub = document.querySelector('.nm-sub') || document.querySelector('#name-modal p');
        if (sub) sub.textContent = 'Your progress has been saved. Click Resume to pick up where you left off, or enter a different name to start fresh.';
        var btn = document.querySelector('.nm-btn') || document.querySelector('#name-modal button[onclick*="startModule"]');
        if (btn) btn.textContent = 'Resume \u2192';
      }
    }
  });

  /* ══════════════════════════════════════
     NAVIGATION WITH TIME TRACKING
     ══════════════════════════════════════ */
  window.goTo = function(n) {
    if (panelEnterTime && studentName) {
      var duration = Math.round((Date.now() - panelEnterTime) / 1000);
      var lessons = CFG.lessons || [];
      var prevLabel = lessons[currentPanel] || ('Panel ' + currentPanel);
      if (duration > 2) {
        send({ action: 'activity', lesson: prevLabel, event: 'page_view', duration: duration });
      }
    }

    document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
    var target = document.getElementById('p' + n);
    if (target) target.classList.add('active');

    document.querySelectorAll('.sb-link').forEach(function(l, i) { l.classList.toggle('active', i === n); });

    window.scrollTo({ top: 0, behavior: 'smooth' });

    currentPanel = n;
    panelEnterTime = Date.now();
    updateProgress();
    saveProgress();

    if (studentName) {
      var lessons = CFG.lessons || [];
      var label = lessons[n] || ('Panel ' + n);
      send({ action: 'activity', lesson: label, event: 'lesson_enter', duration: '' });
    }
  };

  /* ══════════════════════════════════════
     PROGRESS BAR
     ══════════════════════════════════════ */
  function updateProgress() {
    var total = CFG.lessonCount || CFG.panelCount || 1;
    var pct = Math.round((completedLessons.size / total) * 100);
    var bar = document.getElementById('prog-bar');
    if (bar) bar.style.width = pct + '%';
  }

  /* ══════════════════════════════════════
     CHECKPOINT
     ══════════════════════════════════════ */
  window.cpCheck = function(id) {
    var cp = document.getElementById('cp' + id);
    var ta = null;
    if (cp) ta = cp.querySelector('.cp-textarea') || cp.querySelector('textarea');
    if (!ta) ta = document.getElementById('cpt' + id);
    if (!ta) return;

    var len = ta.value.trim().length;

    var fill = document.getElementById('cpFill' + id);
    if (fill) {
      var pct = Math.min(100, Math.round((len / CP_MIN) * 100));
      fill.style.width = pct + '%';
      fill.style.background = len >= CP_MIN ? '#0d9488' : '#3b82f6';
    }

    var count = document.getElementById('cpCount' + id);
    if (count) {
      count.textContent = len + ' / ' + CP_MIN + ' characters';
      count.style.color = len >= CP_MIN ? '#0d9488' : '';
    }

    var counterSpan = document.getElementById('cpn' + id);
    if (counterSpan) counterSpan.textContent = len;
    var counter = document.getElementById('cpc' + id);
    if (counter) {
      if (len >= CP_MIN) { counter.classList.add('met'); counter.classList.add('ok'); }
      else { counter.classList.remove('met'); counter.classList.remove('ok'); }
    }

    var btn = document.getElementById('cpb' + id);
    if (btn) {
      if (len >= CP_MIN) { btn.classList.add('ready'); btn.disabled = false; }
      else { btn.classList.remove('ready'); btn.disabled = true; }
    }

    if (len >= CP_MIN) {
      var quiz = document.getElementById('quiz' + id);
      if (quiz && quiz.classList.contains('locked')) {
        quiz.classList.remove('locked');
        var lockMsg = quiz.querySelector('.quiz-lock-msg');
        if (lockMsg) lockMsg.style.display = 'none';

        var lessons = CFG.lessons || [];
        var label = lessons[id] || ('Lesson ' + id);
        send({
          action: 'checkpoint',
          lesson: label,
          responseText: ta.value.trim(),
          charCount: len
        });

        quizStartTimes[id] = Date.now();
        showToast('Checkpoint complete \u2014 quiz unlocked!');
      }
    }
  };

  window.cpUnlock = function(id) {
    var ql = document.getElementById('ql' + id);
    var qi = document.getElementById('qi' + id);
    var cpd = document.getElementById('cpd' + id);

    if (qi) {
      if (ql) ql.style.display = 'none';
      qi.style.display = 'block';
      if (cpd) cpd.classList.add('show');
      var btn = document.getElementById('cpb' + id);
      if (btn) { btn.disabled = true; btn.textContent = 'Quiz Unlocked \u2713'; }
      qi.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    var ta = document.getElementById('cpt' + id);
    if (ta) {
      var lessons = CFG.lessons || [];
      var label = lessons[id] || ('Lesson ' + id);
      send({
        action: 'checkpoint',
        lesson: label,
        responseText: ta.value.trim(),
        charCount: ta.value.trim().length
      });
    }

    quizStartTimes[id] = Date.now();
  };

  /* ══════════════════════════════════════
     QUIZ — pick() handles both old and new formats
     ══════════════════════════════════════ */
  window.pick = function(panelOrEl, qNum, btnEl, flag) {
    if (typeof panelOrEl === 'object') {
      pickOld(panelOrEl);
      return;
    }

    var pid = panelOrEl;
    var isCorrect = (flag === 'a');
    var qq = btnEl.closest('.qq');
    if (!qq) return;
    if (qq.dataset.locked === 'true') return;
    qq.dataset.locked = 'true';

    var stemEl = qq.querySelector('.q-stem');
    var questionText = stemEl ? stemEl.textContent.trim() : 'Q' + qNum;
    var studentAnswer = btnEl.textContent.trim();

    var correctAnswer = '';
    var allBtns = qq.querySelectorAll('.cbtn');
    allBtns.forEach(function(b) {
      var bFlag = b.getAttribute('onclick') || '';
      var match = bFlag.match(/pick\(\d+,\d+,this,'(a|b)'\)/);
      if (match && match[1] === 'a') correctAnswer = b.textContent.trim();
    });

    btnEl.classList.add(isCorrect ? 'correct' : 'incorrect');
    btnEl.classList.add('picked');

    allBtns.forEach(function(b) {
      b.disabled = true;
      b.classList.add('revealed');
      var bFlag = b.getAttribute('onclick') || '';
      if (bFlag.indexOf("'a'") !== -1) b.classList.add('correct');
    });

    var fb = qq.querySelector('.q-fb');
    if (fb) {
      fb.style.display = 'block';
      fb.textContent = isCorrect ? '\u2713 Correct!' : '\u2717 Incorrect \u2014 the correct answer is highlighted above.';
      fb.style.color = isCorrect ? '#0d9488' : '#ef4444';
      fb.style.fontWeight = '600';
      fb.style.marginTop = '8px';
    }

    if (!quizDetails[pid]) quizDetails[pid] = [];
    quizDetails[pid].push({ qNum: qNum, questionText: questionText, studentAnswer: studentAnswer, correctAnswer: correctAnswer, isCorrect: isCorrect });

    if (!answeredCount[pid]) answeredCount[pid] = 0;
    if (!answeredCorrect[pid]) answeredCorrect[pid] = 0;
    answeredCount[pid]++;
    if (isCorrect) answeredCorrect[pid]++;

    var panel = document.getElementById('p' + pid);
    if (panel && !totalQuestions[pid]) {
      var quizWrap = document.getElementById('quiz' + pid);
      totalQuestions[pid] = (quizWrap || panel).querySelectorAll('.qq').length;
    }

    if (answeredCount[pid] >= totalQuestions[pid]) finishQuiz(pid);
  };

  function pickOld(el) {
    var qq = el.closest('.qq');
    if (!qq || qq.dataset.locked === 'true') return;
    qq.dataset.locked = 'true';

    var ans = qq.dataset.ans;
    var chosen = el.dataset.v;

    el.classList.add(chosen === ans ? 'correct' : 'incorrect');
    el.classList.add('revealed');

    qq.querySelectorAll('.qo').forEach(function(o) {
      o.classList.add('revealed');
      if (o.dataset.v === ans) o.classList.add('correct');
    });

    var exp = qq.querySelector('.qexp');
    if (exp) { exp.classList.add('show'); exp.style.display = 'block'; }

    var panel = qq.closest('.panel');
    if (!panel) return;
    var pid = parseInt(panel.id.replace(/\D/g, ''));

    var stemEl = qq.querySelector('.qt') || qq.querySelector('.q-stem');
    var questionText = stemEl ? stemEl.textContent.trim() : '';
    var studentAnswer = el.textContent.trim();
    var correctAnswer = '';
    qq.querySelectorAll('.qo').forEach(function(o) {
      if (o.dataset.v === ans) correctAnswer = o.textContent.trim();
    });

    if (!quizDetails[pid]) quizDetails[pid] = [];
    quizDetails[pid].push({ qNum: quizDetails[pid].length + 1, questionText: questionText, studentAnswer: studentAnswer, correctAnswer: correctAnswer, isCorrect: chosen === ans });

    if (!answeredCount[pid]) answeredCount[pid] = 0;
    if (!answeredCorrect[pid]) answeredCorrect[pid] = 0;
    answeredCount[pid]++;
    if (chosen === ans) answeredCorrect[pid]++;

    var quizContainer = qq.closest('.quiz-inner') || qq.closest('.quiz-box') || panel;
    if (!totalQuestions[pid]) totalQuestions[pid] = quizContainer.querySelectorAll('.qq').length;

    if (answeredCount[pid] >= totalQuestions[pid]) finishQuiz(pid);
  }

  /* ══════════════════════════════════════
     FINISH QUIZ — Score + Submit
     ══════════════════════════════════════ */
  function finishQuiz(pid) {
    var correct = answeredCorrect[pid] || 0;
    var total = totalQuestions[pid] || 1;
    var pct = Math.round((correct / total) * 100);
    var lessons = CFG.lessons || [];
    var label = lessons[pid] || ('Lesson ' + pid);

    var timeOnQuiz = '';
    if (quizStartTimes[pid]) timeOnQuiz = Math.round((Date.now() - quizStartTimes[pid]) / 1000);

    var scoreEl = document.getElementById('score' + pid);
    if (scoreEl) {
      var msg, color;
      if (pct === 100) { msg = 'Perfect! Excellent mastery.'; color = '#0d9488'; }
      else if (pct >= 80) { msg = 'Great work! Review any missed questions.'; color = '#0d9488'; }
      else if (pct >= 60) { msg = 'Good effort \u2014 review marked questions.'; color = '#f59e0b'; }
      else { msg = 'Keep studying \u2014 re-read the lesson and try again.'; color = '#f87171'; }
      scoreEl.innerHTML = '<div style="text-align:center;padding:20px;margin-top:16px;background:#f8fafc;border-radius:12px;border:2px solid ' + color + '"><div style="font-size:2rem;font-weight:800;color:' + color + '">' + correct + ' / ' + total + '</div><div style="font-size:1rem;color:' + color + ';margin-top:4px">' + pct + '% \u2014 ' + msg + '</div></div>';
    }

    var sc = document.getElementById('sc' + pid);
    if (sc) {
      sc.classList.add('show');
      sc.style.display = 'block';
      var scn = document.getElementById('scn' + pid);
      if (scn) scn.textContent = correct + '/' + total;
      var sm = document.getElementById('sm' + pid);
      if (sm) {
        var color2 = pct >= 80 ? '#0d9488' : pct >= 60 ? '#f59e0b' : '#f87171';
        sm.innerHTML = '<span style="color:' + color2 + '">' + pct + '%</span>';
      }
    }

    completedLessons.add(pid);
    var links = document.querySelectorAll('.sb-link');
    if (links[pid]) links[pid].classList.add('done');
    updateProgress();

    send({ action: 'score', lesson: label, score: correct, total: total, pct: pct, timeOnQuiz: timeOnQuiz });
    send({ action: 'quizDetail', lesson: label, questions: quizDetails[pid] || [] });

    showToast('Score sent! ' + correct + '/' + total + ' (' + pct + '%) \u2014 ' + label);
    saveProgress();
  }

  /* ══════════════════════════════════════
     MARK COMPLETE
     ══════════════════════════════════════ */
  window.markDone = function(n, btn) {
    completedLessons.add(n);
    if (btn) { btn.classList.add('done'); btn.textContent = '\u2713 Completed'; }
    var links = document.querySelectorAll('.sb-link');
    if (links[n]) links[n].classList.add('done');
    updateProgress();
    saveProgress();
  };

  /* ══════════════════════════════════════
     TOAST
     ══════════════════════════════════════ */
  function showToast(msg) {
    var t = document.getElementById('submit-toast');
    if (!t) return;
    var tm = document.getElementById('toast-msg');
    if (tm) tm.textContent = msg;
    t.style.display = 'flex';
    setTimeout(function() { t.style.display = 'none'; }, 4000);
  }
  window.showToast = showToast;

  /* ══════════════════════════════════════
     VIDEO EXPAND
     ══════════════════════════════════════ */
  window.expandVid = function(card) {
    var ytId = card.dataset.yt || card.dataset.id || card.dataset.vid;
    if (!ytId) return;
    var existing = card.querySelector('iframe');
    if (existing) { existing.remove(); card.classList.remove('expanded'); return; }
    var player = card.querySelector('.vc-player') || card.querySelector('.vid-thumb');
    var iframe = document.createElement('iframe');
    iframe.width = '100%'; iframe.height = '220';
    iframe.src = 'https://www.youtube.com/embed/' + ytId + '?autoplay=1';
    iframe.frameBorder = '0'; iframe.allowFullscreen = true;
    iframe.style.borderRadius = '8px'; iframe.style.marginTop = '8px';
    if (player && player.classList.contains('vc-player')) { player.innerHTML = ''; player.appendChild(iframe); }
    else { card.appendChild(iframe); }
    card.classList.add('expanded');
  };

  /* ══════════════════════════════════════
     TRACK PAGE EXIT (beforeunload)
     ══════════════════════════════════════ */
  window.addEventListener('beforeunload', function() {
    saveProgress();
    if (!studentName || !panelEnterTime) return;
    var duration = Math.round((Date.now() - panelEnterTime) / 1000);
    var lessons = CFG.lessons || [];
    var label = lessons[currentPanel] || ('Panel ' + currentPanel);

    // Supabase beacon (reliable — uses fetch with keepalive)
    if (window.portalAPI && portalAPI.getClassId()) {
      if (duration > 2) {
        portalAPI.beacon({ student: studentName, module: CFG.name || 'Unknown', lesson: label, event: 'page_view', duration: duration });
      }
      if (moduleStartTime) {
        var sessionDur = Math.round((Date.now() - moduleStartTime) / 1000);
        portalAPI.beacon({ student: studentName, module: CFG.name || 'Unknown', lesson: 'Session Total', event: 'session_end', duration: sessionDur });
      }
    }

    // Google Sheets fallback beacon
    if (duration > 2 && navigator.sendBeacon && API) {
      navigator.sendBeacon(API, JSON.stringify({ action: 'activity', student: studentName, module: CFG.name || 'Unknown', lesson: label, event: 'page_view', duration: duration }));
    }
    if (moduleStartTime && navigator.sendBeacon && API) {
      var sessionDur2 = Math.round((Date.now() - moduleStartTime) / 1000);
      navigator.sendBeacon(API, JSON.stringify({ action: 'activity', student: studentName, module: CFG.name || 'Unknown', lesson: 'Session Total', event: 'session_end', duration: sessionDur2 }));
    }
  });

})();
