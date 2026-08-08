# freym.app — SEO/GEO todo

Working list for search + AI-search visibility. Done items move to the bottom.

## Open

- [ ] **Brand mentions push (Reddit, YouTube)** — per GEO research (Ahrefs Dec 2025, 75k brands), brand mentions correlate ~3× more strongly with AI citations than backlinks; YouTube mentions are the strongest single signal (~0.737), Reddit is next. freym already has `/youtube` (tutorials for models in the news) and `/creators` — leverage them: get freym mentioned/linked in YouTube tutorial descriptions and relevant Reddit threads (r/StableDiffusion, r/aivideo, model-release threads) as the "release timeline / where is it available" reference. Only 11% of domains get cited by both ChatGPT and Google AIO — platform-specific presence matters.
- [ ] **OG images** — model pages reuse scraped announcement images where available; hub/blog/home have none. Generate branded OG images for /models/, /blog/ and articles.
- [ ] **Wikidata/entity presence** — freym has no entity footprint (Wikipedia/Wikidata/LinkedIn); ChatGPT citations skew heavily to Wikipedia-backed entities. Long-term.

## Done

- [x] 2026-08-08 — Google Search Console: verified (Domain property, Porkbun DNS TXT), sitemap submitted (41 URLs discovered), indexing requested for /, /models/, /blog/, /models/seedance-2-5/
- [x] 2026-08-08 — Bing Webmaster Tools: verified via GSC import, sitemap submitted (processing)
- [x] 2026-08-08 — IndexNow: key file at docs/79404fdffa854642b50fb5d8f4f0de30.txt; generator pings api.indexnow.org for changed pages on every run (generator now skips unchanged pages so dateModified/lastmod stay honest). Note: directory/listing mass-submission was deliberately skipped as spam risk — brand mentions should come from editorial/organic placements only.
- [x] 2026-08-08 — robots.txt (AI crawlers explicitly allowed), sitemap.xml, llms.txt
- [x] 2026-08-08 — /models catalog: 28 static model pages (AI crawlers don't run JS; /news is client-rendered and invisible to them) with timelines, FAQ, JSON-LD
- [x] 2026-08-08 — /blog: 5 articles from scraped announcements, Article schema, citable answer blocks
- [x] 2026-08-08 — canonical/OG/JSON-LD on existing pages, nav links to models + blog
- [x] 2026-08-08 — daily cloud routine (07:00 UTC) regenerates catalog, extends registry, drafts articles on big releases: https://claude.ai/code/routines/trig_019rAFshomPHp5mwkyRCT6h9
