# freym

AI photo & video tool for creatives — Expo/React Native app + the freym prompt scraper.

## App (repo root)

Expo Router app, forked from `foto-room-ai-clean` (aya photo). Bundle id `genai.freym.studio`, EAS project `freym-studio` (`f8b98d76-a118-4a34-b86b-4de4d4b5cf8f`, owner `genue`).

Tabs: **Inspire** (2-column freym prompt feed) · **Photo** (Studio, `app/(tabs)/create.tsx`) · **Video** · **Edit** · **Library**. Copy Shot / Effects / Recipes / Home are archived (re-enableable in Settings).

```bash
npm install
npx expo start        # needs .env with EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY (see .env.example)
```

Backend: shared Supabase project `lmuksetmkzssoewkzdlm` (same as aya photo — models, generation queue, coins, edge functions). The app's edge-function/migration source of truth lives in `~/foto-room-ai-clean/supabase/` — do not redeploy backend functions from this repo except the scraper ones below.

### Services

Wired: App Store Connect app `freym` (id `6794310689`, bundle `genai.freym.studio`, capabilities IAP + Push + Apple Sign-In), RevenueCat iOS key (`config/appVariant.ts`), PostHog project `freym` + Sentry DSN + AppsFlyer app id (`eas.json`).

Still pending:
- RevenueCat: Play Store key (Android launch) + products/offering ("Monthly coins" entitlement) once subscriptions exist in ASC
- AppsFlyer: register the app (App ID 6794310689) in the AppsFlyer dashboard — id is already in `eas.json`

## Scraper + site

- `supabase/functions/scraper-run` — scrapes Threads/X creators via ScrapeCreators, extracts prompts with Claude Haiku
- `supabase/functions/scraper-feed` — public JSON feed (used by the site AND the app's Inspire tab via `lib/freym/feed.ts`)
- `docs/index.html` — static site at freym.app (Vercel; `vercel.json` pins static `docs/` output so the app code doesn't trigger a framework build)
- `nextunyte/` — 488-image gallery dataset (titles + model labels, no prompt text yet; not consumed by app or site)
