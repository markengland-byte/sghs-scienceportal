# `shared/` — what lives here, what's canonical

This folder holds shared client-side modules used by the **non-SOL** content
surfaces (Biology / AP / Physics interactive lecture modules) plus a
common login/dashboard pair that originally served them.

## Canonical paths

| Surface | Live path | Notes |
|---|---|---|
| **Teacher dashboard** | `../sol-prep/dashboard.html` | The single live dashboard. Has Live Pulse, Gradebook, module releases, mastery threshold, DSM publishing, teacher endpoints — everything. |
| **Teacher login** | `./login.html` *and* `../sol-prep/login.html` | Both work. Both wired to Google SSO + email/password. They redirect to the canonical dashboard above. |
| **Student-facing API helper (Bio/AP/Phys)** | `./portal-api.js` | Used by lesson HTMLs under `biology/`, `ap/`, `physics/`. |
| **Student-facing quiz engine (Bio/AP/Phys)** | `./portal-quiz.js` | Renders inline quizzes inside the lesson modules. |
| **SOL-Prep API helper** | `../sol-prep/sol-api.js` | Separate from `portal-api.js`. Same Supabase project, different localStorage key (`sol_class` vs `portal_class`). |
| **SOL-Prep DSM player** | `../sol-prep/dsm-player.js` | Mastery Module engine, used only by the SOL-prep unit pages. |

## What was here previously

- `shared/dashboard.html` — **superseded** by `sol-prep/dashboard.html`. The
  current `shared/dashboard.html` is now a small redirect page so any
  bookmarks pointing to it bounce users to the live dashboard. Don't add
  features to it; do not symlink.

## When in doubt

If you're editing the dashboard, edit `sol-prep/dashboard.html`.

If you're adding a new shared client module, put it here and require it
from both `sol-prep/` and `biology/`/`ap/`/`physics/` HTML files.

If you're touching auth, edit BOTH `sol-prep/login.html` AND
`shared/login.html` — they're independently linked and both need to stay
in sync. The audit's recommendation is to consolidate eventually; for
now they coexist.
