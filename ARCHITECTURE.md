# Diet Planner — Architecture Map

## Stack
- Static HTML/CSS/JavaScript frontend; Vercel deployment configuration.
- Supabase Auth, Postgres, RLS, database functions/triggers, and Storage.
- `js/auth-access.js` initializes the shared Supabase client and exposes `window.DietPlannerAccess`.
- `js/theme.js` manages theme behavior. CSS assets live in `css/`; `npm run build:css` builds Tailwind CSS.

## Page/script map
- Auth/routing: `index.html` → `js/auth-access.js`
- Dashboard/admin: `app.html` → `js/app-dashboard.js`; `admin.html` → `js/admin.js`, `js/admin-roles.js`
- Patient records: `patient.html` → `js/patient.js`; `patient-profile.html` → `js/patient-profile.js`
- Visits: `visit.html` → `js/visit.js`, `js/visit-calculator.js`, `js/visit-diet-plan.js`, `js/visit-exchange-plan.js`
- Diet/calculation: `diet.html` → `js/diet.js`; `quickcalc.html` → `js/quickcalc.js`
- Food/recipes/products: `food.html` → `js/food.js`; `recipe.html` → `js/recipe.js`; `products.html` → `js/products.js`
- Finance/weight: `finance.html` → `js/finance.js`; `weight.html` → `js/weight.js`
- Nutrition support: `nutritionsupport.html` → `js/nutritionsupport.js`; `nutritionsupport-patient.html` → `js/nutritionsupport-patient.js`
- Subscriptions: `subscription_plans_index.html` → `js/subscription_plans_index.js`; `subscription_plans.html` → `js/subscription_plans.js`
- Other modules include profile, articles, feedback, notifications, about, and password recovery/update pages.

## Subscription/security flow
1. Auth helper routes admins and users with an active paid subscription to `app.html`; other signed-in users go to `subscription_plans_index.html`.
2. Subscription UI loads active plans and only the current user's subscriptions.
3. Paid requests upload proof to the private `subscription-proofs` bucket and call `create_subscription`; the database now verifies that the referenced proof exists in that bucket and belongs to the caller's own UID folder.
4. `create_subscription` uses an empty `search_path` and schema-qualified table references. It verifies that a paid-plan proof exists in the private bucket and belongs to the caller's UID folder.
5. The subscription-update trigger blocks users from changing entitlement snapshots (`is_free_trial`, duration, patient quota, and feature snapshot) while a request is pending, and validates ownership/existence when the proof path changes.
6. Direct table privileges for `trial_claims` have been revoked from `anon`, `authenticated`, and `PUBLIC`; trial claims are written by the controlled subscription function.
7. RLS, triggers, and database functions are the security boundary. Frontend checks are UX only.
8. The two subscription pages intentionally differ in redirects/navigation; do not merge them without regression tests.

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
