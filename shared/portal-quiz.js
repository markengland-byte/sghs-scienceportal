/* ══════════════════════════════════════════════════════════════
   SGHS Science Portal — Shared Quiz, Navigation & Tracking JS
   v2.0 — Full student progress tracking

   USAGE: Each module sets window.MODULE_CONFIG before loading:
   window.MODULE_CONFIG = {
     name: 'Module Name',
     appsScriptUrl: 'https://script.google.com/...',
     panelCount: N,
     lessonCount: N-1,
     cpMin: 100,
     lessons: ['Overview','L1: Title',...]
   };
   ══════════════════════════════════════════════════════════════ */

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
  var quizDetails = {};   // { panelId: [ {qNum, questionText, studentAnswer, correctAnswer, isCorrect} ] }
  var answeredCount = {};  // { panelId: count }
  var answeredCorrect = {}; // { panelId: correctCount }
  var totalQuestions = {};  // { panelId: total }

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
      // Save checkpoint text so students don't lose typed answers
      var cpTexts = {};
      document.querySelectorAll('.cp-textarea').forEach(function(ta) {
        if (ta.value.trim().length > 0) {
          var id = ta.id || ta.closest('.checkpoint-box, .checkpoint')?.id || '';
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
      // Expire after 30 days
      if (data.timestamp && (Date.now() - data.timestamp) > 30 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(STORE_KEY);
        return null;
      }
      return data;
    } catch(e) { return null; }
  }

  function restoreProgress(data) {
    // Restore completed lessons in sidebar
    if (data.completedLessons) {
      data.completedLessons.forEach(function(n) {
        completedLessons.add(n);
        var links = document.querySelectorAll('.sb-link');
        if (links[n]) links[n].classList.add('done');
      });
    }
    // Restore checkpoint text
    if (data.checkpoints) {
      Object.keys(data.checkpoints).forEach(function(id) {
        var ta = document.getElementById(id);
        if (ta) {
          ta.value = data.checkpoints[id];
          // Trigger the cpCheck to re-evaluate unlock state
          var panelId = id.replace(/\D/g, '');
          if (panelId && window.cpCheck) window.cpCheck(parseInt(panelId));
        }
      });
    }
    updateProgress();
    // Navigate to last panel
    if (data.currentPanel > 0) {
      window.goTo(data.currentPanel);
    }
  }

  function clearProgress() {
    try { localStorage.removeItem(STORE_KEY); } catch(e) {}
  }

  /* ══════════════════════════════════════
     SEND DATA TO GOOGLE SHEET
     ══════════════════════════════════════ */
  function send(payload) {
    if (!studentName || !API) return;
    payload.student = studentName;
    payload.module = CFG.name || 'Unknown';
    try {
      fetch(API, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(function() {});
    } catch(e) {}
  }

  /* ══════════════════════════════════════
     NAME MODAL
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
    studentName = v;
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
  };

  document.addEventListener('DOMContentLoaded', function() {
    var input = document.getElementById('student-name');
    if (input) {
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') window.startModule();
      });

      // Check for saved progress — show "Welcome Back!" prompt
      var saved = loadProgress();
      if (saved && saved.studentName) {
        input.value = saved.studentName;
        var title = document.querySelector('.nm-title');
        if (title) title.textContent = 'Welcome Back!';
        var sub = document.querySelector('.nm-sub');
        if (sub) sub.textContent = 'Your progress has been saved. Click Resume to pick up where you left off, or enter a different name to start fresh.';
        var btn = document.querySelector('.nm-btn');
        if (btn) btn.textContent = 'Resume →';
      }
    }
  });

  /* ══════════════════════════════════════
     NAVIGATION WITH TIME TRACKING
     ══════════════════════════════════════ */
  window.goTo = function(n) {
    // Log time on previous panel
    if (panelEnterTime && studentName) {
      var duration = Math.round((Date.now() - panelEnterTime) / 1000);
      var lessons = CFG.lessons || [];
      var prevLabel = lessons[currentPanel] || ('Panel ' + currentPanel);
      if (duration > 2) { // Don't log accidental quick clicks
        send({ action: 'activity', lesson: prevLabel, event: 'page_view', duration: duration });
      }
    }

    // Hide all panels, show target
    document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
    var target = document.getElementById('p' + n);
    if (target) target.classList.add('active');

    // Update sidebar
    document.querySelectorAll('.sb-link').forEach(function(l, i) { l.classList.toggle('active', i === n); });

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Update state
    currentPanel = n;
    panelEnterTime = Date.now();
    updateProgress();
    saveProgress();

    // Log lesson entry
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
     CHECKPOINT — New format
     Handles: <textarea class="cp-textarea" oninput="cpCheck(id)">
     Inside: <div class="checkpoint" id="cp{id}">
     Unlocks: <div class="quiz-wrap locked" id="quiz{id}">
     ══════════════════════════════════════ */
  window.cpCheck = function(id) {
    // Find textarea — try new pattern first, then old patterns
    var cp = document.getElementById('cp' + id);
    var ta = null;
    if (cp) ta = cp.querySelector('.cp-textarea') || cp.querySelector('textarea');
    if (!ta) ta = document.getElementById('cpt' + id);
    if (!ta) return;

    var len = ta.value.trim().length;

    // Update fill bar (new pattern)
    var fill = document.getElementById('cpFill' + id);
    if (fill) {
      var pct = Math.min(100, Math.round((len / CP_MIN) * 100));
      fill.style.width = pct + '%';
      fill.style.background = len >= CP_MIN ? '#0d9488' : '#3b82f6';
    }

    // Update character count (new pattern)
    var count = document.getElementById('cpCount' + id);
    if (count) {
      count.textContent = len + ' / ' + CP_MIN + ' characters';
      count.style.color = len >= CP_MIN ? '#0d9488' : '';
    }

    // Old pattern counters
    var counterSpan = document.getElementById('cpn' + id);
    if (counterSpan) counterSpan.textContent = len;
    var counter = document.getElementById('cpc' + id);
    if (counter) {
      if (len >= CP_MIN) { counter.classList.add('met'); counter.classList.add('ok'); }
      else { counter.classList.remove('met'); counter.classList.remove('ok'); }
    }

    // Old pattern button
    var btn = document.getElementById('cpb' + id);
    if (btn) {
      if (len >= CP_MIN) { btn.classList.add('ready'); btn.disabled = false; }
      else { btn.classList.remove('ready'); btn.disabled = true; }
    }

    // Auto-unlock quiz when threshold met (new pattern — no button needed)
    if (len >= CP_MIN) {
      var quiz = document.getElementById('quiz' + id);
      if (quiz && quiz.classList.contains('locked')) {
        quiz.classList.remove('locked');
        // Hide lock message
        var lockMsg = quiz.querySelector('.quiz-lock-msg');
        if (lockMsg) lockMsg.style.display = 'none';

        // Submit checkpoint text
        var lessons = CFG.lessons || [];
        var label = lessons[id] || ('Lesson ' + id);
        send({
          action: 'checkpoint',
          lesson: label,
          responseText: ta.value.trim(),
          charCount: len
        });

        // Start quiz timer
        quizStartTimes[id] = Date.now();

        showToast('Checkpoint complete — quiz unlocked!');
      }
    }
  };

  // Old pattern unlock button
  window.cpUnlock = function(id) {
    var ql = document.getElementById('ql' + id);
    var qi = document.getElementById('qi' + id);
    var cpd = document.getElementById('cpd' + id);

    if (qi) {
      if (ql) ql.style.display = 'none';
      qi.style.display = 'block';
      if (cpd) cpd.classList.add('show');
      var btn = document.getElementById('cpb' + id);
      if (btn) { btn.disabled = true; btn.textContent = 'Quiz Unlocked ✓'; }
      qi.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Submit checkpoint text
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
     QUIZ — New format: pick(panelNum, qNum, element, flag)
     flag: 'a' = correct, 'b' = incorrect
     ══════════════════════════════════════ */
  window.pick = function(panelOrEl, qNum, btnEl, flag) {
    // Detect which format is being used
    if (typeof panelOrEl === 'object') {
      // OLD format: pick(element) — element is the clicked <li>
      pickOld(panelOrEl);
      return;
    }

    // NEW format: pick(panelNum, qNum, buttonElement, 'a'/'b')
    var pid = panelOrEl;
    var isCorrect = (flag === 'a');

    // Find the question container
    var qq = btnEl.closest('.qq');
    if (!qq) return;

    // Prevent re-answering
    if (qq.dataset.locked === 'true') return;
    qq.dataset.locked = 'true';

    // Get question text and answer texts
    var stemEl = qq.querySelector('.q-stem');
    var questionText = stemEl ? stemEl.textContent.trim() : 'Q' + qNum;
    var studentAnswer = btnEl.textContent.trim();

    // Find correct answer text
    var correctAnswer = '';
    var allBtns = qq.querySelectorAll('.cbtn');
    allBtns.forEach(function(b) {
      var bFlag = b.getAttribute('onclick') || '';
      var match = bFlag.match(/pick\(\d+,\d+,this,'(a|b)'\)/);
      if (match && match[1] === 'a') {
        correctAnswer = b.textContent.trim();
      }
    });

    // Style the chosen button
    btnEl.classList.add(isCorrect ? 'correct' : 'incorrect');
    btnEl.classList.add('picked');

    // Highlight correct answer and disable all
    allBtns.forEach(function(b) {
      b.disabled = true;
      b.classList.add('revealed');
      var bFlag = b.getAttribute('onclick') || '';
      if (bFlag.indexOf("'a'") !== -1) {
        b.classList.add('correct');
      }
    });

    // Show feedback
    var fb = qq.querySelector('.q-fb');
    if (fb) {
      fb.style.display = 'block';
      fb.textContent = isCorrect ? '✓ Correct!' : '✗ Incorrect — the correct answer is highlighted above.';
      fb.style.color = isCorrect ? '#0d9488' : '#ef4444';
      fb.style.fontWeight = '600';
      fb.style.marginTop = '8px';
    }

    // Track this question
    if (!quizDetails[pid]) quizDetails[pid] = [];
    quizDetails[pid].push({
      qNum: qNum,
      questionText: questionText,
      studentAnswer: studentAnswer,
      correctAnswer: correctAnswer,
      isCorrect: isCorrect
    });

    if (!answeredCount[pid]) answeredCount[pid] = 0;
    if (!answeredCorrect[pid]) answeredCorrect[pid] = 0;
    answeredCount[pid]++;
    if (isCorrect) answeredCorrect[pid]++;

    // Count total questions in this quiz
    var panel = document.getElementById('p' + pid);
    if (panel && !totalQuestions[pid]) {
      var quizWrap = document.getElementById('quiz' + pid);
      if (quizWrap) {
        totalQuestions[pid] = quizWrap.querySelectorAll('.qq').length;
      } else {
        totalQuestions[pid] = panel.querySelectorAll('.qq').length;
      }
    }

    // Check if all questions answered
    if (answeredCount[pid] >= totalQuestions[pid]) {
      finishQuiz(pid);
    }
  };

  /* ── OLD format pick (for ch3 p1-p3, ch4) ── */
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

    // Get question info for tracking
    var stemEl = qq.querySelector('.qt') || qq.querySelector('.q-stem');
    var questionText = stemEl ? stemEl.textContent.trim() : '';
    var studentAnswer = el.textContent.trim();
    var correctAnswer = '';
    qq.querySelectorAll('.qo').forEach(function(o) {
      if (o.dataset.v === ans) correctAnswer = o.textContent.trim();
    });

    if (!quizDetails[pid]) quizDetails[pid] = [];
    quizDetails[pid].push({
      qNum: quizDetails[pid].length + 1,
      questionText: questionText,
      studentAnswer: studentAnswer,
      correctAnswer: correctAnswer,
      isCorrect: chosen === ans
    });

    if (!answeredCount[pid]) answeredCount[pid] = 0;
    if (!answeredCorrect[pid]) answeredCorrect[pid] = 0;
    answeredCount[pid]++;
    if (chosen === ans) answeredCorrect[pid]++;

    var quizContainer = qq.closest('.quiz-inner') || qq.closest('.quiz-box') || panel;
    var qqs = quizContainer.querySelectorAll('.qq');
    if (!totalQuestions[pid]) totalQuestions[pid] = qqs.length;

    if (answeredCount[pid] >= totalQuestions[pid]) {
      finishQuiz(pid);
    }
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

    // Calculate time on quiz
    var timeOnQuiz = '';
    if (quizStartTimes[pid]) {
      timeOnQuiz = Math.round((Date.now() - quizStartTimes[pid]) / 1000);
    }

    // Show score display
    var scoreEl = document.getElementById('score' + pid);
    if (scoreEl) {
      var msg, color;
      if (pct === 100) { msg = 'Perfect! Excellent mastery.'; color = '#0d9488'; }
      else if (pct >= 80) { msg = 'Great work! Review any missed questions.'; color = '#0d9488'; }
      else if (pct >= 60) { msg = 'Good effort — review marked questions.'; color = '#f59e0b'; }
      else { msg = 'Keep studying — re-read the lesson and try again.'; color = '#f87171'; }
      scoreEl.innerHTML = '<div style="text-align:center;padding:20px;margin-top:16px;background:#f8fafc;border-radius:12px;border:2px solid ' + color + '">' +
        '<div style="font-size:2rem;font-weight:800;color:' + color + '">' + correct + ' / ' + total + '</div>' +
        '<div style="font-size:1rem;color:' + color + ';margin-top:4px">' + pct + '% — ' + msg + '</div></div>';
    }

    // Also try old score display pattern
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

    // Mark lesson complete
    completedLessons.add(pid);
    var links = document.querySelectorAll('.sb-link');
    if (links[pid]) links[pid].classList.add('done');
    updateProgress();

    // Submit score
    send({
      action: 'score',
      lesson: label,
      score: correct,
      total: total,
      pct: pct,
      timeOnQuiz: timeOnQuiz
    });

    // Submit question-by-question detail
    send({
      action: 'quizDetail',
      lesson: label,
      questions: quizDetails[pid] || []
    });

    showToast('Score sent! ' + correct + '/' + total + ' (' + pct + '%) — ' + label);
    saveProgress();
  }

  /* ══════════════════════════════════════
     MARK COMPLETE (manual button)
     ══════════════════════════════════════ */
  window.markDone = function(n, btn) {
    completedLessons.add(n);
    if (btn) {
      btn.classList.add('done');
      btn.textContent = '✓ Completed';
    }
    var links = document.querySelectorAll('.sb-link');
    if (links[n]) links[n].classList.add('done');
    updateProgress();
    saveProgress();
  };

  /* ══════════════════════════════════════
     TOAST NOTIFICATION
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
    // New pattern: data-yt attribute
    var ytId = card.dataset.yt || card.dataset.id || card.dataset.vid;
    if (!ytId) return;

    var existing = card.querySelector('iframe');
    if (existing) {
      existing.remove();
      card.classList.remove('expanded');
      return;
    }

    // Try finding player container, or append to card
    var player = card.querySelector('.vc-player') || card.querySelector('.vid-thumb');
    var iframe = document.createElement('iframe');
    iframe.width = '100%';
    iframe.height = '220';
    iframe.src = 'https://www.youtube.com/embed/' + ytId + '?autoplay=1';
    iframe.frameBorder = '0';
    iframe.allowFullscreen = true;
    iframe.style.borderRadius = '8px';
    iframe.style.marginTop = '8px';

    if (player && player.classList.contains('vc-player')) {
      player.innerHTML = '';
      player.appendChild(iframe);
    } else {
      card.appendChild(iframe);
    }
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
    if (duration > 2) {
      // Use sendBeacon for reliability on page close
      if (navigator.sendBeacon && API) {
        var payload = JSON.stringify({
          action: 'activity',
          student: studentName,
          module: CFG.name || 'Unknown',
          lesson: label,
          event: 'page_view',
          duration: duration
        });
        navigator.sendBeacon(API, payload);
      }
    }
    // Also log total session time
    if (moduleStartTime && navigator.sendBeacon && API) {
      var sessionDur = Math.round((Date.now() - moduleStartTime) / 1000);
      var payload2 = JSON.stringify({
        action: 'activity',
        student: studentName,
        module: CFG.name || 'Unknown',
        lesson: 'Session Total',
        event: 'session_end',
        duration: sessionDur
      });
      navigator.sendBeacon(API, payload2);
    }
  });

})();
