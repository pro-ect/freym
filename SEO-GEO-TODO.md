# freym.app — SEO/GEO todo

Working list for search + AI-search visibility. Done items move to the bottom.

## Open

- [ ] **Brand mentions push (Reddit, YouTube)** — per GEO research (Ahrefs Dec 2025, 75k brands), brand mentions correlate ~3× more strongly with AI citations than backlinks; YouTube mentions are the strongest single signal (~0.737), Reddit is next. freym already has `/youtube` (tutorials for models in the news) and `/creators` — leverage them: get freym mentioned/linked in YouTube tutorial descriptions and relevant Reddit threads (r/StableDiffusion, r/aivideo, model-release threads) as the "release timeline / where is it available" reference. Only 11% of domains get cited by both ChatGPT and Google AIO — platform-specific presence matters.
- [ ] **Google Search Console** — verify freym.app (Domain property via Vercel DNS TXT), submit sitemap.xml, request indexing for /, /models/, /blog/, /models/seedance-2-5/. (Computer-use prompt prepared 2026-08-08.)
- [ ] **Bing Webmaster Tools** — add site (import from GSC), submit sitemap. Feeds Copilot citations.
- [ ] **IndexNow** — add key file + ping on each daily refresh so Bing/Copilot pick up new model pages instantly (can be added to scripts/build-models-site.mjs once the key exists).
- [ ] **OG images** — model pages reuse scraped announcement images where available; hub/blog/home have none. Generate branded OG images for /models/, /blog/ and articles.
- [ ] **Wikidata/entity presence** — freym has no entity footprint (Wikipedia/Wikidata/LinkedIn); ChatGPT citations skew heavily to Wikipedia-backed entities. Long-term.

## Done

- [x] 2026-08-08 — robots.txt (AI crawlers explicitly allowed), sitemap.xml, llms.txt
- [x] 2026-08-08 — /models catalog: 28 static model pages (AI crawlers don't run JS; /news is client-rendered and invisible to them) with timelines, FAQ, JSON-LD
- [x] 2026-08-08 — /blog: 5 articles from scraped announcements, Article schema, citable answer blocks
- [x] 2026-08-08 — canonical/OG/JSON-LD on existing pages, nav links to models + blog
- [x] 2026-08-08 — daily cloud routine (07:00 UTC) regenerates catalog, extends registry, drafts articles on big releases: https://claude.ai/code/routines/trig_019rAFshomPHp5mwkyRCT6h9
