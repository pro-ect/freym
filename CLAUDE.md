# freym — repo guide

Two things live here:
1. **The freym app** (repo root) — Expo Router app forked from `~/foto-room-ai-clean`. Same Supabase backend (`lmuksetmkzssoewkzdlm`), new identity: name `freym`, bundle id `genai.freym.studio`, EAS project `freym-studio`.
2. **The freym scraper + site** — `supabase/functions/scraper-*` and `docs/index.html` (freym.app on Vercel).

## Rules

- **Do not deploy `supabase/functions/*` from the fork's app features.** This repo's `supabase/` holds ONLY the scraper functions. The shared app backend (start-prediction*, callbacks, revenuecat-webhook, 30+ functions) is deployed from `~/foto-room-ai-clean/supabase/` — that repo is the source of truth for it.
- Models are managed in Supabase tables (`models`, `model_configs`, `model_pricing`), NOT local files — see `~/foto-room-ai-clean/docs/.adding-new-model.md`.
- `docs/` is the freym.app website, not app documentation. Don't overwrite it. `vercel.json` pins Vercel to static `docs/` output — keep it.
- Tab visibility defaults: `config/appVariant.ts` `getDefaultTabs()`; changing the default set requires bumping `TABS_SCHEMA_VERSION` in `contexts/SettingsContext.tsx`.
- Inspire tab reads the scraper feed via `lib/freym/feed.ts` → `scraper-feed` edge function.
- Pre-existing `tsc` errors (~76) were inherited from the source repo; only worry about NEW errors your change introduces.

## Services

Wired: ASC app `freym` id `6794310689` / bundle `genai.freym.studio` (bundle-id `Q36N36Q5GK`, capabilities IAP + PUSH_NOTIFICATIONS + APPLE_ID_AUTH), RevenueCat iOS key in `config/appVariant.ts`, PostHog `freym` project + Sentry DSN + AppsFlyer app id in `eas.json`.

Pending: RevenueCat Play key + products/offering (entitlement `Monthly coins`), AppsFlyer dashboard app registration. Empty keys degrade gracefully. Facebook SDK was removed (`lib/facebook.ts` is a stub).
