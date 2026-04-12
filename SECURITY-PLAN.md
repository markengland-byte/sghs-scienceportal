# SGHS Portal — FERPA Compliance & Security Hardening Plan

**Goal:** Make the portal IT-department-ready for school-wide/district-wide deployment. Zero concerns about student data protection, FERPA compliance, or unauthorized access.

**Current state:** Student data collected via honor-system name entry, Supabase anon key in client code (by design, but no RLS enforcement), hardcoded Apps Script password in git history, no privacy policy, no data retention, no audit trail.

---

## Phase 1: Google SSO — Verified Student Identity
**Priority: CRITICAL | Effort: 1 day | Eliminates: honor-system identity**

The biggest FERPA concern is that anyone can submit data as any student. Google Workspace SSO fixes this completely — students authenticate with their school Google account, and their identity is verified by the school's directory.

### 1A. Enable Google OAuth in Supabase
- Supabase Dashboard → Authentication → Providers → Google
- Create OAuth credentials in Google Cloud Console (school's Workspace admin)
- Restrict to school domain (`@bcpsk12.com`) so only school accounts can sign in
- Set redirect URL to `https://sghs-portal.vercel.app` (and localhost for dev)

### 1B. Create `students` table
```sql
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE NOT NULL,  -- links to Supabase auth.users
  email TEXT UNIQUE NOT NULL,          -- school email (from Google)
  display_name TEXT NOT NULL,          -- from Google profile
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_students_auth ON students(auth_user_id);
```

### 1C. Add `student_id` to all data tables
```sql
-- Add student_id column (nullable initially for backward compat with existing data)
ALTER TABLE scores ADD COLUMN student_id UUID REFERENCES students(id);
ALTER TABLE quiz_detail ADD COLUMN student_id UUID REFERENCES students(id);
ALTER TABLE checkpoints ADD COLUMN student_id UUID REFERENCES students(id);
ALTER TABLE activity ADD COLUMN student_id UUID REFERENCES students(id);

CREATE INDEX idx_scores_student_id ON scores(student_id);
CREATE INDEX idx_quiz_detail_student_id ON quiz_detail(student_id);
CREATE INDEX idx_checkpoints_student_id ON checkpoints(student_id);
CREATE INDEX idx_activity_student_id ON activity(student_id);
```

### 1D. Create `student_classes` enrollment table
```sql
CREATE TABLE student_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(student_id, class_id)
);
ALTER TABLE student_classes ENABLE ROW LEVEL SECURITY;
```

### 1E. Rewrite `shared/portal-api.js`
**Current:** Uses raw `fetch()` with anon key in `Authorization` header.
**New:** Uses Supabase JS client with authenticated session.

Key changes:
- Import Supabase JS client (already loaded for dashboard — reuse same CDN)
- `supabase.auth.signInWithOAuth({ provider: 'google' })` for login
- All API calls use the authenticated client (session token auto-attached)
- `student_id` populated from auth session, not typed name
- `student_name` still populated (from Google profile `display_name`) for teacher readability
- Class code validation unchanged, but enrollment recorded in `student_classes`

### 1F. Rewrite `shared/portal-quiz.js` name modal
**Current:** Text input for first + last name, optional class code.
**New:** "Sign in with Google" button → Google OAuth popup → auto-populate name from profile.

Flow:
1. Module loads → check `supabase.auth.getSession()`
2. If no session → show modal with "Sign in with Google" button + class code field
3. Student clicks → Google OAuth popup → returns to module with session
4. Auto-create student record if first login (`students` table)
5. If class code entered → create `student_classes` enrollment
6. Name comes from Google profile (no manual entry)
7. If session exists → check enrollment → skip modal (auto-resume)

### 1G. Update `sol-prep/sol-api.js`
Same changes as portal-api.js — use authenticated Supabase client instead of raw REST with anon key.

**What this achieves:**
- Every student has a verified school identity (Google account)
- No one can submit data as another student
- Student names come from the school directory, not self-reported
- Session-based auth replaces anonymous access

---

## Phase 2: RLS Lockdown — Data Access Control
**Priority: CRITICAL | Effort: 0.5 day | Eliminates: unauthorized data access**

### 2A. Apply Phase 2 migration
The `sol-prep/phase2-migration.sql` already has teacher-scoped RLS policies. Apply it to production, then add student-scoped policies.

### 2B. New RLS policies (replace all temp "allow all" policies)

```sql
-- Helper: get student's own student_id
CREATE OR REPLACE FUNCTION get_student_id() RETURNS UUID AS $$
  SELECT id FROM students WHERE auth_user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: get student's enrolled class IDs
CREATE OR REPLACE FUNCTION get_enrolled_class_ids() RETURNS SETOF UUID AS $$
  SELECT class_id FROM student_classes
  WHERE student_id = (SELECT id FROM students WHERE auth_user_id = auth.uid());
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── STUDENTS table ──
CREATE POLICY "Students read own profile"
  ON students FOR SELECT USING (auth_user_id = auth.uid());
CREATE POLICY "Auto-create on first login"
  ON students FOR INSERT WITH CHECK (auth_user_id = auth.uid());

-- ── STUDENT_CLASSES table ──
CREATE POLICY "Students manage own enrollments"
  ON student_classes FOR INSERT
  WITH CHECK (student_id = get_student_id());
CREATE POLICY "Students see own enrollments"
  ON student_classes FOR SELECT
  USING (student_id = get_student_id());
CREATE POLICY "Teachers see class enrollments"
  ON student_classes FOR SELECT
  USING (class_id IN (SELECT get_my_class_ids()));

-- ── SCORES table ──
DROP POLICY IF EXISTS "Students can submit scores" ON scores;
DROP POLICY IF EXISTS "Temp: allow reading scores" ON scores;

CREATE POLICY "Students insert own scores"
  ON scores FOR INSERT
  WITH CHECK (
    student_id = get_student_id()
    AND class_id IN (SELECT get_enrolled_class_ids())
  );
CREATE POLICY "Students read own scores"
  ON scores FOR SELECT
  USING (student_id = get_student_id());
CREATE POLICY "Teachers read class scores"
  ON scores FOR SELECT
  USING (class_id IN (SELECT get_my_class_ids()));
CREATE POLICY "Admins read all scores"
  ON scores FOR SELECT USING (is_admin());

-- ── QUIZ_DETAIL table ──
DROP POLICY IF EXISTS "Students can submit quiz detail" ON quiz_detail;
DROP POLICY IF EXISTS "Temp: allow reading quiz detail" ON quiz_detail;

CREATE POLICY "Students insert own quiz detail"
  ON quiz_detail FOR INSERT
  WITH CHECK (
    student_id = get_student_id()
    AND class_id IN (SELECT get_enrolled_class_ids())
  );
CREATE POLICY "Students read own quiz detail"
  ON quiz_detail FOR SELECT
  USING (student_id = get_student_id());
CREATE POLICY "Teachers read class quiz detail"
  ON quiz_detail FOR SELECT
  USING (class_id IN (SELECT get_my_class_ids()));

-- ── CHECKPOINTS table ──
DROP POLICY IF EXISTS "Students can submit checkpoints" ON checkpoints;
DROP POLICY IF EXISTS "Temp: allow reading checkpoints" ON checkpoints;

CREATE POLICY "Students insert own checkpoints"
  ON checkpoints FOR INSERT
  WITH CHECK (
    student_id = get_student_id()
    AND class_id IN (SELECT get_enrolled_class_ids())
  );
CREATE POLICY "Teachers read class checkpoints"
  ON checkpoints FOR SELECT
  USING (class_id IN (SELECT get_my_class_ids()));

-- ── ACTIVITY table ──
DROP POLICY IF EXISTS "Students can log activity" ON activity;
DROP POLICY IF EXISTS "Temp: allow reading activity" ON activity;

CREATE POLICY "Students insert own activity"
  ON activity FOR INSERT
  WITH CHECK (
    student_id = get_student_id()
    AND class_id IN (SELECT get_enrolled_class_ids())
  );
CREATE POLICY "Teachers read class activity"
  ON activity FOR SELECT
  USING (class_id IN (SELECT get_my_class_ids()));

-- ── CLASSES table (keep public read for code validation, but limit fields) ──
-- Already has: "Anyone can validate class codes" with is_active = true
-- This is fine — class codes are designed to be shared with students
```

**What this achieves:**
- Students can ONLY insert data tied to their own authenticated identity
- Students can ONLY insert into classes they're enrolled in
- Teachers can ONLY see data from their own classes
- Admins can see everything
- No anonymous writes — every row has a verified student_id
- Cross-class data leakage eliminated

---

## Phase 3: Credential Cleanup & Git Scrub
**Priority: CRITICAL | Effort: 0.5 day | Eliminates: exposed credentials**

### 3A. Remove Apps Script password from code
- Delete or blank out `DASHBOARD_PASSWORD = 'sghs2026'` in `apps-script-tracking.js`
- This file is legacy (Google Sheets fallback) — the Supabase migration already happened
- Consider deleting the entire file if Apps Script is no longer used

### 3B. Remove Apps Script URLs from all modules
- The `appsScriptUrl` in `MODULE_CONFIG` is legacy — Supabase is the sole backend now
- Update `build_module.py` to stop generating `appsScriptUrl` in MODULE_CONFIG
- Remove from all 96+ module HTML files (scripted find-and-replace)
- Update `portal-quiz.js` to remove any Apps Script fallback code

### 3C. Update `.gitignore`
```gitignore
# Existing entries...

# Environment files
.env
.env.local
.env.production

# Sensitive configs
*.secret
credentials/

# IDE
.vscode/
.idea/

# OS files
.DS_Store
Thumbs.db
```

### 3D. Scrub git history
Use `git filter-repo` (or BFG Repo Cleaner) to remove:
- The password `sghs2026` from all historical commits
- Any `.env` files if ever committed
- The Apps Script tracking file history

```bash
# Install BFG
# Then:
bfg --replace-text passwords.txt  # file containing 'sghs2026' → '***REMOVED***'
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push --force  # requires coordination — only one contributor
```

### 3E. Rotate Supabase anon key (optional but recommended)
- Generate new anon key in Supabase dashboard
- Update the 4 files that reference it (portal-api.js, sol-api.js, login.html x2, dashboard.html x2)
- Old key immediately invalidated

**Note:** The Supabase anon key is *designed* to be in client-side code. It's safe as long as RLS is enforced (Phase 2). This is how every Supabase app works. But rotating after the RLS lockdown is good hygiene.

---

## Phase 4: Security Headers & Hardening
**Priority: HIGH | Effort: 0.5 day | Eliminates: script injection, CDN tampering**

### 4A. Add CSP and security headers to `vercel.json`
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-DNS-Prefetch-Control", "value": "off" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://cogpsieldrgeqlemhosy.supabase.co; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://cogpsieldrgeqlemhosy.supabase.co https://*.libretexts.org; connect-src 'self' https://cogpsieldrgeqlemhosy.supabase.co https://accounts.google.com; frame-src https://accounts.google.com;"
        }
      ]
    }
  ]
}
```

### 4B. Add SRI hashes to CDN scripts
For every `<script src="https://cdn...">` and `<link href="https://cdn...">` in dashboard/login pages:
- Generate SRI hash: `shasum -b -a 384 chart.umd.min.js | awk '{ print $1 }' | xxd -r -p | base64`
- Add `integrity="sha384-..." crossorigin="anonymous"` attributes
- This prevents CDN compromise from injecting malicious code

### 4C. Session timeout
- Add session expiry check in portal-api.js
- Supabase sessions have configurable JWT expiry (default 1 hour, refresh token extends)
- Set reasonable timeout: 8 hours (school day) with auto-refresh
- On expiry: clear localStorage, show "Session expired — sign in again"

### 4D. Input sanitization
- Sanitize any user-provided text before display (checkpoint responses in dashboard)
- The dashboard already uses an `esc()` function for HTML escaping — verify coverage
- Ensure no `innerHTML` with unsanitized student data

---

## Phase 5: FERPA Documentation & Policies
**Priority: HIGH | Effort: 1 day | Eliminates: compliance documentation gaps**

### 5A. Privacy Policy page (`/privacy.html`)
Required content:
- What student data is collected (names, email, scores, quiz responses, activity timestamps)
- Why it's collected (educational assessment, progress tracking)
- Who can access it (assigned teacher, school admin, parent/guardian on request)
- Where it's stored (Supabase — US region, AWS infrastructure)
- How long it's retained (see 5C)
- How to request data deletion
- How to request data export (parent right under FERPA)
- Contact information for data inquiries
- Link from main portal footer

### 5B. Terms of Use page (`/terms.html`)
- Acceptable use policy
- Student responsibilities
- Teacher/admin responsibilities
- Data ownership (school owns student data)
- Third-party services used (Supabase, Vercel, Google OAuth)

### 5C. Data Retention Policy
- Student data retained for current school year + 1 year archive
- Automated purge of data older than retention period
- Implementation: Supabase scheduled function or cron job
  ```sql
  -- Annual cleanup (run at end of school year)
  DELETE FROM activity WHERE created_at < NOW() - INTERVAL '2 years';
  DELETE FROM quiz_detail WHERE created_at < NOW() - INTERVAL '2 years';
  DELETE FROM checkpoints WHERE created_at < NOW() - INTERVAL '2 years';
  DELETE FROM scores WHERE created_at < NOW() - INTERVAL '2 years';
  ```
- Teacher can request early deletion of specific student data
- Document the schedule and process

### 5D. Data Inventory Document
A simple document for IT review:
| Data Element | Source | Storage | Access | Retention |
|---|---|---|---|---|
| Student name | Google Workspace profile | Supabase (US) | Teacher, Admin | School year + 1 yr |
| Student email | Google Workspace | Supabase (US) | System only (auth) | Until account deleted |
| Quiz scores | Student submission | Supabase (US) | Student, Teacher, Admin, Parent | School year + 1 yr |
| Quiz responses | Student submission | Supabase (US) | Teacher, Admin | School year + 1 yr |
| Checkpoint text | Student written response | Supabase (US) | Teacher, Admin | School year + 1 yr |
| Activity logs | Automatic tracking | Supabase (US) | Teacher, Admin | School year + 1 yr |
| Session data | Browser | localStorage (device) | Student only | 30-day expiry |

### 5E. Supabase Data Processing Agreement
- Supabase offers a DPA for FERPA/COPPA compliance
- Request and sign via Supabase dashboard or support
- Keep on file for IT review
- Document: Supabase uses AWS us-east-1/us-west-1, SOC 2 Type II certified

---

## Phase 6: Audit Logging & Admin Controls
**Priority: MEDIUM | Effort: 1 day | Eliminates: access audit gaps**

### 6A. `access_logs` table
```sql
CREATE TABLE access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,          -- auth.uid() of who accessed
  user_role TEXT NOT NULL,         -- 'teacher', 'admin', 'parent'
  action TEXT NOT NULL,            -- 'view_scores', 'view_quiz_detail', 'export_csv', etc.
  target_class_id UUID,           -- which class data was accessed
  target_student_id UUID,         -- specific student (if applicable)
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE access_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Only admins read access logs"
  ON access_logs FOR SELECT USING (is_admin());
CREATE POLICY "Authenticated users insert own logs"
  ON access_logs FOR INSERT WITH CHECK (user_id = auth.uid()::UUID);
```

### 6B. Dashboard access logging
- Log every teacher dashboard page load with class context
- Log every CSV export
- Log every student data view
- Implement in dashboard.html JavaScript — call Supabase insert on each data access

### 6C. Data export for parents
- Add "Export My Child's Data" button (future parent portal)
- Generates JSON/CSV of all student data for a given student_id
- FERPA requires parents can inspect records — this satisfies that right

### 6D. Data deletion on request
- Admin function to delete all data for a specific student
- Cascades through scores, quiz_detail, checkpoints, activity
- Logs the deletion in access_logs
- Required for FERPA "right to request amendment"

### 6E. Teacher dashboard: student data management
- Add "Delete Student Data" action in dashboard (admin only)
- Add "Export Student Data" action (CSV download for a single student)
- Both actions logged in access_logs

---

## Phase 7: Parent Access (Future)
**Priority: LOW | Effort: 2 days | Eliminates: parent access concerns**

This can be deferred — the mySchool LMS already has a parent portal. For the SGHS portal specifically:

### 7A. Parent authentication
- Parents sign in with Google (personal or school-provided account)
- Admin links parent to student(s) via dashboard
- Parent sees read-only view of linked student's data

### 7B. Parent view
- Scores summary by module
- Quiz performance
- Activity timeline
- No editing capability

*This phase can wait until there's actual demand from parents.*

---

## Implementation Order

| Step | Phase | What | Time | Blocks |
|------|-------|------|------|--------|
| 1 | 2A | Apply Phase 2 RLS migration to production Supabase | 30 min | Nothing |
| 2 | 3A-3B | Remove Apps Script password + URLs from code | 1 hour | Nothing |
| 3 | 3C | Update .gitignore | 5 min | Nothing |
| 4 | 1A | Enable Google OAuth in Supabase (requires school admin) | 30 min | School admin access |
| 5 | 1B-1D | Create students + student_classes tables, add student_id columns | 30 min | Step 4 |
| 6 | 1E-1G | Rewrite portal-api.js and sol-api.js for authenticated Supabase | 3 hours | Step 5 |
| 7 | 1F | Rewrite portal-quiz.js name modal → Google SSO | 2 hours | Step 6 |
| 8 | 2B | Deploy new RLS policies (student-scoped) | 30 min | Step 5 |
| 9 | 4A-4B | Security headers + SRI in vercel.json | 1 hour | Nothing |
| 10 | 4C-4D | Session timeout + input sanitization | 1 hour | Step 6 |
| 11 | 5A-5B | Privacy policy + Terms of Use pages | 2 hours | Nothing |
| 12 | 5C-5E | Data retention policy + inventory + DPA | 2 hours | Nothing |
| 13 | 3D | Git history scrub (do LAST — force push) | 30 min | All code changes done |
| 14 | 6A-6E | Audit logging + admin controls | 4 hours | Step 8 |

**Total estimated effort: ~2-3 days of implementation**

Steps 1-3 can be done immediately (today).
Steps 4-8 are the core SSO + RLS work (1 day).
Steps 9-12 are hardening + documentation (1 day).
Steps 13-14 are cleanup + audit (0.5 day).

---

## What IT Gets to Review

After implementation, you can present:

1. **Student authentication:** Google Workspace SSO — verified school identity
2. **Access control:** Row Level Security — teachers see only their classes, students see only their own data
3. **Data encryption:** HTTPS everywhere (Supabase + Vercel), encrypted at rest (Supabase/AWS)
4. **Data residency:** US region (Supabase on AWS)
5. **Data retention:** Defined policy with automated purge
6. **Audit trail:** All data access logged with user, action, timestamp
7. **Privacy policy:** Published on site, describes all data practices
8. **Vendor assessment:** Supabase DPA signed, SOC 2 Type II certified
9. **Security headers:** CSP, X-Frame-Options, SRI on external scripts
10. **No hardcoded credentials:** Git history cleaned
11. **Parent rights:** Data export available on request (FERPA compliance)
12. **Incident response:** Contact info + process documented in privacy policy

---

## What Does NOT Change

- **Supabase anon key stays in client-side code** — this is by design. Supabase's entire security model is RLS + anon key. The key is safe because RLS policies control what each user can do. This is how every Supabase app (including production apps with millions of users) works. Hiding the anon key provides zero additional security.
- **Static HTML architecture** — no server-side rendering needed. The security comes from Supabase Auth + RLS, not from a backend server.
- **Module content delivery** — quiz questions, content, images all remain static HTML. Only student data submission goes through authenticated Supabase.
- **Teacher dashboard** — already uses Supabase Auth. Just needs RLS policy enforcement + audit logging.
