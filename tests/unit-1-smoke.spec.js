/* SGHS Portal — unit-1.html smoke test (Phase D era)
   ---------------------------------------------------------------
   What this catches (the bugs Phase D weekend actually hit):
     - JS syntax errors that break the page on load
     - unit-engine.js failing to load (404 from corrupted cache-bust,
       parse error, etc.) → UnitEngine undefined
     - sol-api.js failing to load → solAPI undefined
     - dsm-player.js failing to load → DSMPlayer undefined
     - config/unit-1.js failing to load → UNIT_CONFIG undefined
     - Module-release lock branches behaving correctly
     - Required SSO modal markup intact
     - No uncaught page errors during initial render

   What this does NOT catch (intentionally):
     - Sign-in flow (requires real Google account in CI)
     - The full quiz interaction loop (DSM, vocab, practice test) —
       too brittle for CI; covered by the SQL integration suite at
       migrations/test/dsm-integration-tests.sql.
     - Anything that requires a teacher session.

   The test does NOT insert rows. With SSO-required, the modal can'"'"'t
   be accepted without a real Google session, so the entry flow stops
   at the modal — fine for a smoke test.

   Configure via env vars (see playwright.config.js + smoke.yml):
     TEST_BASE_URL    default https://sghs-portal.vercel.app
     TEST_CLASS_CODE  default BIO-3 (post-rename) or ENG-3 (pre)
*/
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.TEST_BASE_URL || 'https://sghs-portal.vercel.app';
const CLASS_CODE = process.env.TEST_CLASS_CODE || 'ENG-3';

// Errors we expect/accept in CI but which are unrelated to portal health.
const HARMLESS_PATTERNS = [
  /cdn\.jsdelivr\.net\/sm\//,             // CSP-blocked Supabase sourcemap fetch
  /Tracking Prevention/,                   // Edge privacy feature on CDN
  /409 \(Conflict\)/,                      // duplicate enrollInClass attempt
  /cdnjs\.cloudflare\.com/,                // CDN sourcemap noise
  /\/rest\/v1\/activity/,                  // error-reporter writes from anon get 401
                                           // post-Phase-2 RLS — known, separate fix
];

test('unit-1.html: page loads, engine + solAPI + config registered, modal correct', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message + '\n' + (err.stack || '').slice(0, 500)));

  await page.goto(`${BASE_URL}/sol-prep/unit-1.html`, { waitUntil: 'domcontentloaded' });

  // ── Wait for async boot (initAuth, runModuleReleaseGate, etc.).
  await page.waitForTimeout(1500);

  // ── Hard fail on any uncaught page error during initial render.
  expect(pageErrors, 'Uncaught page errors:\n' + pageErrors.join('\n')).toHaveLength(0);

  // ── Phase D core invariant: every script tag must have loaded and
  //    the globals must be wired. These four checks would have caught
  //    yesterday'"'"'s `?v=__HASH__` corruption that 404'"'"'d every script.
  const globalsReady = await page.evaluate(() => ({
    unitEngine:   typeof window.UnitEngine,
    solAPI:       typeof window.solAPI,
    dsmPlayer:    typeof window.DSMPlayer,
    unitConfig:   typeof window.UNIT_CONFIG,
    configUnit:   window.UNIT_CONFIG && window.UNIT_CONFIG.unitNumber,
    configKey:    window.UNIT_CONFIG && window.UNIT_CONFIG.unitKey
  }));
  expect(globalsReady.unitEngine, '[engine] UnitEngine global must be registered').toBe('object');
  expect(globalsReady.solAPI,     '[engine] solAPI global must be registered').toBe('object');
  expect(globalsReady.dsmPlayer,  '[engine] DSMPlayer global must be registered').toBe('object');
  expect(globalsReady.unitConfig, '[engine] window.UNIT_CONFIG must be registered').toBe('object');
  expect(globalsReady.configUnit, 'config unitNumber should match the page').toBe(1);
  expect(globalsReady.configKey,  'config unitKey should match the page').toBe('unit1');

  // ── Public API surface check — these are the methods the inline
  //    onclick attributes call. If any is missing, students hit a
  //    ReferenceError mid-page.
  const apiPresent = await page.evaluate(() => {
    const methods = ['boot','onGateAnswer','onVqPick','onFlipCard','onSolPick',
      'goTo','retakePractice','submitFinalScore','showDangerZone','showToast',
      'markAnswered','retryVocab','gradeVocab','startUnit','startFresh',
      'signInWithGoogle','flushSave'];
    return methods.filter(m => typeof window.UnitEngine[m] !== 'function');
  });
  expect(apiPresent, 'UnitEngine missing public methods').toEqual([]);

  // ── Module-release state branches the rest of the test.
  const lockOverlay = page.locator('#module-release-lock-overlay');
  const isLocked = await lockOverlay.isVisible().catch(() => false);
  if (isLocked) {
    await expect(lockOverlay).toContainText(/Not Yet Open/i);
    console.log('[smoke] unit-1 is currently locked — entry-flow assertions skipped (expected when teacher has it locked).');
    return;
  }

  // ── Modal + SSO entry path (unlocked branch)
  await expect(page.locator('#name-modal')).toBeVisible();
  await expect(page.locator('#sso-signin-btn')).toBeVisible();
  await expect(page.locator('#class-code')).toBeAttached();
  await expect(page.locator('button.nm-btn')).toBeAttached();

  // ── Legacy name modal artifacts must be gone (Phase A removed them).
  await expect(page.locator('#student-first-name')).toHaveCount(0);
  await expect(page.locator('#student-last-name')).toHaveCount(0);

  // ── Console-error filter: anything not in HARMLESS_PATTERNS is real.
  const realErrors = consoleErrors.filter(e => !HARMLESS_PATTERNS.some(p => p.test(e)));
  if (realErrors.length > 0) {
    console.log('Browser console errors (filtered):');
    realErrors.forEach(e => console.log('  - ' + e));
  }
  // Soft assertion — log but don't fail. (Hard fail is on pageErrors.)
});
