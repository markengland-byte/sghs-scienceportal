# Activating Google SSO — Switch-Flipping Guide

The code in `shared/portal-api.js`, `shared/portal-quiz.js`, and
`sol-prep/sol-api.js` is **SSO-ready but dormant**. Modules continue to
use the legacy honor-system name-modal flow until you flip the switch
below. Do this only after BCPS IT has approved external OAuth for
`@bcpsk12.com` student accounts.

## Step 1 — Apply the database migration

Run `migrations/002-sso-foundation.sql` in the Supabase SQL Editor.

This is non-destructive:
- adds `students` and `student_classes` tables
- adds nullable `student_id` columns to scores / quiz_detail / checkpoints / activity / dsm_attempts
- adds helper functions `get_student_id()` and `get_enrolled_class_ids()`
- adds self-scoped RLS for the new tables
- **does not touch existing INSERT policies** — legacy writes keep working

## Step 2 — Configure the Google OAuth provider in Supabase

1. Google Cloud Console → create a new OAuth 2.0 Client ID (Web app).
   Authorized redirect URIs:
   - `https://cogpsieldrgeqlemhosy.supabase.co/auth/v1/callback`
   - `http://localhost:54321/auth/v1/callback` (for local dev, optional)
2. Copy the Client ID + Client Secret.
3. Supabase Dashboard → Authentication → Providers → Google:
   - Enable
   - Paste Client ID and Client Secret
   - Set "Authorized Client IDs" to the same Client ID
4. Authentication → URL Configuration:
   - Site URL: `https://sghs-scienceportal.vercel.app`
   - Additional Redirect URLs: add localhost and any preview deploys
5. Optional but recommended: in the Google Cloud Console OAuth consent
   screen, set **User type = Internal** so only `@bcpsk12.com` accounts
   can complete the flow. The code also passes `hd=bcpsk12.com` as a
   hint, but the consent-screen restriction is the real enforcer.

## Step 3 — Enable SSO in the modules

On any module HTML page (or globally via a shared header), add this
above the `portal-quiz.js` script tag:

```html
<script>window.PORTAL_AUTH_MODE = 'sso';</script>
```

Modes:
- `'legacy'` (default) — current name-modal flow, no Google button
- `'sso'` — name input hidden, Google sign-in button only
- `'both'` — name input AND Google button (transition period)

For SOL prep pages (`practice-test.html`, `unit-N.html`), the equivalent
modal-injection logic lives inline in each page. Add a Google button
manually next to the name input and wire it to `solAPI.signInWithGoogle()`.
On page load, call `solAPI.initAuth().then(...)` to handle post-redirect
session pickup, mirroring `bootstrapSSO()` in `portal-quiz.js`.

## Step 4 — Apply Phase 2 RLS lockdown

Once SSO is active and at least one cohort has cut over, apply a
Phase 2 lockdown migration that tightens the INSERT policies:

```sql
-- Replace the class-scoped policies from 001-rls-lockdown.sql with
-- student-identity-scoped versions:
DROP POLICY IF EXISTS "Students insert scores for active classes" ON scores;
CREATE POLICY "Students insert own scores"
  ON scores FOR INSERT
  WITH CHECK (
    student_id = get_student_id()
    AND class_id IN (SELECT get_enrolled_class_ids())
  );
-- ... repeat for quiz_detail, checkpoints, activity, dsm_attempts
```

**Do NOT apply this until every module is on SSO** — the strict policy
will reject the legacy anonymous writes.

## Rolling back

To revert without dropping data, set `window.PORTAL_AUTH_MODE = 'legacy'`
(or remove the script line entirely) and the modules return to the
honor-system flow. Database rows already written with `student_id`
keep that linkage; legacy rows simply have NULL.

## Files involved

- `migrations/002-sso-foundation.sql` — schema additions
- `shared/portal-api.js` — `initAuth`, `signInWithGoogle`, `signOut`, `enrollInClass`, getters
- `shared/portal-quiz.js` — `injectGoogleSignIn`, `bootstrapSSO`
- `sol-prep/sol-api.js` — same SSO surface as portal-api.js
- `shared/login.html` — teacher login (unchanged; uses email/password)
