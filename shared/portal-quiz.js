/* ══════════════════════════════════════════════════════════════
   SGHS Science Portal — Shared Quiz & Navigation JS

   USAGE: Each module sets window.MODULE_CONFIG before loading this file:

   <script>
   window.MODULE_CONFIG = {
     name: "Photosynthesis & CR",       // Module name for score submission
     appsScriptUrl: "https://...",       // Apps Script endpoint
     panelCount: 12,                     // Total panels (0-indexed)
     lessonCount: 11,                    // Lessons (excluding overview)
     lessons: ["Overview","L1: ATP",...], // Panel labels for score submission
     cpMin: 80                           // Checkpoint minimum chars (default 80)
   };
   </script>
   <script src="../shared/portal-quiz.js"></script>

   ══════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  const CFG = window.MODULE_CONFIG || {};
  const APPS_SCRIPT_URL = CFG.appsScriptUrl || '';
  const CP_MIN = CFG.cpMin || 80;

  let studentName = '';
  let completedLessons = new Set();
  let answered = {};

  /* ── NAME MODAL ── */
  window.startModule = function() {
    const input = document.getElementById('student-name');
    if (!input) return;
    const v = input.value.trim();
    const parts = v.split(/\s+/);
    if (parts.length < 2 || parts[0].length < 1) {
      const err = document.getElementById('name-err');
      if (err) err.style.display = 'block';
      input.style.borderColor = '#c0392b';
      return;
    }
    studentName = v;
    const modal = document.getElementById('name-modal');
    if (modal) modal.style.display = 'none';
    const badge = document.getElementById('student-badge') || document.querySelector('.tb-badge');
    if (badge) badge.textContent = studentName;
  };

  // Enter key on name input
  document.addEventListener('DOMContentLoaded', function() {
    const input = document.getElementById('student-name');
    if (input) {
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') window.startModule();
      });
    }
    // Set badge id if not already set
    const badge = document.querySelector('.tb-badge');
    if (badge && !badge.id) badge.id = 'student-badge';
  });

  /* ── NAVIGATION ── */
  window.goTo = function(n) {
    // Hide all panels
    document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
    // Show target
    var target = document.getElementById('p' + n);
    if (target) target.classList.add('active');
    // Update sidebar
    var links = document.querySelectorAll('.sb-link');
    links.forEach(function(l, i) { l.classList.toggle('active', i === n); });
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Update progress bar
    updateProgress();
    // Init charts if module provides the function
    if (typeof window.initCharts === 'function') window.initCharts(n);
  };

  /* ── PROGRESS BAR ── */
  function updateProgress() {
    var total = CFG.lessonCount || CFG.panelCount || 11;
    var pct = Math.round((completedLessons.size / total) * 100);
    var bar = document.getElementById('prog-bar');
    if (bar) bar.style.width = pct + '%';
  }

  /* ── CHECKPOINT (multiple patterns supported) ── */

  // Pattern 1: Biology style (cp{id}, cpt{id}, cpn{id}, cpc{id}, cpb{id}, cpd{id})
  // Pattern 2: A&P style (same IDs but different CSS)
  // Pattern 3: Intro-bio style (cp{id}-text, cp{id}-count, cp{id}-btn)

  window.cpCheck = function(id) {
    // Try multiple ID patterns
    var ta = document.getElementById('cpt' + id) || document.getElementById('cp' + id + '-text');
    if (!ta) return;
    var len = ta.value.trim().length;

    // Update counter display
    var counterSpan = document.getElementById('cpn' + id);
    if (counterSpan) counterSpan.textContent = len;

    var counter = document.getElementById('cpc' + id) || document.getElementById('cp' + id + '-count');
    var btn = document.getElementById('cpb' + id) || document.getElementById('cp' + id + '-btn');

    if (len >= CP_MIN) {
      if (counter) { counter.classList.add('met'); counter.classList.add('ok'); }
      if (btn) { btn.classList.add('ready'); btn.disabled = false; }
    } else {
      if (counter) { counter.classList.remove('met'); counter.classList.remove('ok'); }
      if (btn) { btn.classList.remove('ready'); btn.disabled = true; }
    }
  };

  window.cpUnlock = function(id) {
    // Pattern 1: hide checkpoint container, show quiz-wrap
    var cp = document.getElementById('cp' + id);
    var cpd = document.getElementById('cpd' + id);
    var qw = document.getElementById('quiz-wrap' + id);

    // Pattern 2: hide quiz-locked, show quiz-inner
    var ql = document.getElementById('ql' + id);
    var qi = document.getElementById('qi' + id);

    if (qw) {
      // Biology pattern: checkpoint hides, quiz-wrap shows
      if (cp) cp.style.display = 'none';
      if (cpd) cpd.style.display = 'block';
      qw.style.display = 'block';
      qw.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (qi) {
      // Intro-bio / A&P pattern: quiz-locked hides, quiz-inner shows
      if (ql) ql.style.display = 'none';
      qi.style.display = 'block';
      if (cpd) cpd.classList.add('show');
      var btn = document.getElementById('cpb' + id) || document.getElementById('cp' + id + '-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Quiz Unlocked ✓'; }
      qi.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    answered[id] = {};
  };

  /* ── QUIZ ANSWER SELECTION ── */
  window.pick = function(el) {
    var qq = el.closest('.qq');
    if (!qq || qq.dataset.locked === 'true') return;
    qq.dataset.locked = 'true';

    var ans = qq.dataset.ans;
    var chosen = el.dataset.v;

    // Mark chosen option
    el.classList.add(chosen === ans ? 'correct' : 'incorrect');
    el.classList.add('revealed');

    // Reveal correct answer and disable all options
    qq.querySelectorAll('.qo').forEach(function(o) {
      o.classList.add('revealed');
      if (o.dataset.v === ans) o.classList.add('correct');
    });

    // Show explanation
    var exp = qq.querySelector('.qexp');
    if (exp) { exp.classList.add('show'); exp.style.display = 'block'; }

    // Track answer
    var panel = qq.closest('.panel') || qq.closest('[id^="q"]');
    if (!panel) return;
    var pid = parseInt(panel.id.replace(/\D/g, ''));
    if (!answered[pid]) answered[pid] = {};

    var qqs = (qq.closest('.quiz-inner') || qq.closest('.quiz-box') || panel).querySelectorAll('.qq');
    var idx = Array.from(qqs).indexOf(qq);
    answered[pid][idx] = (chosen === ans) ? 1 : 0;

    // Check if quiz is complete
    checkScore(pid, qqs);
  };

  /* ── SCORE TALLYING ── */
  function checkScore(pid, qqs) {
    if (!qqs) {
      var panel = document.getElementById('p' + pid);
      if (!panel) return;
      qqs = panel.querySelectorAll('.qq');
    }
    var total = qqs.length;
    if (!answered[pid]) return;
    var answeredCount = Object.keys(answered[pid]).length;
    if (answeredCount < total) return;

    var correct = Object.values(answered[pid]).reduce(function(a, b) { return a + b; }, 0);

    // Show score
    var sc = document.getElementById('sc' + pid);
    if (sc) {
      sc.classList.add('show');
      sc.style.display = 'block';
      var scn = document.getElementById('scn' + pid);
      if (scn) scn.textContent = correct + '/' + total;
      // Score message
      var sm = document.getElementById('sm' + pid);
      if (sm) {
        var pct = Math.round((correct / total) * 100);
        var msg, color;
        if (pct === 100) { msg = 'Perfect! Excellent mastery.'; color = '#0d9488'; }
        else if (pct >= 80) { msg = 'Great work! Review any missed questions.'; color = '#0d9488'; }
        else if (pct >= 60) { msg = 'Good effort — review marked questions.'; color = '#f59e0b'; }
        else { msg = 'Keep studying — re-read the lesson and try again.'; color = '#f87171'; }
        sm.innerHTML = '<span style="color:' + color + '">' + pct + '% — ' + msg + '</span>';
      }
    }

    // Submit score
    sendProgress(pid, correct, total);
  }

  /* ── MARK COMPLETE ── */
  window.markDone = function(n, btn) {
    completedLessons.add(n);
    if (btn) {
      btn.classList.add('done');
      btn.textContent = '✓ Completed';
    }
    var links = document.querySelectorAll('.sb-link');
    if (links[n]) links[n].classList.add('done');
    updateProgress();
  };

  /* ── SCORE SUBMISSION ── */
  function sendProgress(pid, correct, total) {
    if (!studentName || !APPS_SCRIPT_URL) return;
    var lessons = CFG.lessons || [];
    var label = lessons[pid] || ('L' + pid);
    var pct = Math.round((correct / total) * 100);

    var payload = {
      student: studentName,
      module: CFG.name || 'Unknown Module',
      lesson: label,
      score: correct,
      total: total,
      pct: pct,
      timestamp: new Date().toISOString()
    };

    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function() { showToast('Score sent! ' + correct + '/' + total + ' — ' + label); })
    .catch(function() { showToast('Could not send score — check your connection'); });
  }

  /* ── TOAST ── */
  function showToast(msg) {
    var t = document.getElementById('submit-toast');
    if (!t) return;
    var tm = document.getElementById('toast-msg');
    if (tm) tm.textContent = msg;
    t.style.display = 'flex';
    setTimeout(function() { t.style.display = 'none'; }, 4000);
  }
  window.showToast = showToast;

  /* ── VIDEO EXPAND ── */
  window.expandVid = function(card) {
    var player = card.querySelector('.vc-player');
    if (!player) return;
    if (player.querySelector('iframe')) {
      player.innerHTML = '';
      card.classList.remove('expanded');
    } else {
      var vid = card.dataset.id || card.dataset.vid;
      player.innerHTML = '<iframe width="100%" height="220" src="https://www.youtube.com/embed/' + vid + '?autoplay=1" frameborder="0" allowfullscreen></iframe>';
      card.classList.add('expanded');
    }
  };

})();
