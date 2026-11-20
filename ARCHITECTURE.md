# Diet Planner — Architecture Map

## Stack
- Static HTML/CSS/JavaScript frontend; Vercel deployment configuration.
- Supabase Auth, Postgres, RLS, database functions/triggers, and Storage.
- `js/auth-access.js` initializes the shared Supabase client and exposes `window.DietPlannerAccess`.
- `js/theme.js` manages theme behavior. CSS assets live in `css/`; `npm run build:css` builds Tailwind CSS.

## Shared application shell
- `js/app-header.js` owns the single branded application header and navigation for application pages.
- `css/app-header.css` owns its shared responsive presentation; each page contains only a `data-dp-app-header` mount point.
- Page-specific header controls are retained in a `data-dp-page-actions` slot and moved into the shared header at mount time, preserving their existing element IDs and event bindings.
- Authentication/recovery pages (`login.html`, `forgot-password.html`, `update-password.html`) remain outside the application shell. Embedded visit and nutrition-support views suppress the shell when `?embed=1` is active.

## Page/script map
- Public entry/auth routing: `index.html` → `js/auth-access.js`; authenticated dashboard routing is handled by `js/auth-access.js`.
- Main dashboard: `app.html` → `js/auth-access.js`, `js/app-dashboard.js`; `index.html` also contains a public-facing dashboard/entry layout and loads the dashboard script. Keep their routing and access behavior distinct unless regression-tested.
- Admin: `admin.html` → `js/admin.js`, `js/admin-roles.js`
- Patient records: `patient.html` → `js/patient.js`; `patient-profile.html` → `js/patient-profile.js`
- Visits: `visit.html` → `js/visit.js`, `js/visit-calculator.js`, `js/visit-diet-plan.js`, `js/visit-exchange-plan.js`
- Diet/calculation: `diet.html` → `js/diet.js`; `quickcalc.html` → `js/quickcalc.js`
- Food/recipes/products: `food.html` → `js/food.js`; `recipe.html` → `js/recipe.js`; `products.html` → `js/products.js`
- Finance/weight: `finance.html` → `js/finance.js`; the repository's standalone weight page uses the Arabic-named `weightم.html`, `css/weightم.css`, and `js/weightم.js`.
- Nutrition support: the standalone `nutritionsupport.html` page is retained temporarily but is no longer exposed in shared navigation; patient-linked nutrition support remains in `nutritionsupport-patient.html` → `js/nutritionsupport-patient.js`.
- Subscriptions: plans and subscription actions are presented inside `profile.html` using `js/profile.js` and `js/subscription_plansم.js`.
- Other modules include profile, articles, feedback, notifications, about, and password recovery/update pages.

## Subscription/security flow
1. The public dashboard remains accessible; subscription plans and subscription actions are managed from `profile.html`.
2. Subscription UI loads active plans and only the current user's subscriptions.
3. Paid requests upload proof to the private `subscription-proofs` bucket and call `create_subscription`; the database now verifies that the referenced proof exists in that bucket and belongs to the caller's own UID folder.
4. `create_subscription` uses an empty `search_path` and schema-qualified table references. It verifies that a paid-plan proof exists in the private bucket and belongs to the caller's UID folder.
5. The subscription-update trigger blocks users from changing entitlement snapshots (`is_free_trial`, duration, patient quota, and feature snapshot) while a request is pending, and validates ownership/existence when the proof path changes.
6. Direct table privileges for `trial_claims` have been revoked from `anon`, `authenticated`, and `PUBLIC`; trial claims are written by the controlled subscription function.
7. RLS, triggers, and database functions are the security boundary. Frontend checks are UX only.
8. There is one subscription-plan interface in `profile.html`; keep subscription actions in the shared subscription module rather than recreating a standalone plans page.

## Known release risks
- Security Advisor still flags callable `SECURITY DEFINER` RPCs. Several are intentionally callable by authenticated users and contain authorization checks, but they still require ongoing review.
- Leaked-password protection remains disabled in Supabase Auth and must be enabled in project Auth settings.
- `trial_claims` has RLS enabled with no direct policies; direct table grants are revoked, so access should remain through validated database functions only.
- No automated test suite is configured in `package.json`; run manual tests before release. The changes above have been checked in database metadata, but no authenticated end-to-end browser test has been run.

## Smoke tests
- Password login, registration, Google OAuth callback, logout, and role routing.
- Admin role change; a normal user cannot self-promote.
- First free trial, duplicate trial, and trial when the plan is inactive.
- Payment-proof upload: JPEG/PNG/WebP only, maximum 5 MB; reject another user's path and nonexistent objects; failed RPC cleanup; admin approval and expiry.
- Patient quota, patient/visit access after subscription expiry, and cross-account isolation.
- Diet, visit, finance, and nutrition-support workflows with active and expired subscriptions.
