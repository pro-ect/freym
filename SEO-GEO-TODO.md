# freym.app — SEO/GEO todo

Working list for search + AI-search visibility. Done items move to the bottom.

## Open

- [ ] **Brand mentions push (Reddit, YouTube)** — per GEO research (Ahrefs Dec 2025, 75k brands), brand mentions correlate ~3× more strongly with AI citations than backlinks; YouTube mentions are the strongest single signal (~0.737), Reddit is next. freym already has `/youtube` (tutorials for models in the news) and `/creators` — leverage them: get freym mentioned/linked in YouTube tutorial descriptions and relevant Reddit threads (r/StableDiffusion, r/aivideo, model-release threads) as the "release timeline / where is it available" reference. Only 11% of domains get cited by both ChatGPT and Google AIO — platform-specific presence matters.
- [ ] **OG images** — model pages reuse scraped announcement images where available; hub/blog/home have none. Generate branded OG images for /models/, /blog/ and articles.
- [ ] **Wikidata/entity presence** — freym has no entity footprint (Wikipedia/Wikidata/LinkedIn); ChatGPT citations skew heavily to Wikipedia-backed entities. Long-term.

## Potential backlinks / distribution pipeline

Vetted 2026-08-08 (browser-agent sweep; mass-submission deliberately skipped as spam risk — work these one at a time, each with a real profile or real content). Community launches and editorial matter double for GEO: Reddit and HN are top LLM citation sources.

### Best-fit directories
- [ ] Toolify — strongest topical match (AI prompt/model discovery)
- [ ] AlternativeTo — strong software discovery; new accounts may face a waiting period
- [ ] Alternative.me — AI/software alternative listing; account required
- [ ] SaaSHub — software directory; requires accepting terms
- [ ] Product Hunt — save for a coordinated launch (pair with Show HN)
- [ ] BetaList — early-stage startup submission
- [ ] Tiny Startups / TinyLaunch — early-stage AI product launch directories
- [ ] StackShare — publish freym's tech stack (Expo, Supabase, Vercel, fal)
- [ ] Startup List — general startup/product listing
- [ ] Indie Page — founder profile; may require revenue-provider connection
- [ ] TrustMRR — later, if disclosing verified revenue
- [ ] Crunchbase — company profile; needs accurate founder/company details
- [ ] SourceForge / OSS Gallery — only if a repo ships under a recognized OSS license

### Community launches (high GEO value)
- [ ] Hacker News — genuine "Show HN" explaining how freym was built (scraper → catalog pipeline is a good story)
- [ ] Indie Hackers — product page + substantive build story
- [ ] Reddit — share in AI/gen-media subs where self-promotion is permitted (model-release threads fit the catalog pages naturally)
- [ ] DEV Community / Hashnode — technical article (e.g. "building a static AI-model catalog from scraped announcements")
- [ ] HackerNoon — original editorial on AI-video prompting or model evaluation
- [ ] DZone — only for developer-focused technical content
- [ ] Medium — model guides linking to the relevant /models pages
- [ ] Substack — if the daily article pipeline becomes a recurring model-news newsletter
- [ ] Quora — answer relevant questions; link only when a freym page directly supports the answer

### Editorial opportunities (need traction/story first)
- [ ] YourStory, Starter Story, Failory, Founder Reports, Indie Bites, Micro Founder — founder interviews/profiles
- [ ] VentureBeat / TechCrunch — reserve for substantial news, funding, or an exclusive data story (the news-archive dataset could anchor one, e.g. "we tracked every model release of 2026")

### Avoid
Backlink-only profiles on Yelp, Goodreads, Flickr, Pixabay, Pexels, Fandom, Wikipedia, or unrelated publishing platforms — poor matches, spam signal.

## Done

- [x] 2026-08-08 — Google Search Console: verified (Domain property, Porkbun DNS TXT), sitemap submitted (41 URLs discovered), indexing requested for /, /models/, /blog/, /models/seedance-2-5/
- [x] 2026-08-08 — Bing Webmaster Tools: verified via GSC import, sitemap submitted (processing)
- [x] 2026-08-08 — IndexNow: key file at docs/79404fdffa854642b50fb5d8f4f0de30.txt; generator pings api.indexnow.org for changed pages on every run (generator now skips unchanged pages so dateModified/lastmod stay honest). Note: directory/listing mass-submission was deliberately skipped as spam risk — brand mentions should come from editorial/organic placements only.
- [x] 2026-08-08 — robots.txt (AI crawlers explicitly allowed), sitemap.xml, llms.txt
- [x] 2026-08-08 — /models catalog: 28 static model pages (AI crawlers don't run JS; /news is client-rendered and invisible to them) with timelines, FAQ, JSON-LD
- [x] 2026-08-08 — /blog: 5 articles from scraped announcements, Article schema, citable answer blocks
- [x] 2026-08-08 — canonical/OG/JSON-LD on existing pages, nav links to models + blog
- [x] 2026-08-08 — daily cloud routine (07:00 UTC) regenerates catalog, extends registry, drafts articles on big releases: https://claude.ai/code/routines/trig_019rAFshomPHp5mwkyRCT6h9
