# SGHS Portal — SSO Activation Plan

**Status:** design, pending review
**Author:** Mark + Claude
**Date:** 2026-04-29

---

## Why this document exists

The earlier `migrations/002-sso-activation.md` was written when student SSO was theoretical and BCPS IT approval was assumed to be the gating factor. Two things have changed:

1. **2026-04-29:** Student SSO confirmed working end-to-end. Stage A (staff) and Stage B (one student on a Chromebook) both signed in successfully via Google Cloud project "SGHS Portal" → Internal-audience OAuth → Supabase Auth → portal redirect. The technical channel is open; no IT approval blocks it. (Notify IT for FERPA paperwork, but it's not a gate.)

2. **The 002 plan was based on a broken RLS pattern.** Step 4 of `002-sso-activation.md` proposes:
   ```sql
   WITH CHECK (
     student_id = get_student_id()
     AND class_id IN (SELECT get_enrolled_class_ids())
   )
   ```
   That cross-table subquery to `student_classes` is the same shape that triggered phantom-state on 5 tables this session. **Do not use it.** This plan supersedes that approach.

The audit's Option 3 (full backend mediation, ~12-25 hrs) was the right answer if SSO was unavailable for students. With SSO confirmed, the much smaller Option 2-light is correct.

---

## The architecture in one paragraph

Students authenticate via Google (`@bcpsk12.com` only, enforced by Internal Workspace audience). Their identity becomes a real Supabase Auth UUID instead of a typed name. Every write table gets a denormalized `auth_user_id` column. RLS is reduced to one self-contained pattern: `WITH CHECK (auth_user_id = auth.uid())` for inserts, `USING (auth_user_id = auth.uid())` for student reads. **No cross-table subqueries anywhere in RLS.** Teacher dashboard reads route through ~4 serverless endpoints that verify the teacher's JWT, then query with the service-role key — bypassing RLS entirely for the teacher path. The legacy name-modal flow stays in place behind a per-class `requires_sso` flag for safe gradual rollout.

---

## Schema changes (Phase 2 RLS lockdown — done right)

### New columns (denormalized for self-contained RLS)

Add `auth_user_id UUID` to every write table. **Nullable initially** so legacy writes keep working during the transition; flipped to `NOT NULL` only after backfill + cutover.

```sql
ALTER TABLE scores       ADD COLUMN IF NOT EXISTS auth_user_id UUID;
ALTER TABLE quiz_detail  ADD COLUMN IF NOT EXISTS auth_user_id UUID;
ALTER TABLE checkpoints  ADD COLUMN IF NOT EXISTS auth_user_id UUID;
ALTER TABLE activity     ADD COLUMN IF NOT EXISTS auth_user_id UUID;
ALTER TABLE dsm_attempts ADD COLUMN IF NOT EXISTS auth_user_id UUID;

CREATE INDEX IF NOT EXISTS idx_scores_auth_user       ON scores(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_detail_auth_user  ON quiz_detail(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_auth_user  ON checkpoints(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_activity_auth_user     ON activity(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_dsm_attempts_auth_user ON dsm_attempts(auth_user_id);
```

### Per-class rollout flag

```sql
ALTER TABLE classes ADD COLUMN IF NOT EXISTS requires_sso BOOLEAN NOT NULL DEFAULT false;
```

When `requires_sso = false`, the class still accepts legacy writes. When `true`, only SSO writes are accepted. Allows pilot in one class before global cutover.

### Final RLS shape (post-cutover)

```sql
-- Drop the wide-open nuclear-cycle policies first.
DROP POLICY "scores_insert_any"  ON scores;
DROP POLICY "scores_select_any"  ON scores;
-- ... and the same for the other 4 tables.

-- Student writes — self-contained, no subqueries.
CREATE POLICY "scores_insert_self" ON scores FOR INSERT
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY "scores_select_self" ON scores FOR SELECT
  USING (auth_user_id = auth.uid());

-- ... same shape for quiz_detail, checkpoints, activity, dsm_attempts.

-- NO teacher-read RLS policies. Teachers don't read these tables directly.
-- They go through serverless endpoints (see "Teacher reads" below).
```

This is the entire RLS surface — about 10 policies total across the 5 tables, all keyed on `auth.uid()`.

---

## Login flow change

**Before:** unit page loads → name modal asks for First + Last → student types name → writes go straight to Supabase as anon-bearer.

**After:** unit page loads → checks Supabase session → if no session, shows "Sign in with Google" button → after sign-in, captures `auth.uid()` and `user.user_metadata.full_name` → writes go to Supabase with `auth_user_id` populated → RLS validates the identity automatically.

The plumbing for this is already in `solAPI` — `initAuth`, `signInWithGoogle`, `signOut`, plus the existing `_session` state variable that `_rest()` already uses to set the Authorization header. The work is in the unit pages: replace the name-modal HTML/JS with a sign-in-button HTML/JS path, and pass `auth_user_id` into every `submit()` payload.

---

## Teacher reads (the only piece of "backend mediation")

Teachers can't read scores via RLS because the data isn't theirs. Three options for teacher reads, in increasing-correctness order:

1. **Service-role-key serverless functions** (recommended). Pattern matches the auth fix in [api/generate-dsm.js](../api/generate-dsm.js) from Phase A. Each endpoint:
   - Verifies the teacher's JWT via `/auth/v1/user`
   - Looks up `teachers` row to confirm the caller is a teacher
   - Queries the data tables with the service-role key (bypasses RLS)
   - Returns scoped to teacher's classes

   Endpoints needed:
   - `GET /api/teacher/scores?class_id=...` — gradebook source
   - `GET /api/teacher/activity?class_id=...&since=...` — Live Pulse + Activity tab
   - `GET /api/teacher/checkpoints?class_id=...` — checkpoint review
   - `GET /api/teacher/quiz-detail?class_id=...&module=...` — drill-down

   ~4 endpoints, ~80 lines each.

2. **Per-teacher RLS using a join into `classes.teacher_id`.** Tempting but uses a cross-table subquery — exactly what we're trying to avoid. Skip.

3. **Materialized view per teacher.** Refresh on a cron, RLS the view by teacher. Over-engineered for this scale; skip.

---

## Sequencing — six evenings

Each step is independently revertable. Evening 1 ships first; if it goes badly we stop and reassess.

### Evening 1 — Schema additions (non-destructive)

Write `migrations/003-sso-schema.sql` adding the `auth_user_id` columns + indexes + `classes.requires_sso`. Apply in Supabase SQL Editor. Verify nothing broke (legacy writes still succeed).

**Risk:** zero. New nullable columns + indexes. Cannot break existing flow.

### Evening 2 — Activate SSO in unit-1 only (pilot)

- Add Google sign-in button to `unit-1.html` next to (or replacing) the name modal
- On sign-in completion, populate `solAPI._session` and `solAPI._authUserId` (new field)
- `solAPI.submit()` includes `auth_user_id: _authUserId` in every write payload
- Deploy. Test in incognito with Mark's account first, then with the same student who tested SSO.
- Verify: unit-1 scores rows have `auth_user_id` populated; legacy unit-2-8 still writing fine.

**Risk:** low. Only unit-1 changes. Other 7 unit pages keep working.

### Evening 3 — Roll out SSO to all 8 unit pages + practice-test

Use one final propagation script in `sol-prep/build-temp/` to copy the unit-1 SSO wiring across the others. (Last propagation script before Phase D extracts the unit engine.)

**Risk:** low. The pattern is proven from Evening 2.

### Evening 4 — Backfill + lockdown migration

- Backfill `auth_user_id` on existing rows where possible (join `students.email` to scores' `student_name`, populate where match is unambiguous; leave NULL where ambiguous). Document data-quality decisions in the migration.
- Apply Phase 2 RLS lockdown migration (the policies above).
- This is the destructive step — once applied, anonymous writes to these 5 tables stop working.
- Apply per-class via `classes.requires_sso = true` for pilot class first (ENG-1?), then sweep through ENG-2..ENG-7 over the following week as each class proves stable.

**Risk:** medium. Legacy writes start being rejected. Pilot in one class first; backout = `UPDATE classes SET requires_sso = false`.

### Evening 5 — Teacher read endpoints

Build the 4 `/api/teacher/*` endpoints. Wire dashboard to call them instead of querying Supabase REST directly.

**Risk:** low. Teacher dashboard isn't student-facing; bugs here don't affect class.

### Evening 6 — Cleanup

- Remove name-modal HTML/JS from unit pages (replaced by SSO button)
- Remove `solAPI.canonicalizeName` (no longer needed — Google provides canonical email/name)
- Remove the two-field name input
- Mark `PORTAL_AUTH_MODE = 'legacy'` deprecated in code comments
- Update `SECURITY-PLAN.md`, this doc, and memory

**Risk:** zero. Pure deletion of code paths no longer reachable.

---

## Backout plan

At any point during Evening 4-6, if students hit blockers:

1. Set `requires_sso = false` on the affected class. Students fall back to legacy name modal.
2. Rows already written with `auth_user_id` keep that linkage — no data loss.
3. RLS policies stay in place but become permissive for `auth_user_id IS NULL` rows (the legacy path).

If something goes wrong in Evening 5+ (teacher endpoints), the dashboard might break for a class period. Mitigation: deploy on Friday afternoon, monitor over weekend, ready to revert before Monday.

---

## Open questions for Mark

1. **What email format do students log in with?** `firstname.lastname@bcpsk12.com`? Need to know to backfill `auth_user_id` against existing `student_name` rows where possible.

2. **Are student Chromebooks auto-signed-in to BCPS Workspace, or do they sign in fresh each session?** Affects whether the SSO redirect is invisible (auto-pickup) or adds 2-3 clicks per session.

3. **Teacher SSO too?** The dashboard currently uses email/password login (`shared/login.html`). Should teachers ALSO migrate to Google SSO at the same time, or stay on legacy until later? Recommendation: migrate at Evening 5 since you're already touching the auth surface.

4. **What happens to the existing `students` and `student_classes` tables from `aa76966`?** They were the original Phase 1 SSO design. With this denormalized approach, do we still need them? `students` is still useful as a registry (display_name, email lookup); `student_classes` may be superseded by inferring enrollment from `scores.class_id` activity.

5. **Pilot class choice?** ENG-1 (first period of the day, lets you watch the rollout in real time)? Or ENG-7 (last period, lower stakes if it breaks)?

6. **Notify BCPS IT — when?** Suggest doing this Evening 1 (after schema migration). Email format: "FYI, SGHS Portal student auth now uses Google OAuth via Supabase, scoped to @bcpsk12.com Internal-audience Workspace app. FERPA data flow: [brief description]. No action needed from your end; documenting for the record."

---

## What this plan does NOT do

- **No backend mediation for student writes.** Auth is solved by Google + RLS-on-auth-uid. Adding a writes-API would be over-engineering at this scale.
- **No HMAC-signed tokens, custom JWT, or session management code.** Supabase Auth handles all of it.
- **No FERPA Phase 6 (audit logging).** Separate work, do later.
- **No Phase D (unit-engine extraction).** Should happen after this lands. Doing them in the wrong order means refactoring 8 unit pages twice.

---

## Effort estimate

| Phase | Hours |
|-------|-------|
| Evening 1 — Schema | 1-2 |
| Evening 2 — unit-1 pilot | 3-4 |
| Evening 3 — Propagate | 1-2 |
| Evening 4 — Backfill + lockdown | 2-3 |
| Evening 5 — Teacher endpoints | 3-4 |
| Evening 6 — Cleanup | 1-2 |
| **Total** | **11-17 hrs** |

Compared to audit Option 3's 12-25 hrs, this saves ~5-8 hours AND avoids building a custom auth system. Compared to "do nothing," this gets the portal to FERPA-respectable RLS without breaking the no-build-step constraint.

---

## Decision needed before Evening 1

- Do you accept this plan?
- Pilot class for Evening 4? (ENG-1 vs ENG-7)
- Teacher SSO at Evening 5, or keep email/password until later?

Once those three are answered, we can ship Evening 1 in ~90 minutes.
