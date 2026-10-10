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
3. Paid requests upload proof to the private `subscription-proofs` bucket and call `create_subscription`; backend logic validates eligibility and records free-trial claims.
4. RLS, triggers, and database functions are the security boundary. Frontend checks are UX only.
5. The two subscription pages intentionally differ in redirects/navigation; do not merge them without regression tests.

## Known release risks
- Security Advisor still flags callable `SECURITY DEFINER` RPCs and disabled leaked-password protection.
- `trial_claims` has RLS enabled with no direct policies; this appears intentional only if access remains inside validated database functions.
- No automated test suite is configured in `package.json`; run manual tests before release.

## Smoke tests
- Password login, registration, Google OAuth callback, logout, and role routing.
- Admin role change; a normal user cannot self-promote.
- First free trial, duplicate trial, and trial when the plan is inactive.
- Payment-proof upload: JPEG/PNG/WebP only, maximum 5 MB; failed RPC cleanup; admin approval and expiry.
- Patient quota, patient/visit access after subscription expiry, and cross-account isolation.
- Diet, visit, finance, and nutrition-support workflows with active and expired subscriptions.
