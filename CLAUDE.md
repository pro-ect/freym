# freym — repo guide

Two things live here:
1. **The freym app** (repo root) — Expo Router app forked from `~/foto-room-ai-clean`. Same Supabase backend (`lmuksetmkzssoewkzdlm`), new identity: name `freym`, bundle id `genai.freym.studio`, EAS project `freym-studio`.
2. **The freym scraper + site** — `supabase/functions/scraper-*` and `docs/index.html` (freym.app on Vercel). `scraper-run`/`scraper-feed` power the prompts feed (`sc_*` tables); `scraper-news-run`/`scraper-news-feed` power the model-news feed at `/news` (`news_sources`/`news_items` tables, official gen-AI company X accounts, Haiku classifies news vs noise). Known gaps: @xai returns 0 tweets from ScrapeCreators; LTX Studio's X handle renamed (not found); ByteDance Seed has no known X handle (only ByteDanceOSS); Threads @tinapro.ai is public but ScrapeCreators /threads/profile 404s on it (profile likely not in their index yet — retried, persistent as of 2026-08-07).

3. **freym canvas** — `canvas/` (Vite + React + @xyflow/react, node-canvas ported from ~/nigma's nodes app) builds into `docs/canvas/` → served at freym.app/canvas. Weavy-style node UI: prompt/image nodes wired into model nodes; models come from the shared `models` table; runs go through `start-prediction-fal` etc. and land via `generation_queue` realtime. Projects persist in `canvas_projects` (RLS per user). Access: passphrase → SHA-256 → deviceId → `guest-auth`; Eugene's admin passphrase account has a topped-up `profiles.coin_balance`. After changing `canvas/src`, run `npm run build` in `canvas/` and commit the `docs/canvas/` output — Vercel serves static docs/ only.

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
