# RescueGo — Arabic/RTL Audit Report

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 3 | Entire pages/flows untranslated — user-facing |
| HIGH | 7 | Hardcoded English in visible UI elements |
| MEDIUM | 4 | SEO metadata, date formatting, ar.json issues |
| LOW | 2 | Skeletons, developer logs — no action needed |

**Overall readiness:** ~90% — translations are comprehensive, CSS is RTL-ready, but several user-facing pages/sections still have hardcoded English.

---

## CRITICAL Issues

### C-1: Provider Register Page — Entire Flow Untranslated

**File:** `src/app/provider/register/page.tsx`

The 4-step provider onboarding flow is completely hardcoded in English. This is the most severe finding — every new provider sees this page.

**Hardcoded strings include:**
- Step headers: "Complete provider profile", "Upload required documents"
- Input labels: "Full Name", "Phone Number", "Email", "Password"
- Placeholders: "Ahmed Al Rashid", "+971 50 000 0000"
- Buttons: "Create Account", "Save & Continue", "Upload & Continue"
- Document labels: "Emirates ID (Front)", "UAE Driving License", "Vehicle Photo"
- Plan UI: "Popular" badge, "Free", "{price} AED/mo"
- Error messages: "Network connection lost", "Failed to upload documents"
- Status cards: "Your provider account is ready", "Documents under review"
- Banner: "Launch Offer: Pay Per Job at just {X} AED flat"

**Fix:** Add `provider.register.*` namespace to `messages/ar.json` and `messages/en.json`, replace all hardcoded strings with `t()` calls.

---

### C-2: Provider Dashboard Active Job Card — Untranslated

**File:** `src/app/provider/dashboard/page.tsx` (lines 672–785)

The "Active Job" card shown to providers during an active request is entirely English.

**Hardcoded strings include:**
- "Assigned now", "Active Job"
- "Customer contact and exact location are visible..."
- "Estimated:", "Location details unavailable"
- "Customer contact", "Call customer", "Customer phone unavailable"
- "Location notes"
- Status badges: "In Progress", "Arrived", "On The Way", "Accepted"
- Cancellation notice: "Customer cancelled this request", "Your payment was protected..."
- "Credit restored" badge

**Fix:** Add keys to existing `provider.dashboard.*` namespace (partially exists) or create `provider.dashboard.activeJob.*`.

---

### C-3: Global Error Page — English-Only + Wrong `lang`

**File:** `src/app/error.tsx`

- `<html lang="en">` — hardcoded, should match user locale
- "Something went wrong"
- "We hit an unexpected error. Our team has been notified."
- "Error ID: {digest}"
- "Try again" / "Go Home"

**Fix:** Since `error.tsx` is a `'use client'` boundary outside `NextIntlClientProvider`, use inline Arabic strings (app default is AR) with English fallback, or read locale from cookie directly.

---

## HIGH Issues

### H-1: `provider/plan` Namespace Missing — Runtime Crash

**File:** `src/app/provider/plan/page.tsx`

Calls `getTranslations('provider.plan')` but `ar.json` has **no `provider.plan` key**. This causes a runtime error when any provider visits `/provider/plan` in Arabic locale.

**Keys needed:** `backToDashboard`, `title`, `subtitle`, `currentPlanLabel`, `payPerJobPromoFee`, `payPerJobFeeRange`, `monthlyPromoPrice`, `monthlyPrice`, `activeSubscription`, `jobsPerMonth`, `unlimitedJobsPerMonth`, `overageFee`, `premiumCommission`, `noPremiumCommission`, `priority`, `priorityHighest`, `priorityHigh`, `priorityStandard`, `thisMonth`, `jobsUsedLabel`, `ofLimit`, `includesCredits`, `creditPlural`, `creditSingular`, `remaining`, `allowanceUsed`, `limitReached`, `recoveryCredits`, `recoveryCreditDesc`, `planActions`, `upgradeMonthly`, `upgradePlan`, `manageBilling`, `billingQuestions`, `contactSupport`.

**Fix:** Add complete `provider.plan` namespace to both `ar.json` and `en.json`.

---

### H-2: Auth Pages — `aria-label` Hardcoded English

**Files:** `auth/register/page.tsx`, `auth/forgot-password/page.tsx`, `auth/reset-password/page.tsx`

- `aria-label="RescueGo home"` on logo links
- Some pages have `{/* TODO: i18n */}` markers left by developer
- `forgot-password`: success message text duplicated as both heading and paragraph
- `reset-password`: same duplication issue

**Fix:** Add aria-label translations to `common.*` namespace; fix duplicate key usage.

---

### H-3: Navbar `aria-label` — English

**File:** `src/components/layout/Navbar.tsx`

- Line 164: `aria-label="RescueGo home"` — hardcoded
- Line 231: `aria-label={open ? 'Close menu' : 'Open menu'}` — hardcoded

**Fix:** Use `tCommon('ariaHome')`, `tCommon('openMenu')`, `tCommon('closeMenu')`.

---

### H-4: Footer "Built by" — English

**File:** `src/components/layout/Footer.tsx`

- Line 51: `Built by <a>Mohamed Elnahrawy</a>` — visible to all users

**Fix:** Add `footer.builtBy` key to translations.

---

### H-5: Recovery SEO Pages — All English (5 pages)

**Files:** `src/app/recovery/{dubai,abu-dhabi,sharjah,ajman,ras-al-khaimah}/page.tsx`

All content is hardcoded English including headings, descriptions, service grids, and pricing. These are SEO landing pages but when `lang="ar"` is on `<html>`, screen readers and search engines see mismatched content language.

**Fix options:**
1. Add full Arabic translations (best for Arabic SEO)
2. Force `lang="en"` on these pages only (acceptable for English-only SEO strategy)
3. Leave as-is and document as intentional (current state)

---

### H-6: Auth Pages — Translation Logic Bugs

**Files:** `auth/forgot-password/page.tsx`, `auth/reset-password/page.tsx`

- Success state uses same `t('success')` key for both `<h2>` and `<p>` — reads the same text twice
- `forgot-password`: "العودة لتسجيل الدخول" rendered twice (as text + as link text)
- `reset-password`: `t('newPassword')` (a label) used as paragraph explanation text

**Fix:** Add distinct subtitle/description keys: `successTitle`, `successDescription`.

---

### H-7: `provider.plan` Page — Missing namespace (duplicate of H-1 for tracking)

See H-1 above.

---

## MEDIUM Issues

### M-1: Metadata/SEO — All English

**14 files** have hardcoded English `<Metadata>` objects (title, description, OG tags):

- `layout.tsx` — root metadata + JSON-LD schema
- `not-found.tsx`, `about/page.tsx`, `pricing/page.tsx`
- 5 admin pages: `dashboard`, `providers`, `requests`, `revenue`, `performance`
- `provider/dashboard`, `provider/pending`, `provider/plan`

**Fix:** Use `generateMetadata()` with `getTranslations('metadata.*')` for locale-aware titles.

---

### M-2: Date Formatting Locale Hardcoded as `'en-AE'`

**6 files** use `.toLocaleDateString('en-AE')` or `.toLocaleString('en-AE')`:

- `admin/providers/page.tsx`
- `admin/requests/page.tsx` (×2)
- `admin/revenue/page.tsx` (×2)
- `provider/dashboard/page.tsx`

**Fix:** Replace `'en-AE'` with dynamic `locale === 'ar' ? 'ar-AE' : 'en-AE'`.

---

### M-3: `ar.json` — Orphaned/Stale Keys

- `pricing.starter`, `pricing.pro`, `pricing.business` have old prices (99, 249, 499 AED) — actual prices in code are different
- `landing.page.services.0.descriptor` and `.1.descriptor` are empty strings `""`

**Fix:** Remove orphaned keys or update prices; fill empty descriptors or remove them from template.

---

### M-4: `provider/pending/page.tsx` — Partial Translation

Most content uses `t()` but some edge-case strings may be English. Needs verification during testing.

---

## LOW Issues (No Action Required)

### L-1: Loading Skeletons — No Text
All 7 `loading.tsx` files contain only animated placeholder divs. No visible text.

### L-2: API Error Messages — Developer-Only
API routes return English JSON error messages (e.g., `"Request is no longer available"`). These are consumed by frontend code which then displays translated UI messages. The raw API strings are never shown directly to users.

---

## Fix Phases (Recommended Order)

### Phase A — Critical Fixes (Blocks Arabic launch)
| Task | Files | Effort |
|------|-------|--------|
| A-1: Add `provider.register.*` namespace + translate register page | `register/page.tsx`, `ar.json`, `en.json` | Large (50+ keys) |
| A-2: Translate active job card in provider dashboard | `dashboard/page.tsx`, `ar.json`, `en.json` | Medium (20+ keys) |
| A-3: Fix error.tsx for Arabic | `error.tsx` | Small (5 strings) |
| A-4: Add `provider.plan.*` namespace | `plan/page.tsx`, `ar.json`, `en.json` | Medium (30+ keys) |

### Phase B — High Priority (User-visible polish)
| Task | Files | Effort |
|------|-------|--------|
| B-1: Fix auth page translation logic bugs | `forgot-password`, `reset-password` | Small |
| B-2: Translate aria-labels (Navbar, Footer, auth pages) | 5 files, `ar.json` | Small |
| B-3: Translate Footer "Built by" | `Footer.tsx`, `ar.json` | Tiny |
| B-4: Decide recovery pages strategy (translate or force lang="en") | 5 files | Small–Large |

### Phase C — Medium Priority (SEO & polish)
| Task | Files | Effort |
|------|-------|--------|
| C-1: Locale-aware metadata (generateMetadata) | 14 files, `ar.json` | Medium |
| C-2: Dynamic date formatting locale | 6 files | Small |
| C-3: Clean up ar.json orphaned keys | `ar.json` | Tiny |

---

## Total Effort Estimate

| Phase | Keys to Add | Files to Modify | Estimated Time |
|-------|-------------|-----------------|----------------|
| A | ~105 keys | 6 files | 2–3 hours |
| B | ~15 keys | 8 files | 30–45 min |
| C | ~30 keys | 20 files | 1–2 hours |
| **Total** | **~150 keys** | **~34 files** | **4–6 hours** |
# RescueGo — Arabic/RTL Audit Report

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 3 | Entire pages/flows untranslated — user-facing |
| HIGH | 7 | Hardcoded English in visible UI elements |
| MEDIUM | 4 | SEO metadata, date formatting, ar.json issues |
| LOW | 2 | Skeletons, developer logs — no action needed |

**Overall readiness:** ~90% — translations are comprehensive, CSS is RTL-ready, but several user-facing pages/sections still have hardcoded English.

---

## CRITICAL Issues

### C-1: Provider Register Page — Entire Flow Untranslated

**File:** `src/app/provider/register/page.tsx`

The 4-step provider onboarding flow is completely hardcoded in English. This is the most severe finding — every new provider sees this page.

**Hardcoded strings include:**
- Step headers: "Complete provider profile", "Upload required documents"
- Input labels: "Full Name", "Phone Number", "Email", "Password"
- Placeholders: "Ahmed Al Rashid", "+971 50 000 0000"
- Buttons: "Create Account", "Save & Continue", "Upload & Continue"
- Document labels: "Emirates ID (Front)", "UAE Driving License", "Vehicle Photo"
- Plan UI: "Popular" badge, "Free", "{price} AED/mo"
- Error messages: "Network connection lost", "Failed to upload documents"
- Status cards: "Your provider account is ready", "Documents under review"
- Banner: "Launch Offer: Pay Per Job at just {X} AED flat"

**Fix:** Add `provider.register.*` namespace to `messages/ar.json` and `messages/en.json`, replace all hardcoded strings with `t()` calls.

---

### C-2: Provider Dashboard Active Job Card — Untranslated

**File:** `src/app/provider/dashboard/page.tsx` (lines 672–785)

The "Active Job" card shown to providers during an active request is entirely English.

**Hardcoded strings include:**
- "Assigned now", "Active Job"
- "Customer contact and exact location are visible..."
- "Estimated:", "Location details unavailable"
- "Customer contact", "Call customer", "Customer phone unavailable"
- "Location notes"
- Status badges: "In Progress", "Arrived", "On The Way", "Accepted"
- Cancellation notice: "Customer cancelled this request", "Your payment was protected..."
- "Credit restored" badge

**Fix:** Add keys to existing `provider.dashboard.*` namespace (partially exists) or create `provider.dashboard.activeJob.*`.

---

### C-3: Global Error Page — English-Only + Wrong `lang`

**File:** `src/app/error.tsx`

- `<html lang="en">` — hardcoded, should match user locale
- "Something went wrong"
- "We hit an unexpected error. Our team has been notified."
- "Error ID: {digest}"
- "Try again" / "Go Home"

**Fix:** Since `error.tsx` is a `'use client'` boundary outside `NextIntlClientProvider`, use inline Arabic strings (app default is AR) with English fallback, or read locale from cookie directly.

---

## HIGH Issues

### H-1: `provider/plan` Namespace Missing — Runtime Crash

**File:** `src/app/provider/plan/page.tsx`

Calls `getTranslations('provider.plan')` but `ar.json` has **no `provider.plan` key**. This causes a runtime error when any provider visits `/provider/plan` in Arabic locale.

**Keys needed:** `backToDashboard`, `title`, `subtitle`, `currentPlanLabel`, `payPerJobPromoFee`, `payPerJobFeeRange`, `monthlyPromoPrice`, `monthlyPrice`, `activeSubscription`, `jobsPerMonth`, `unlimitedJobsPerMonth`, `overageFee`, `premiumCommission`, `noPremiumCommission`, `priority`, `priorityHighest`, `priorityHigh`, `priorityStandard`, `thisMonth`, `jobsUsedLabel`, `ofLimit`, `includesCredits`, `creditPlural`, `creditSingular`, `remaining`, `allowanceUsed`, `limitReached`, `recoveryCredits`, `recoveryCreditDesc`, `planActions`, `upgradeMonthly`, `upgradePlan`, `manageBilling`, `billingQuestions`, `contactSupport`.

**Fix:** Add complete `provider.plan` namespace to both `ar.json` and `en.json`.

---

### H-2: Auth Pages — `aria-label` Hardcoded English

**Files:** `auth/register/page.tsx`, `auth/forgot-password/page.tsx`, `auth/reset-password/page.tsx`

- `aria-label="RescueGo home"` on logo links
- Some pages have `{/* TODO: i18n */}` markers left by developer
- `forgot-password`: success message text duplicated as both heading and paragraph
- `reset-password`: same duplication issue

**Fix:** Add aria-label translations to `common.*` namespace; fix duplicate key usage.

---

### H-3: Navbar `aria-label` — English

**File:** `src/components/layout/Navbar.tsx`

- Line 164: `aria-label="RescueGo home"` — hardcoded
- Line 231: `aria-label={open ? 'Close menu' : 'Open menu'}` — hardcoded

**Fix:** Use `tCommon('ariaHome')`, `tCommon('openMenu')`, `tCommon('closeMenu')`.

---

### H-4: Footer "Built by" — English

**File:** `src/components/layout/Footer.tsx`

- Line 51: `Built by <a>Mohamed Elnahrawy</a>` — visible to all users

**Fix:** Add `footer.builtBy` key to translations.

---

### H-5: Recovery SEO Pages — All English (5 pages)

**Files:** `src/app/recovery/{dubai,abu-dhabi,sharjah,ajman,ras-al-khaimah}/page.tsx`

All content is hardcoded English including headings, descriptions, service grids, and pricing. These are SEO landing pages but when `lang="ar"` is on `<html>`, screen readers and search engines see mismatched content language.

**Fix options:**
1. Add full Arabic translations (best for Arabic SEO)
2. Force `lang="en"` on these pages only (acceptable for English-only SEO strategy)
3. Leave as-is and document as intentional (current state)

---

### H-6: Auth Pages — Translation Logic Bugs

**Files:** `auth/forgot-password/page.tsx`, `auth/reset-password/page.tsx`

- Success state uses same `t('success')` key for both `<h2>` and `<p>` — reads the same text twice
- `forgot-password`: "العودة لتسجيل الدخول" rendered twice (as text + as link text)
- `reset-password`: `t('newPassword')` (a label) used as paragraph explanation text

**Fix:** Add distinct subtitle/description keys: `successTitle`, `successDescription`.

---

### H-7: `provider.plan` Page — Missing namespace (duplicate of H-1 for tracking)

See H-1 above.

---

## MEDIUM Issues

### M-1: Metadata/SEO — All English

**14 files** have hardcoded English `<Metadata>` objects (title, description, OG tags):

- `layout.tsx` — root metadata + JSON-LD schema
- `not-found.tsx`, `about/page.tsx`, `pricing/page.tsx`
- 5 admin pages: `dashboard`, `providers`, `requests`, `revenue`, `performance`
- `provider/dashboard`, `provider/pending`, `provider/plan`

**Fix:** Use `generateMetadata()` with `getTranslations('metadata.*')` for locale-aware titles.

---

### M-2: Date Formatting Locale Hardcoded as `'en-AE'`

**6 files** use `.toLocaleDateString('en-AE')` or `.toLocaleString('en-AE')`:

- `admin/providers/page.tsx`
- `admin/requests/page.tsx` (×2)
- `admin/revenue/page.tsx` (×2)
- `provider/dashboard/page.tsx`

**Fix:** Replace `'en-AE'` with dynamic `locale === 'ar' ? 'ar-AE' : 'en-AE'`.

---

### M-3: `ar.json` — Orphaned/Stale Keys

- `pricing.starter`, `pricing.pro`, `pricing.business` have old prices (99, 249, 499 AED) — actual prices in code are different
- `landing.page.services.0.descriptor` and `.1.descriptor` are empty strings `""`

**Fix:** Remove orphaned keys or update prices; fill empty descriptors or remove them from template.

---

### M-4: `provider/pending/page.tsx` — Partial Translation

Most content uses `t()` but some edge-case strings may be English. Needs verification during testing.

---

## LOW Issues (No Action Required)

### L-1: Loading Skeletons — No Text
All 7 `loading.tsx` files contain only animated placeholder divs. No visible text.

### L-2: API Error Messages — Developer-Only
API routes return English JSON error messages (e.g., `"Request is no longer available"`). These are consumed by frontend code which then displays translated UI messages. The raw API strings are never shown directly to users.

---

## Fix Phases (Recommended Order)

### Phase A — Critical Fixes (Blocks Arabic launch)
| Task | Files | Effort |
|------|-------|--------|
| A-1: Add `provider.register.*` namespace + translate register page | `register/page.tsx`, `ar.json`, `en.json` | Large (50+ keys) |
| A-2: Translate active job card in provider dashboard | `dashboard/page.tsx`, `ar.json`, `en.json` | Medium (20+ keys) |
| A-3: Fix error.tsx for Arabic | `error.tsx` | Small (5 strings) |
| A-4: Add `provider.plan.*` namespace | `plan/page.tsx`, `ar.json`, `en.json` | Medium (30+ keys) |

### Phase B — High Priority (User-visible polish)
| Task | Files | Effort |
|------|-------|--------|
| B-1: Fix auth page translation logic bugs | `forgot-password`, `reset-password` | Small |
| B-2: Translate aria-labels (Navbar, Footer, auth pages) | 5 files, `ar.json` | Small |
| B-3: Translate Footer "Built by" | `Footer.tsx`, `ar.json` | Tiny |
| B-4: Decide recovery pages strategy (translate or force lang="en") | 5 files | Small–Large |

### Phase C — Medium Priority (SEO & polish)
| Task | Files | Effort |
|------|-------|--------|
| C-1: Locale-aware metadata (generateMetadata) | 14 files, `ar.json` | Medium |
| C-2: Dynamic date formatting locale | 6 files | Small |
| C-3: Clean up ar.json orphaned keys | `ar.json` | Tiny |

---

## Total Effort Estimate

| Phase | Keys to Add | Files to Modify | Estimated Time |
|-------|-------------|-----------------|----------------|
| A | ~105 keys | 6 files | 2–3 hours |
| B | ~15 keys | 8 files | 30–45 min |
| C | ~30 keys | 20 files | 1–2 hours |
| **Total** | **~150 keys** | **~34 files** | **4–6 hours** |
