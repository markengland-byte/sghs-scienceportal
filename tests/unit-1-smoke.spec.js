/* SGHS Portal — unit-1.html smoke test
   ---------------------------------------------------------------
   What this catches:
     - JS syntax errors that break the page on load
     - Broken module-release gate (unit-1 should be open per memory)
     - validateCode + storeClass round-trip
     - Modal accept-and-dismiss flow
     - First panel render

   What this does NOT catch (intentionally):
     - The full quiz interaction loop (DSM, vocab, practice test) —
       too brittle for CI; covered by the SQL integration suite at
       migrations/test/dsm-integration-tests.sql.
     - Anything that requires a teacher session (use of the dashboard)

   IMPORTANT — TEST DATA POLLUTION:
     Each run inserts rows under student_name='Playwright Ci<stamp>'
     into scores/activity/quiz_progress/student_classes (legacy
     branch — student_id is NULL because no Google session). They
     accumulate. Run this every few months to clean up:

       DELETE FROM scores         WHERE student_name LIKE 'Playwright%';
       DELETE FROM activity       WHERE student_name LIKE 'Playwright%';
       DELETE FROM quiz_progress  WHERE student_name LIKE 'Playwright%';
       DELETE FROM checkpoints    WHERE student_name LIKE 'Playwright%';
       DELETE FROM dsm_attempts   WHERE student_name LIKE 'Playwright%';

     (None of those will touch real student data — the prefix is
     reserved for this test.)

   Configure via env vars (see playwright.config.js + smoke.yml):
     TEST_BASE_URL    default https://sghs-portal.vercel.app
     TEST_CLASS_CODE  default ENG-3 (Mark's active 3rd Block)
*/
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.TEST_BASE_URL || 'https://sghs-portal.vercel.app';
const CLASS_CODE = process.env.TEST_CLASS_CODE || 'ENG-3';

test('unit-1.html: page loads, modal accepts class code, panel 0 renders', async ({ page }) => {
  const stamp = Date.now();
  const consoleErrors = [];

  // Capture browser console errors so a failed assertion includes them.
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Page errors (uncaught exceptions in page scripts).
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message + '\n' + (err.stack || '').slice(0, 500)));

  await page.goto(`${BASE_URL}/sol-prep/unit-1.html`, { waitUntil: 'domcontentloaded' });

  // ── Module-release gate: unit-1 must NOT be locked. If it is, the test
  //    can't proceed and the failure mode is meaningful — Mark forgot to
  //    re-unlock unit-1, OR the gate fired incorrectly.
  const lockOverlay = page.locator('#module-release-lock-overlay');
  // Give the async lookupSync isModuleUnlocked a moment to resolve.
  await page.waitForTimeout(1500);
  await expect(lockOverlay).toHaveCount(0);

  // ── Modal visible
  const modal = page.locator('#name-modal');
  await expect(modal).toBeVisible();

  // ── Fill in the legacy name + class code path. SSO button is also
  //    present but we deliberately use the manual entry to test that flow.
  await page.locator('#student-first-name').fill('Playwright');
  await page.locator('#student-last-name').fill(`Ci${stamp}`);
  await page.locator('#class-code').fill(CLASS_CODE);

  // ── Submit
  const startBtn = page.locator('button.nm-btn').filter({ hasText: /^Start Unit 1/ });
  await startBtn.click();

  // ── Modal should be hidden once class validation completes.
  await expect(modal).toBeHidden({ timeout: 12_000 });

  // ── Panel 0 (SOL Focus card) renders.
  const panel0 = page.locator('#p0.panel.active');
  await expect(panel0).toBeVisible();

  // ── Title content sanity check.
  await expect(page.locator('.focus-title').first())
    .toContainText('Scientific Investigation');

  // ── Filter out expected noise from real errors.
  //    - cdn.jsdelivr.net/sm/...map: CSP-blocked sourcemap fetch (harmless)
  //    - "Tracking Prevention blocked": Edge privacy feature on Chart.js CDN
  //    - 409 Conflict: enrollInClass duplicate (harmless; row already exists)
  const realConsoleErrors = consoleErrors.filter(e =>
    !e.includes('cdn.jsdelivr.net/sm/') &&
    !e.includes('Tracking Prevention') &&
    !e.includes('409 (Conflict)') &&
    !e.includes('cdnjs.cloudflare.com')
  );

  if (realConsoleErrors.length > 0) {
    console.log('Browser console errors (filtered):');
    realConsoleErrors.forEach(e => console.log('  - ' + e));
  }
  if (pageErrors.length > 0) {
    console.log('Uncaught page errors:');
    pageErrors.forEach(e => console.log('  - ' + e));
  }

  // Hard fail on any uncaught page error — those would have crashed
  // a real student's session.
  expect(pageErrors, 'Uncaught page errors:\n' + pageErrors.join('\n')).toHaveLength(0);
});
