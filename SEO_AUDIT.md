# RescueGo — SEO Audit Report

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 3 | Title duplication, i18n indexing conflict, broken OG image |
| HIGH | 5 | Missing metadata on indexed page, thin content, no internal links, h1 issues, wrong schema type |
| MEDIUM | 12 | Missing OG per-page, no PWA, no HSTS, schema gaps, sitemap issues |
| LOW | 6 | Favicon variants, image sitemap, admin UX, minor schema tweaks |

---

## CRITICAL Issues

### S-1: Title Template Duplication — Brand Name Appears Twice

**Root cause:** Layout defines `template: '%s | RescueGo UAE'` but page-level titles already include `| RescueGo`.

**Rendered result:** "Roadside Recovery Dubai — Fast & Trusted | RescueGo | RescueGo UAE"

**Affected files:**
- `src/app/page.tsx:23` — `'RescueGo - Roadside Recovery UAE | Fast & Trusted'`
- `src/app/recovery/dubai/page.tsx:7` — `'... | RescueGo'`
- `src/app/recovery/abu-dhabi/page.tsx:7` — `'... | RescueGo'`
- `src/app/recovery/sharjah/page.tsx:7` — `'... | RescueGo'`
- `src/app/recovery/ajman/page.tsx:7` — `'... | RescueGo'`
- `src/app/recovery/ras-al-khaimah/page.tsx:7` — `'... | RescueGo'`

**Fix:** Remove `| RescueGo` suffix from all page-level titles. Let the template handle branding.

---

### S-2: Cookie-Based i18n — Arabic Indexed with English Metadata

**Root cause:** Locale is cookie-based (`NEXT_LOCALE`). Crawlers don't send cookies → always get Arabic content (default). But ALL metadata (title, description, OG) is hardcoded English.

**Result:** Google indexes pages with:
- `<html lang="ar" dir="rtl">` 
- Arabic page content
- English `<title>` and `<meta name="description">`
- No `hreflang` tags anywhere

**Impact:** Language signal confusion. English-speaking users may not find the site. Arabic-speaking users see English titles in search results.

**Files:**
- `src/i18n/request.ts:6` — default is Arabic
- `src/app/layout.tsx:14–54` — all metadata English, no `alternates.languages`

**Fix options:**
1. Best: URL-based routing (`/en/`, `/ar/`) with proper `hreflang`
2. Minimum: Add `alternates.languages` to metadata + locale-aware titles/descriptions via `generateMetadata`

---

### S-3: OG Image is SVG — Social Share Preview Broken

**Root cause:** `public/og-image.svg` used in OG and Twitter card metadata.

**Impact:** Facebook, Twitter/X, LinkedIn, WhatsApp, Slack, Telegram — ALL show blank/no preview image when the site is shared.

**Files:**
- `src/app/layout.tsx:40` — `images: [{ url: '/og-image.svg' }]`
- `src/app/layout.tsx:46` — `twitter images: ['/og-image.svg']`
- `public/og-image.svg` — the file itself

**Fix:** Generate `public/og-image.png` (1200×630px, JPG/PNG). Update references.

---

## HIGH Issues

### S-4: `/provider/register` — Public Indexed Page with Zero Metadata

This page is in the sitemap (priority 0.8) and allowed in robots.txt, but it's a `'use client'` component with NO `metadata` export.

**Impact:** Google crawls a page with no `<title>`, no `<meta description>`, falling back to the layout template ("| RescueGo UAE" with no page-specific title).

**File:** `src/app/provider/register/page.tsx`

**Fix:** Create `src/app/provider/register/layout.tsx` with exported metadata, OR refactor to server component wrapper.

---

### S-5: Recovery Pages — Extremely Thin Content

| Page | Word Count | Service Grid | Pricing |
|------|-----------|--------------|---------|
| Dubai | ~150 words | Yes | Yes |
| Abu Dhabi | ~130 words | Yes | Yes |
| Sharjah | ~80 words | No | No |
| Ajman | ~80 words | No | No |
| Ras Al Khaimah | ~80 words | No | No |

**Impact:** Google may treat Sharjah/Ajman/RAK as thin/duplicate content → reduced ranking or deindexing.

**Fix:** Expand each city page to 400–800 words with unique content: local coverage areas, common breakdown scenarios, response times, testimonials.

---

### S-6: No Internal Links Between Recovery Pages

City pages are completely isolated — no cross-links to other cities, no link back to homepage, no link to pricing.

**Impact:** PageRank doesn't flow between local pages. Google doesn't see topical cluster authority.

**Fix:** Add "Other areas we serve" section at the bottom of each recovery page linking to all other city pages.

---

### S-7: Multiple `<h1>` Tags on Key Pages

- `customer/request/page.tsx` — 4 conditional `<h1>` elements (lines 453, 485, 554, 754)
- `provider/register/page.tsx` — 5 conditional `<h1>` elements

**Impact:** While only one renders per state, search engines may see multiple `<h1>` in the source/streaming HTML.

**Fix:** Use `<h1>` only for the primary state; use `<h2>` for error/success states.

---

### S-8: Wrong Schema Type for Marketplace

All recovery pages and root layout use `@type: LocalBusiness`. RescueGo is a platform/marketplace connecting customers with providers — not a physical storefront.

**Impact:** Schema mismatch may prevent Rich Result eligibility or trigger manual review.

**Fix:** Use `@type: ["Service", "EmergencyService"]` for recovery pages. Root layout could use `Organization` or keep `LocalBusiness` with proper physical address.

---

## MEDIUM Issues

### S-9: Auth Pages — No Metadata, No `noindex`

**Files:** `auth/login`, `auth/register`, `auth/forgot-password`, `auth/reset-password`

These are client components with no metadata. While blocked by `robots.txt`, adding `robots: 'noindex'` as belt-and-suspenders is recommended.

**Fix:** Add layout.tsx or generateMetadata wrapper for `/auth/` route group.

---

### S-10: Recovery Pages — No Page-Level OG Tags

All 5 city pages inherit the generic homepage OG content. Sharing any city page on social shows "RescueGo - Roadside Recovery UAE" instead of city-specific title.

**Fix:** Add `openGraph` override in each recovery page's metadata export.

---

### S-11: Pricing Page — Incomplete OG/Twitter

Has `openGraph.title` and `description` but missing `og:image`, `og:type`, Twitter card entirely.

**File:** `src/app/pricing/page.tsx:18–22`

---

### S-12: No PWA Manifest

No `manifest.json` or `src/app/manifest.ts`. For a mobile-first emergency service, PWA is highly relevant (home screen install, offline indicator).

**Fix:** Create `src/app/manifest.ts` with app name, icons, theme color.

---

### S-13: Missing HSTS Header

`next.config.ts` security headers don't include `Strict-Transport-Security`.

**Fix:** Add `{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }` to headers array.

---

### S-14: Sitemap `lastModified` Uses Build Time

`src/app/sitemap.ts:6` — `lastModified: new Date()` marks all URLs as freshly modified on every deploy.

**Fix:** Use static dates per page, or remove `lastModified` for static pages.

---

### S-15: LocalBusiness JSON-LD — Missing Required Fields

Root layout schema (`layout.tsx:62–72`) missing:
- `@id` — required for entity disambiguation
- `telephone` — recommended for Local Pack eligibility
- `address` (full `PostalAddress`) — required for Google Maps/Knowledge Panel
- `geo` (`GeoCoordinates`) — recommended
- `openingHoursSpecification` — important for "24/7" signal
- `sameAs` — social profile links

---

### S-16: About Page — No JSON-LD Schema

Natural location for `Organization` or `WebSite` schema with `founder`, `foundingDate`, `contactPoint`.

**File:** `src/app/about/page.tsx`

---

### S-17: Sharjah/Ajman/RAK Missing `keywords` Metadata

Dubai and Abu Dhabi pages have `keywords`, the other three don't.

---

### S-18: Pricing Page Uses `<a>` for Internal Links

Lines 131, 137: Two CTAs use plain `<a>` instead of Next.js `<Link>`. Hurts prefetching and soft navigation.

---

### S-19: Provider Dashboard Has No `<h1>`

Starts with `<h2>` level cards. No `<h1>` present. (noindex, so LOW SEO impact but HIGH accessibility impact)

---

### S-20: Missing `og:locale:alternate` for Arabic

Root OG has `locale: 'en_AE'` but no `locale:alternate` for `ar_AE`.

**File:** `src/app/layout.tsx:35`

---

## LOW Issues

### S-21: No `apple-touch-icon` or Multi-Size Favicon
Only `favicon.ico` exists. No 180×180, 192×192, 512×512 variants.

### S-22: No Image Sitemap
`sitemap.ts` has no `images` property per URL entry.

### S-23: Admin Pages Use `<a>` Instead of `<Link>`
No SEO impact (noindex) but poor UX (full page reloads).

### S-24: `priceRange: 'Free for drivers'` — Non-Standard
Schema.org expects currency format. Use `"Free"` or remove.

### S-25: Logo in Schema Points to SVG
Google structured data guidelines recommend PNG/JPG for `logo` property.

### S-26: Missing `twitter:site` and `twitter:creator`
No Twitter/X handle configured in root metadata.

---

## Fix Phases (Recommended Order)

### Phase 1 — Critical Fixes (Immediate SEO impact)
| Task | Files | Effort |
|------|-------|--------|
| 1-1: Fix title template duplication | 6 page files | 10 min |
| 1-2: Generate PNG OG image (1200×630) | `public/`, `layout.tsx` | 15 min |
| 1-3: Add HSTS header | `next.config.ts` | 2 min |
| 1-4: Add `alternates.languages` to root metadata | `layout.tsx` | 5 min |

### Phase 2 — Schema & Structured Data
| Task | Files | Effort |
|------|-------|--------|
| 2-1: Fix schema types (Service/EmergencyService) | 6 files | 20 min |
| 2-2: Add missing LocalBusiness fields (@id, telephone, address, geo, hours) | `layout.tsx` | 15 min |
| 2-3: Add Organization schema to About page | `about/page.tsx` | 10 min |
| 2-4: Fix logo URL (SVG → PNG) in schema | `layout.tsx` | 2 min |

### Phase 3 — Recovery Pages SEO
| Task | Files | Effort |
|------|-------|--------|
| 3-1: Expand thin content (Sharjah/Ajman/RAK to 400+ words each) | 3 files | 45 min |
| 3-2: Add internal cross-links between city pages | 5 files | 15 min |
| 3-3: Add page-level OG metadata per city | 5 files | 15 min |
| 3-4: Add `keywords` to Sharjah/Ajman/RAK | 3 files | 5 min |
| 3-5: Add service grid + pricing to Sharjah/Ajman/RAK | 3 files | 20 min |

### Phase 4 — Page Metadata & Indexing
| Task | Files | Effort |
|------|-------|--------|
| 4-1: Add metadata to `/provider/register` (layout.tsx wrapper) | 1 new file | 10 min |
| 4-2: Add `robots: noindex` to auth pages (layout wrapper) | 1 new file | 5 min |
| 4-3: Fix H1 hierarchy on register + customer request pages | 2 files | 10 min |
| 4-4: Complete pricing page OG/Twitter metadata | 1 file | 5 min |
| 4-5: Fix sitemap `lastModified` | `sitemap.ts` | 5 min |

### Phase 5 — PWA & Mobile
| Task | Files | Effort |
|------|-------|--------|
| 5-1: Create `manifest.ts` (name, icons, theme) | 1 new file | 10 min |
| 5-2: Generate apple-touch-icon + PNG favicons (180, 192, 512) | 3 files | 15 min |
| 5-3: Add `twitter:site` handle | `layout.tsx` | 2 min |
| 5-4: Replace `<a>` with `<Link>` on pricing page | `pricing/page.tsx` | 5 min |

### Phase 6 — i18n SEO (Depends on Arabic Audit Phase A)
| Task | Files | Effort |
|------|-------|--------|
| 6-1: Implement locale-aware `generateMetadata` | 10+ files | 1–2 hours |
| 6-2: Add `og:locale:alternate` for `ar_AE` | `layout.tsx` | 5 min |
| 6-3: Consider URL-based locale routing for full hreflang support | Architecture decision | Large |

---

## Total Effort Estimate

| Phase | Priority | Estimated Time |
|-------|----------|----------------|
| Phase 1 | Immediate | 30 min |
| Phase 2 | High | 45 min |
| Phase 3 | High | 1.5 hours |
| Phase 4 | Medium | 35 min |
| Phase 5 | Medium | 30 min |
| Phase 6 | Future (depends on Arabic fixes) | 2+ hours |
| **Total** | | **~5.5 hours** |
# RescueGo — SEO Audit Report

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 3 | Title duplication, i18n indexing conflict, broken OG image |
| HIGH | 5 | Missing metadata on indexed page, thin content, no internal links, h1 issues, wrong schema type |
| MEDIUM | 12 | Missing OG per-page, no PWA, no HSTS, schema gaps, sitemap issues |
| LOW | 6 | Favicon variants, image sitemap, admin UX, minor schema tweaks |

---

## CRITICAL Issues

### S-1: Title Template Duplication — Brand Name Appears Twice

**Root cause:** Layout defines `template: '%s | RescueGo UAE'` but page-level titles already include `| RescueGo`.

**Rendered result:** "Roadside Recovery Dubai — Fast & Trusted | RescueGo | RescueGo UAE"

**Affected files:**
- `src/app/page.tsx:23` — `'RescueGo - Roadside Recovery UAE | Fast & Trusted'`
- `src/app/recovery/dubai/page.tsx:7` — `'... | RescueGo'`
- `src/app/recovery/abu-dhabi/page.tsx:7` — `'... | RescueGo'`
- `src/app/recovery/sharjah/page.tsx:7` — `'... | RescueGo'`
- `src/app/recovery/ajman/page.tsx:7` — `'... | RescueGo'`
- `src/app/recovery/ras-al-khaimah/page.tsx:7` — `'... | RescueGo'`

**Fix:** Remove `| RescueGo` suffix from all page-level titles. Let the template handle branding.

---

### S-2: Cookie-Based i18n — Arabic Indexed with English Metadata

**Root cause:** Locale is cookie-based (`NEXT_LOCALE`). Crawlers don't send cookies → always get Arabic content (default). But ALL metadata (title, description, OG) is hardcoded English.

**Result:** Google indexes pages with:
- `<html lang="ar" dir="rtl">` 
- Arabic page content
- English `<title>` and `<meta name="description">`
- No `hreflang` tags anywhere

**Impact:** Language signal confusion. English-speaking users may not find the site. Arabic-speaking users see English titles in search results.

**Files:**
- `src/i18n/request.ts:6` — default is Arabic
- `src/app/layout.tsx:14–54` — all metadata English, no `alternates.languages`

**Fix options:**
1. Best: URL-based routing (`/en/`, `/ar/`) with proper `hreflang`
2. Minimum: Add `alternates.languages` to metadata + locale-aware titles/descriptions via `generateMetadata`

---

### S-3: OG Image is SVG — Social Share Preview Broken

**Root cause:** `public/og-image.svg` used in OG and Twitter card metadata.

**Impact:** Facebook, Twitter/X, LinkedIn, WhatsApp, Slack, Telegram — ALL show blank/no preview image when the site is shared.

**Files:**
- `src/app/layout.tsx:40` — `images: [{ url: '/og-image.svg' }]`
- `src/app/layout.tsx:46` — `twitter images: ['/og-image.svg']`
- `public/og-image.svg` — the file itself

**Fix:** Generate `public/og-image.png` (1200×630px, JPG/PNG). Update references.

---

## HIGH Issues

### S-4: `/provider/register` — Public Indexed Page with Zero Metadata

This page is in the sitemap (priority 0.8) and allowed in robots.txt, but it's a `'use client'` component with NO `metadata` export.

**Impact:** Google crawls a page with no `<title>`, no `<meta description>`, falling back to the layout template ("| RescueGo UAE" with no page-specific title).

**File:** `src/app/provider/register/page.tsx`

**Fix:** Create `src/app/provider/register/layout.tsx` with exported metadata, OR refactor to server component wrapper.

---

### S-5: Recovery Pages — Extremely Thin Content

| Page | Word Count | Service Grid | Pricing |
|------|-----------|--------------|---------|
| Dubai | ~150 words | Yes | Yes |
| Abu Dhabi | ~130 words | Yes | Yes |
| Sharjah | ~80 words | No | No |
| Ajman | ~80 words | No | No |
| Ras Al Khaimah | ~80 words | No | No |

**Impact:** Google may treat Sharjah/Ajman/RAK as thin/duplicate content → reduced ranking or deindexing.

**Fix:** Expand each city page to 400–800 words with unique content: local coverage areas, common breakdown scenarios, response times, testimonials.

---

### S-6: No Internal Links Between Recovery Pages

City pages are completely isolated — no cross-links to other cities, no link back to homepage, no link to pricing.

**Impact:** PageRank doesn't flow between local pages. Google doesn't see topical cluster authority.

**Fix:** Add "Other areas we serve" section at the bottom of each recovery page linking to all other city pages.

---

### S-7: Multiple `<h1>` Tags on Key Pages

- `customer/request/page.tsx` — 4 conditional `<h1>` elements (lines 453, 485, 554, 754)
- `provider/register/page.tsx` — 5 conditional `<h1>` elements

**Impact:** While only one renders per state, search engines may see multiple `<h1>` in the source/streaming HTML.

**Fix:** Use `<h1>` only for the primary state; use `<h2>` for error/success states.

---

### S-8: Wrong Schema Type for Marketplace

All recovery pages and root layout use `@type: LocalBusiness`. RescueGo is a platform/marketplace connecting customers with providers — not a physical storefront.

**Impact:** Schema mismatch may prevent Rich Result eligibility or trigger manual review.

**Fix:** Use `@type: ["Service", "EmergencyService"]` for recovery pages. Root layout could use `Organization` or keep `LocalBusiness` with proper physical address.

---

## MEDIUM Issues

### S-9: Auth Pages — No Metadata, No `noindex`

**Files:** `auth/login`, `auth/register`, `auth/forgot-password`, `auth/reset-password`

These are client components with no metadata. While blocked by `robots.txt`, adding `robots: 'noindex'` as belt-and-suspenders is recommended.

**Fix:** Add layout.tsx or generateMetadata wrapper for `/auth/` route group.

---

### S-10: Recovery Pages — No Page-Level OG Tags

All 5 city pages inherit the generic homepage OG content. Sharing any city page on social shows "RescueGo - Roadside Recovery UAE" instead of city-specific title.

**Fix:** Add `openGraph` override in each recovery page's metadata export.

---

### S-11: Pricing Page — Incomplete OG/Twitter

Has `openGraph.title` and `description` but missing `og:image`, `og:type`, Twitter card entirely.

**File:** `src/app/pricing/page.tsx:18–22`

---

### S-12: No PWA Manifest

No `manifest.json` or `src/app/manifest.ts`. For a mobile-first emergency service, PWA is highly relevant (home screen install, offline indicator).

**Fix:** Create `src/app/manifest.ts` with app name, icons, theme color.

---

### S-13: Missing HSTS Header

`next.config.ts` security headers don't include `Strict-Transport-Security`.

**Fix:** Add `{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }` to headers array.

---

### S-14: Sitemap `lastModified` Uses Build Time

`src/app/sitemap.ts:6` — `lastModified: new Date()` marks all URLs as freshly modified on every deploy.

**Fix:** Use static dates per page, or remove `lastModified` for static pages.

---

### S-15: LocalBusiness JSON-LD — Missing Required Fields

Root layout schema (`layout.tsx:62–72`) missing:
- `@id` — required for entity disambiguation
- `telephone` — recommended for Local Pack eligibility
- `address` (full `PostalAddress`) — required for Google Maps/Knowledge Panel
- `geo` (`GeoCoordinates`) — recommended
- `openingHoursSpecification` — important for "24/7" signal
- `sameAs` — social profile links

---

### S-16: About Page — No JSON-LD Schema

Natural location for `Organization` or `WebSite` schema with `founder`, `foundingDate`, `contactPoint`.

**File:** `src/app/about/page.tsx`

---

### S-17: Sharjah/Ajman/RAK Missing `keywords` Metadata

Dubai and Abu Dhabi pages have `keywords`, the other three don't.

---

### S-18: Pricing Page Uses `<a>` for Internal Links

Lines 131, 137: Two CTAs use plain `<a>` instead of Next.js `<Link>`. Hurts prefetching and soft navigation.

---

### S-19: Provider Dashboard Has No `<h1>`

Starts with `<h2>` level cards. No `<h1>` present. (noindex, so LOW SEO impact but HIGH accessibility impact)

---

### S-20: Missing `og:locale:alternate` for Arabic

Root OG has `locale: 'en_AE'` but no `locale:alternate` for `ar_AE`.

**File:** `src/app/layout.tsx:35`

---

## LOW Issues

### S-21: No `apple-touch-icon` or Multi-Size Favicon
Only `favicon.ico` exists. No 180×180, 192×192, 512×512 variants.

### S-22: No Image Sitemap
`sitemap.ts` has no `images` property per URL entry.

### S-23: Admin Pages Use `<a>` Instead of `<Link>`
No SEO impact (noindex) but poor UX (full page reloads).

### S-24: `priceRange: 'Free for drivers'` — Non-Standard
Schema.org expects currency format. Use `"Free"` or remove.

### S-25: Logo in Schema Points to SVG
Google structured data guidelines recommend PNG/JPG for `logo` property.

### S-26: Missing `twitter:site` and `twitter:creator`
No Twitter/X handle configured in root metadata.

---

## Fix Phases (Recommended Order)

### Phase 1 — Critical Fixes (Immediate SEO impact)
| Task | Files | Effort |
|------|-------|--------|
| 1-1: Fix title template duplication | 6 page files | 10 min |
| 1-2: Generate PNG OG image (1200×630) | `public/`, `layout.tsx` | 15 min |
| 1-3: Add HSTS header | `next.config.ts` | 2 min |
| 1-4: Add `alternates.languages` to root metadata | `layout.tsx` | 5 min |

### Phase 2 — Schema & Structured Data
| Task | Files | Effort |
|------|-------|--------|
| 2-1: Fix schema types (Service/EmergencyService) | 6 files | 20 min |
| 2-2: Add missing LocalBusiness fields (@id, telephone, address, geo, hours) | `layout.tsx` | 15 min |
| 2-3: Add Organization schema to About page | `about/page.tsx` | 10 min |
| 2-4: Fix logo URL (SVG → PNG) in schema | `layout.tsx` | 2 min |

### Phase 3 — Recovery Pages SEO
| Task | Files | Effort |
|------|-------|--------|
| 3-1: Expand thin content (Sharjah/Ajman/RAK to 400+ words each) | 3 files | 45 min |
| 3-2: Add internal cross-links between city pages | 5 files | 15 min |
| 3-3: Add page-level OG metadata per city | 5 files | 15 min |
| 3-4: Add `keywords` to Sharjah/Ajman/RAK | 3 files | 5 min |
| 3-5: Add service grid + pricing to Sharjah/Ajman/RAK | 3 files | 20 min |

### Phase 4 — Page Metadata & Indexing
| Task | Files | Effort |
|------|-------|--------|
| 4-1: Add metadata to `/provider/register` (layout.tsx wrapper) | 1 new file | 10 min |
| 4-2: Add `robots: noindex` to auth pages (layout wrapper) | 1 new file | 5 min |
| 4-3: Fix H1 hierarchy on register + customer request pages | 2 files | 10 min |
| 4-4: Complete pricing page OG/Twitter metadata | 1 file | 5 min |
| 4-5: Fix sitemap `lastModified` | `sitemap.ts` | 5 min |

### Phase 5 — PWA & Mobile
| Task | Files | Effort |
|------|-------|--------|
| 5-1: Create `manifest.ts` (name, icons, theme) | 1 new file | 10 min |
| 5-2: Generate apple-touch-icon + PNG favicons (180, 192, 512) | 3 files | 15 min |
| 5-3: Add `twitter:site` handle | `layout.tsx` | 2 min |
| 5-4: Replace `<a>` with `<Link>` on pricing page | `pricing/page.tsx` | 5 min |

### Phase 6 — i18n SEO (Depends on Arabic Audit Phase A)
| Task | Files | Effort |
|------|-------|--------|
| 6-1: Implement locale-aware `generateMetadata` | 10+ files | 1–2 hours |
| 6-2: Add `og:locale:alternate` for `ar_AE` | `layout.tsx` | 5 min |
| 6-3: Consider URL-based locale routing for full hreflang support | Architecture decision | Large |

---

## Total Effort Estimate

| Phase | Priority | Estimated Time |
|-------|----------|----------------|
| Phase 1 | Immediate | 30 min |
| Phase 2 | High | 45 min |
| Phase 3 | High | 1.5 hours |
| Phase 4 | Medium | 35 min |
| Phase 5 | Medium | 30 min |
| Phase 6 | Future (depends on Arabic fixes) | 2+ hours |
| **Total** | | **~5.5 hours** |
