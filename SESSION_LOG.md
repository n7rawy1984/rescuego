# RescueGo — Session Log

---

## Session: June 3, 2026

### What was done

1. **Read CLAUDE.md and DEPLOYMENT_STATUS.md** — established full project state.

2. **Phase 1 marked complete.**
   - Sentry DSN + NEXT_PUBLIC_SENTRY_DSN confirmed on Vercel (May 31).
   - Sentry smoke verification confirmed done by user.
   - CLAUDE.md updated: Phase 1 moved into ✅ completed list.
   - DEPLOYMENT_STATUS.md updated: Sentry block marked ✅, next task set to Phase 1A.

3. **Phase 1A started — Task 1: auth/login performance audit (findings only, no code changes).**

---

### Phase 1A — Task 1 Findings: Auth/Login Performance Audit

#### Finding 1 — No middleware.ts (HIGH)
No `middleware.ts` exists at the project root. `@supabase/ssr` requires middleware to call `updateSession()` on every request to refresh expired tokens. Without it, server-side `supabase.auth.getUser()` can silently fail for sessions needing refresh. This is the most likely cause of any intermittent auth failures. Also means every protected page does a cold auth check from scratch with no token refresh at the edge.
- **Fix needed:** Add `middleware.ts` at project root implementing Supabase `updateSession` pattern.

#### Finding 2 — Two sequential network calls on every login (MEDIUM)
`src/app/auth/login/page.tsx:135–158`: After `signInWithPassword` resolves, the role is fetched in a second sequential DB call (`users.select('role')`). Navigation cannot begin until both complete.
- **Fix option:** Store role in Supabase Auth `user_metadata` at registration, eliminating the second call.

#### Finding 3 — Navbar duplicates auth + role fetch on every page (MEDIUM)
`src/components/layout/Navbar.tsx:54–73`: The Navbar calls `supabase.auth.getUser()` + `users.select('role')` on every mount, independent of the server-side checks already done by the page. Every protected page pays at minimum 4 network calls before it is interactive (server auth + server DB + Navbar auth + Navbar role).

#### Finding 4 — 1200ms fallback timer / router.refresh() redundancy (MEDIUM)
`src/app/auth/login/page.tsx:55–62`: After login, `router.replace()` + `router.refresh()` are called together. `router.refresh()` triggers a server re-render of the login page (about to be navigated away from — wasteful). A 1200ms `window.location.assign` fallback fires if navigation stalls. In the worst case the user sees a 1200ms loading screen before the dashboard appears.

#### Finding 5 — Prefetches all 3 dashboards for every visitor (LOW)
`src/app/auth/login/page.tsx:79–81`: All three destinations (`/customer/request`, `/provider/dashboard`, `/admin/dashboard`) are prefetched on every login page mount regardless of whether the user is authenticated or what their role is. Wastes bandwidth for unauthenticated visitors.

#### Finding 6 — Unauthenticated users pay getUser() on login mount (LOW)
`src/app/auth/login/page.tsx:78–113`: The already-authenticated redirect check (`getUser()` + role fetch) fires on every mount including for users who are not logged in. The form is not interactive until both calls complete.

#### Finding 7 — Sequential conditional queries on provider dashboard (LOW)
`src/app/provider/dashboard/page.tsx:294–341`: After the first `Promise.all`, three more queries run sequentially (`recentCustomerCancellation` → `recentPpjPayment` → `recentOveragePayment`), each conditional on the previous. When `returnedFromPayment === true` this adds ~3 extra sequential roundtrips to dashboard load time.

#### Finding 8 — `bundlePagesRouterDependencies: true` (NEGLIGIBLE)
`next.config.ts:77`: This option targets the Pages Router and is a no-op in an App Router project. Dead config, no performance impact.

#### Priority order for fixes
| Priority | Finding | Action |
|---|---|---|
| 1 | No middleware.ts | Add Supabase SSR middleware |
| 2 | Sequential role fetch on login | Store role in user_metadata or combine calls |
| 3 | Navbar duplicates auth | Pass role as server prop or use React context |
| 4 | router.refresh() + fallback timer | Remove router.refresh(), tighten fallback |
| 5 | Prefetch all 3 dashboards | Prefetch only after role is known |
| 6 | getUser() on login mount for unauthed users | Accept as-is or gate behind session hint |
| 7 | Dashboard sequential queries | Parallelize where conditions allow |
| 8 | bundlePagesRouterDependencies | Remove from next.config.ts |

---

### Next Task: Phase 1A — Task 2

**logout lag investigation**

Known issue mentioned in CLAUDE.md. Investigate why logout feels slow. Relevant files:
- `src/components/layout/Navbar.tsx` — `handleLogout` function (line 120–136)
- The logout calls `supabase.auth.signOut()` fire-and-forget, but `router.replace('/')` happens before signOut resolves.
- Check if there is a session teardown delay, a stale `onAuthStateChange` event, or a re-render cascade causing the perceived lag.

---

### Deferred Issues (from DEPLOYMENT_STATUS.md — not yet addressed)

- `NEXT_PUBLIC_SITE_URL` — still missing from Vercel env vars.
- Storage bucket `provider-documents` — 0 RLS policies. Needs review per SETUP.md §4.
- CSP violations review — report-only period has been running since Phase 1. Check Sentry/CSP report endpoint for any violations before enforcing.
- Confirm migration 010 (`harden_open_request_privacy`) applied on production.
- Webhook production verification — Stripe still on test/sandbox keys. Live keys needed before real launch (Phase 10).

---

### Files changed this session

- `CLAUDE.md` — Phase 1 marked complete, "⏳ ناقص" section removed.
- `DEPLOYMENT_STATUS.md` — Sentry marked verified, next task updated to Phase 1A.
- `SESSION_LOG.md` — created (this file).
