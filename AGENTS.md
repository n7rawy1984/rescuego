<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:pre-task-verification-rule -->
# MANDATORY: Pre-Task Verification Rule

Before starting ANY fix, feature, or roadmap task — you MUST first verify whether the work has already been done:

1. **Check the actual code/files** — read the relevant source files to see if the fix/feature already exists.
2. **Check SESSION_LOG.md** — see if it was documented as completed in a previous session.
3. **Check git log** — run `git log --oneline -20` to see recent commits that may have addressed it.

If the task is already done:
- Review the existing implementation for correctness and best practices.
- If it needs improvement (outdated pattern, missing edge case, better approach available) — fix it.
- If it's already correct — skip it silently and move to the next task.
- Do NOT re-implement from scratch or overwrite working code unnecessarily.

If partially done:
- Complete the missing parts.
- Review the existing parts for quality — improve if needed.

This rule applies to ALL work: audit fixes, roadmap phases, SEO tasks, Arabic translation tasks, and any other modifications.

**Reason:** Multiple sessions may work on the same codebase. Work may have been completed but not documented in the audit reports. Always verify before acting.
<!-- END:pre-task-verification-rule -->

<!-- BEGIN:new-feature-standards -->
# MANDATORY: New Feature Engineering Standards

Every new feature, component, page, or route MUST comply with ALL of the following standards from day one. No exceptions, no "we'll add it later."

## 1. Internationalization (i18n)
- ALL user-facing strings MUST use `useTranslations()` (client) or `getTranslations()` (server) — zero hardcoded text.
- Add keys to BOTH `messages/ar.json` AND `messages/en.json` simultaneously.
- Arabic is the default locale — always write Arabic translations first.
- Use ICU message format for plurals, numbers, and interpolation.
- `aria-label`, `placeholder`, `alt`, `title` attributes MUST also be translated.

## 2. RTL/LTR Layout
- Use ONLY logical CSS properties: `ms-`/`me-`/`ps-`/`pe-`/`start`/`end` — never `ml-`/`mr-`/`pl-`/`pr-`/`left`/`right` for directional spacing.
- Test visually in both `dir="rtl"` and `dir="ltr"`.
- Icons that imply direction (arrows, chevrons) must flip with `rtl:rotate-180`.

## 3. SEO & Metadata
- Every public page MUST export `metadata` or use `generateMetadata()` with locale-aware title + description.
- Follow title template: `"{Page Title}"` — layout appends `| RescueGo UAE` automatically. Do NOT include brand in page title.
- Add `openGraph` (title, description, image, type) for every public page.
- Use exactly ONE `<h1>` per page. Heading hierarchy: h1 > h2 > h3, no level skipping.
- Add JSON-LD schema markup where applicable (Service, FAQ, HowTo, etc.).

## 4. Accessibility (a11y)
- Every interactive element MUST have accessible name (aria-label or visible text).
- Every `<img>` / `<Image>` MUST have meaningful `alt` text (translated).
- Form inputs MUST have associated `<label>` elements.
- Color contrast MUST meet WCAG AA (4.5:1 for text, 3:1 for large text).
- Focus management: all interactive elements must be keyboard-navigable.

## 5. Performance
- Use `next/image` for ALL images with explicit `width`/`height` or `fill`.
- Lazy-load below-the-fold content with `loading="lazy"` or dynamic imports.
- Avoid importing large libraries in client components — prefer tree-shakeable imports.
- Keep initial bundle per route under 100KB (compressed).

## 6. Security
- Never expose secrets, API keys, or internal IDs in client-facing code.
- Validate ALL user input server-side (Zod schemas in API routes).
- Use `SECURITY DEFINER` RPCs via service_role — never expose direct table mutations to clients.
- Sanitize any user-generated content before rendering.

## 7. Code Quality
- Follow existing patterns: file naming, component structure, import order.
- No comments unless logic is genuinely complex.
- Type everything — no `any`, no type assertions unless absolutely necessary.
- Error handling: every async operation must have try/catch with meaningful fallback.
- Reuse existing utilities (`src/lib/`) before creating new ones.

## 8. Testing Readiness
- Design components to be testable: props-driven, minimal side effects.
- Export types and constants that tests may need.
- API routes should return consistent error shapes: `{ error: string, message?: string }`.

**Enforcement:** If any of the above is missing from a PR or task output, it is considered incomplete. Fix before marking done.
<!-- END:new-feature-standards -->
