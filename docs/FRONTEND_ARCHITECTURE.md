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
│   └── [feature].js                 # Feature behavior; no cross-feature UI logic
├── scripts/
│   └── check-js.mjs                 # Dependency-free JavaScript syntax check
└── docs/
    └── FRONTEND_ARCHITECTURE.md     # This document
```

## Dependency order
1. Global CSS and `theme.js`.
2. Third-party libraries required by the page (pin versions where practical).
3. `auth-access.js` for authenticated pages.
4. Shared helpers such as `js/shared/security.js`.
5. Exactly one page-specific controller.

Do not load a feature controller before the shared helpers it uses. Avoid inline event handlers; bind behavior in the page controller.

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
3. Run `npm run check:js` and `npm run build:css` when dependencies are installed.
4. Test authentication, routing, save/cancel flows, errors, keyboard use, mobile layout, and light/dark themes.
5. Review the diff and deploy only after smoke tests. Do not merge unfinished refactors directly into `main`.
