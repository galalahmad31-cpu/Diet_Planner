# Frontend Architecture — Diet Planner

## Purpose
Keep the existing static HTML/CSS/JavaScript architecture stable while making shared behavior explicit and reducing page-to-page drift. Refactoring should be incremental; do not migrate frameworks or redesign all pages in one pass.

## Target structure

```text
/
├── index.html                       # Authentication and entry routing
├── app.html                         # Main dashboard / navigation
├── [feature].html                   # One HTML entry per feature
├── css/
│   ├── tailwind-input.css           # Tailwind source and content configuration
│   ├── tailwind.css                 # Generated output; rebuild, don't hand-edit
│   ├── theme.css                   # Global design tokens and theme overrides
│   └── [feature].css                # Feature-specific layout only
├── js/
│   ├── auth-access.js               # Shared Supabase/auth/access bootstrap
│   ├── theme.js                     # Theme preference and switching
│   ├── shared/
│   │   └── security.js              # Shared escaping and rich-HTML sanitization
│   ├── features/
│   │   ├── about/
│   │   │   └── index.js              # About page
│   │   ├── admin/
│   │   │   ├── dashboard.js          # Admin tools
│   │   │   └── roles.js              # Admin role controls
│   │   ├── content/
│   │   │   ├── article.js           # Article library/editor
│   │   │   └── recipe.js            # Recipe library/editor
│   │   ├── dashboard/
│   │   │   └── index.js              # Main app dashboard
│   │   ├── feedback/
│   │   │   └── index.js              # Feedback page
│   │   ├── finance/
│   │   │   └── index.js              # Clinic finance page
│   │   ├── foods/
│   │   │   └── index.js              # Food library page
│   │   ├── patients/
│   │   │   ├── list.js              # Patient list page
│   │   │   └── profile.js           # Patient profile page
│   │   └── visit/
│   │       ├── index.js             # Visit page controller and lazy loader
│   │       ├── calculator.js        # Visit calculator module (lazy-loaded)
│   │       ├── diet-plan.js         # Gram-based diet plan (lazy-loaded)
│   │       └── exchange-plan.js     # Exchange diet plan (lazy-loaded)
│   └── [feature].js                 # Legacy page controllers, migrated incrementally
├── scripts/
│   ├── check-js.mjs                 # Dependency-free JavaScript syntax check
│   └── check-html-assets.mjs        # Check local JS/CSS references in HTML
└── docs/
    └── FRONTEND_ARCHITECTURE.md     # This document
```

## Dependency order
1. Global CSS and `theme.js`.
2. Third-party libraries required by the page (pin versions where practical).
3. `auth-access.js` for authenticated pages.
4. Shared helpers such as `js/shared/security.js`.
5. The page controller loads only the feature modules it needs; large visit tools are lazy-loaded from `js/features/visit/`.

Do not load a feature controller before the shared helpers it uses. Avoid inline event handlers; bind behavior in the page controller.

## Migration rules
- Move one cohesive feature at a time; update every loader/reference before deleting the old path.
- Current migrated groups: `features/about/`, `features/admin/`, `features/dashboard/`, `features/content/` (articles and recipes), `features/feedback/`, `features/finance/`, `features/foods/`, `features/patients/` (patient list/profile), and `features/visit/` (visit controller and lazy-loaded tools).
- Preserve public module APIs while moving files so page behavior does not change as a side effect of organization.
- Use lowercase kebab-case names for feature modules, and keep lazy-loaded modules next to their feature.
- Do not move all scripts in one bulk change; run syntax/build checks after each small migration.

## Responsibilities
- **HTML:** semantic structure, labels, landmarks, and script/style references only.
- **theme.css:** design tokens and global theme behavior; avoid accumulating page-specific selectors here.
- **feature CSS:** layout and styling unique to one page.
- **auth-access.js:** authentication and access status; database RLS remains the security boundary.
- **shared helpers:** small, dependency-light, reusable utilities with no page-specific state.
- **feature JS:** data loading, validation, rendering, and interactions for its own page.
- **Supabase:** authorization and validation must be enforced server-side; hiding a button is not authorization.

## UI conventions
- Arabic-first pages use `lang="ar" dir="rtl"`; mixed-language fields can use `dir="auto"`.
- Every form field needs a visible label or an accessible name.
- Use semantic buttons and meaningful accessible labels for icon-only controls.
- Keep keyboard focus visible, provide loading/empty/error states, and avoid color as the only status indicator.
- Use shared CSS variables for colors, borders, surfaces, text, and shadows.
- Tables must have a mobile strategy (horizontal scrolling or a deliberate card layout), not accidental page overflow.

## Safety conventions
- Treat database content and user-authored rich text as untrusted.
- Use `textContent` for plain text.
- Sanitize rich HTML before assigning it to `innerHTML` and before saving it.
- Never treat client-side role checks as a security boundary.
- Do not log secrets, session tokens, patient data, or payment-proof URLs.

## Refactoring workflow
1. Create a backup branch before changing the default branch.
2. Make focused changes on a dedicated branch.
3. Run `npm run check:js`, `npm run check:assets`, and `npm run build:css` when dependencies are installed.
4. Test authentication, routing, save/cancel flows, errors, keyboard use, mobile layout, and light/dark themes.
5. Review the diff and deploy only after smoke tests. Do not merge unfinished refactors directly into `main`.
