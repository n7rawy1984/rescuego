# RescueGo — SEO Audit Report

**Last Updated:** 2026-06-08

---

## Status: Phase 1 + 2 + 4 COMPLETED

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 (Critical) | COMPLETED | Title duplication, OG image, HSTS, hreflang |
| Phase 2 (Schema) | COMPLETED | Schema types, LocalBusiness enrichment, Organization schema |
| Phase 3 (Content) | DEFERRED | Recovery page expansion — syncs with Phase 13 (SEO Domination) |
| Phase 4 (Metadata) | COMPLETED | Register metadata, auth noindex, H1 fix, pricing OG, sitemap |
| Phase 5 (PWA) | DEFERRED | PWA manifest + favicons — syncs with Phase 2C |
| Phase 6 (i18n SEO) | DEFERRED | Locale-aware metadata — depends on Arabic Phase C |

---

## Completed Fixes

### Phase 1 — Critical SEO Fixes

| Issue | Fix | Commit |
|-------|-----|--------|
| S-1: Title template duplication (brand appears twice) | Removed `\| RescueGo` suffix from 6 page-level titles | 62cd7a1 |
| S-2: No hreflang / alternates.languages | Added `alternates.languages` with `ar-AE` and `en-AE` to root layout.tsx metadata | abc43bc |
| S-3: OG image is SVG (not supported by social crawlers) | Created Next.js dynamic `opengraph-image.tsx` + `twitter-image.tsx` routes (PNG 1200x630) | 8aa854a |
| S-13: No HSTS header | Added `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` to next.config.ts | abc43bc |

### Phase 2 — Schema Fixes

| Issue | Fix | Commit |
|-------|-----|--------|
| Recovery pages use wrong `@type: LocalBusiness` | Changed to `['Service', 'EmergencyService']` + added `provider` @id reference | b388a9a |
| Root schema missing key fields | Added `@id`, `telephone`, `PostalAddress`, `GeoCoordinates`, `openingHoursSpecification` (24/7), `sameAs` | b388a9a |
| About page has no schema | Added Organization JSON-LD with `@id`, `logo`, `foundingDate`, `sameAs` | b388a9a |
| Logo in schema references SVG | Changed to `logo.png` | b388a9a |

### Phase 4 — Metadata & Structure

| Issue | Fix | Commit |
|-------|-----|--------|
| Provider register page has no metadata | Created `src/app/provider/register/layout.tsx` with title, description, OG, canonical | f40070a |
| Auth pages indexed by search engines | Created `src/app/auth/layout.tsx` with `robots: { index: false, follow: false }` | f40070a |
| Multiple H1 elements in customer/request page | Changed 3 conditional h1 to h2, kept single primary h1 | f40070a |
| Pricing page missing OG type + twitter card | Added `openGraph.type: 'website'` + full `twitter` card metadata | f40070a |
| Sitemap `lastModified: new Date()` (changes every request) | Replaced with static dates per page | f40070a |

---

## Remaining Issues (Deferred)

### Phase 3 — Content Expansion (Syncs with Phase 13: SEO Domination)

| Issue | Description |
|-------|-------------|
| Recovery pages thin content | Dubai page is good (~400 words). Other 4 cities are thin (~150 words each). Need unique, locally-relevant content per city. |
| No internal linking between recovery pages | Add "Also serving" links between city pages. |
| No FAQ schema on recovery pages | Add FAQ JSON-LD for common roadside questions per city. |

### Phase 5 — PWA (Syncs with Phase 2C: PWA Strategy)

| Issue | Description |
|-------|-------------|
| No `manifest.json` | Need Web App Manifest for installability. |
| No favicon variants | Only basic favicon exists. Need apple-touch-icon, 192x192, 512x512. |
| No `theme-color` meta | Add brand green `#1D9E75` as theme color. |

### Phase 6 — i18n SEO (Depends on Arabic Phase C)

| Issue | Description |
|-------|-------------|
| All metadata English-only | 14 files have hardcoded English titles/descriptions. Need `generateMetadata()` with translations. |
| No per-page hreflang | Root alternates added but individual pages don't declare language alternates. |
| Cookie-based locale invisible to crawlers | Crawlers always see Arabic content with English metadata. Needs architectural decision. |

---

## Score Improvement

| Metric | Before | After |
|--------|--------|-------|
| Title correctness | 4/10 (duplicated brand) | 9/10 |
| OG/Social sharing | 3/10 (SVG not rendered) | 9/10 |
| Schema quality | 4/10 (wrong types, minimal) | 8/10 |
| Security headers | 6/10 (missing HSTS) | 9/10 |
| Crawl directives | 5/10 (auth indexed, no hreflang) | 8/10 |
| H1 hierarchy | 6/10 (multiple h1s) | 9/10 |
| Sitemap quality | 7/10 (dynamic dates) | 9/10 |
| **Overall SEO** | **~50%** | **~85%** |
