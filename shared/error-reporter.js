/* ================================================================
   Client-side error reporter — audit finding #7
   ================================================================

   Catches `window.onerror` (uncaught exceptions) and
   `window.onunhandledrejection` (rejected promises with no .catch)
   and writes them to the existing `activity` table with
   event='client_error'. The dashboard's Activity tab can filter
   by event type to surface a "Recent errors" view.

   Self-contained: doesn't depend on solAPI or portal-api being
   loaded yet — it reads the SUPABASE_URL/ANON_KEY config from
   globals (set by supabase-config.js) with hardcoded fallbacks.

   Throttling: ~1 report per 5 seconds. An error in a tight loop
   (which is how we'd notice the WORST bug) shouldn't spam the
   activity table with thousands of identical rows.

   Privacy: no PII beyond what the page already collects. The
   request body includes the error message, stack (truncated),
   user agent, and current URL. No browser cookies or tokens.

   Caveat: writes to `activity` require a valid class_id (per the
   Phase 2 RLS policy). If an error fires before the student has
   entered a class code, the report falls back to console.error
   only — no DB row written.

   To use: add <script src="<rel>/shared/error-reporter.js"></script>
   to any HTML page after supabase-config.js (or any page that
   doesn't load supabase-config.js — fallbacks kick in).
   ================================================================ */
(function() {
  var SUPABASE_URL = (typeof window !== 'undefined' && window.SUPABASE_URL)
    || 'https://cogpsieldrgeqlemhosy.supabase.co';
  var SUPABASE_ANON_KEY = (typeof window !== 'undefined' && window.SUPABASE_ANON_KEY)
    || 'sb_publishable_Wn4L2S2gMPq2cLoiLt2tIQ_z4e7IUZU';

  var lastReportAt = 0;
  var THROTTLE_MS = 5000;

  function readClassFromStorage() {
    try {
      var raw = localStorage.getItem('sol_class') || localStorage.getItem('portal_class');
      if (!raw) return null;
      var data = JSON.parse(raw);
      return (data && data.classId) ? { classId: data.classId, code: data.code || '' } : null;
    } catch (e) { return null; }
  }

  // Try to find the most recent saved studentName across any unit's
  // progress snapshot. Best-effort; OK if it returns ''.
  function readStudentName() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && /^sol_unit\d+_progress$/.test(key)) {
          var data = JSON.parse(localStorage.getItem(key) || 'null');
          if (data && data.studentName) return data.studentName;
        }
      }
    } catch (e) {}
    return '';
  }

  function report(detail) {
    var now = Date.now();
    if (now - lastReportAt < THROTTLE_MS) {
      console.warn('[error-reporter] throttled (within ' + THROTTLE_MS + 'ms of last report)');
      return;
    }
    lastReportAt = now;

    // Always log to console so DevTools shows the error too.
    console.error('[error-reporter]', detail);

    var cls = readClassFromStorage();
    if (!cls) {
      console.warn('[error-reporter] no class in localStorage; skipping DB write');
      return;
    }
    var studentName = readStudentName() || ('client_error@' + (cls.code || 'unknown'));

    var body = {
      class_id: cls.classId,
      student_name: studentName,
      module: 'client_error_' + (location.pathname.split('/').pop() || 'index'),
      lesson: '',
      event: 'client_error',
      metadata: detail
    };

    try {
      fetch(SUPABASE_URL + '/rest/v1/activity', {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(body),
        // keepalive lets the request survive page unload (e.g. error
        // mid-navigation). Browsers cap keepalive payloads at 64KB.
        keepalive: true
      }).catch(function(err) {
        // Don't recursively log — we've already console.error'd.
        console.warn('[error-reporter] DB write failed:', err && err.message);
      });
    } catch (e) {
      console.warn('[error-reporter] fetch threw synchronously:', e && e.message);
    }
  }

  window.addEventListener('error', function(e) {
    report({
      kind: 'window.onerror',
      message: e.message ? String(e.message).slice(0, 500) : '',
      filename: e.filename || '',
      lineno: e.lineno || 0,
      colno: e.colno || 0,
      stack: (e.error && e.error.stack) ? String(e.error.stack).slice(0, 1000) : null,
      url: location.href.slice(0, 500),
      ua: (navigator.userAgent || '').slice(0, 200),
      ts: new Date().toISOString()
    });
  });

  window.addEventListener('unhandledrejection', function(e) {
    var reason = e.reason;
    var reasonStr = '';
    if (reason) {
      try { reasonStr = (typeof reason === 'string') ? reason : String(reason && reason.message ? reason.message : reason); } catch (_) {}
    }
    report({
      kind: 'unhandledrejection',
      reason: reasonStr.slice(0, 500),
      stack: (reason && reason.stack) ? String(reason.stack).slice(0, 1000) : null,
      url: location.href.slice(0, 500),
      ua: (navigator.userAgent || '').slice(0, 200),
      ts: new Date().toISOString()
    });
  });

  console.log('[error-reporter] active');
})();
