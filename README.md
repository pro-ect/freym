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

### Not wired yet (placeholders in code)

- RevenueCat: create "freym" app → keys in `config/appVariant.ts` (empty = purchases disabled)
- PostHog: create new project in Minimal Apps org → `EXPO_PUBLIC_POSTHOG_API_KEY` in `eas.json`
- AppsFlyer: create app once ASC record exists → `EXPO_PUBLIC_APPSFLYER_APP_ID` in `eas.json`
- Sentry: create `freym-studio` project → `EXPO_PUBLIC_SENTRY_DSN`
- App Store id in `app/components/FounderMessageModal.tsx`

## Scraper + site

- `supabase/functions/scraper-run` — scrapes Threads/X creators via ScrapeCreators, extracts prompts with Claude Haiku
- `supabase/functions/scraper-feed` — public JSON feed (used by the site AND the app's Inspire tab via `lib/freym/feed.ts`)
- `docs/index.html` — static site at freym.app (Vercel; `vercel.json` pins static `docs/` output so the app code doesn't trigger a framework build)
- `nextunyte/` — 488-image gallery dataset (titles + model labels, no prompt text yet; not consumed by app or site)
