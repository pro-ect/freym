#!/usr/bin/env node
// build-models-site.mjs — generates the static /models catalog, /blog articles,
// sitemap.xml and llms.txt for freym.app (docs/ output, served by Vercel).
//
// Usage: node scripts/build-models-site.mjs [--offline]
//   --offline  skip the feed fetch, build from data/news-archive.json only
//
// Data flow: scraper-news-feed (public edge fn, 90-day window) → merged into
// data/news-archive.json (permanent, by item id) → matched to models via
// scripts/model-registry.json aliases → static HTML into docs/models/.
// Articles: content/articles/<slug>.html fragments (first line: <!--meta {json}-->).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = path.join(ROOT, "docs");
const SITE = "https://freym.app";
const FEED_URL =
  "https://lmuksetmkzssoewkzdlm.supabase.co/functions/v1/scraper-news-feed?days=90";
// Public anon key (already shipped in docs/news/index.html).
const ANON_KEY =
  fs.readFileSync(path.join(DOCS, "news/index.html"), "utf8").match(/ANON_KEY = "([^"]+)"/)?.[1] ?? "";

const registry = JSON.parse(
  fs.readFileSync(path.join(ROOT, "scripts/model-registry.json"), "utf8"),
).models;

// ---------- data ----------

const archivePath = path.join(ROOT, "data/news-archive.json");
let archive = { sources: {}, items: {} };
if (fs.existsSync(archivePath)) archive = JSON.parse(fs.readFileSync(archivePath, "utf8"));

const offline = process.argv.includes("--offline");
if (!offline) {
  const res = await fetch(FEED_URL, { headers: { Authorization: `Bearer ${ANON_KEY}` } });
  if (!res.ok) throw new Error(`feed fetch failed: ${res.status}`);
  const feed = await res.json();
  for (const s of feed.sources ?? []) archive.sources[s.id] = s;
  for (const it of feed.items ?? []) archive.items[it.id] = it;
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.writeFileSync(archivePath, JSON.stringify(archive, null, 1));
}

const sources = archive.sources;
const items = Object.values(archive.items)
  .filter((it) => it.is_news)
  .sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1));

// ---------- matching ----------

const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
const aliasMap = new Map();
for (const m of registry) for (const a of m.aliases) aliasMap.set(norm(a), m.slug);

const byModel = new Map(registry.map((m) => [m.slug, []]));
for (const it of items) {
  if (!it.model_name) continue;
  const hits = new Set();
  const whole = aliasMap.get(norm(it.model_name));
  if (whole) hits.add(whole);
  else for (const part of it.model_name.split(",")) {
    const hit = aliasMap.get(norm(part));
    if (hit) hits.add(hit);
  }
  for (const slug of hits) byModel.get(slug).push(it);
}

// ---------- html helpers ----------

// Write a page only if its content actually changed (ignoring the daily date
// stamps), so dateModified/lastmod stay honest and IndexNow only gets pinged
// for real changes.
const changedUrls = [];
const normalize = (html) =>
  html
    .replace(/([Uu]pdated )\d{4}-\d{2}-\d{2}/g, "$1DATE")
    .replace(/"dateModified":"\d{4}-\d{2}-\d{2}"/g, '"dateModified":"DATE"');
function writePage(relDir, html) {
  const dir = relDir ? path.join(DOCS, relDir) : DOCS;
  const filePath = path.join(dir, "index.html");
  if (fs.existsSync(filePath) && normalize(fs.readFileSync(filePath, "utf8")) === normalize(html)) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, html);
  changedUrls.push(relDir ? `${SITE}/${relDir}/` : `${SITE}/`);
}
// Remove subdirectories of docs/<parent> that are no longer generated.
function pruneStale(parent, expectedSlugs) {
  const dir = path.join(DOCS, parent);
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !expectedSlugs.includes(e.name))
      fs.rmSync(path.join(dir, e.name), { recursive: true, force: true });
  }
}

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
const isoDay = (iso) => iso.slice(0, 10);
const today = new Date().toISOString().slice(0, 10);

const CSS = `
  :root { --bg:#f5f4ee; --ink:#111110; --muted:#6f6d66; --line:#e4e2d8; --card:#ffffff; --accent:#ff4d00; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Inter",Helvetica,Arial,sans-serif; -webkit-font-smoothing:antialiased; }
  a { color:inherit; text-decoration:none; }
  header { display:flex; align-items:center; justify-content:space-between; padding:22px 40px; flex-wrap:wrap; gap:10px; }
  .wordmark { font-weight:700; font-size:19px; letter-spacing:-0.02em; }
  .wordmark span { color:var(--accent); }
  nav.top { display:flex; gap:4px; flex-wrap:wrap; }
  nav.top a { font-size:14px; color:var(--muted); padding:6px 13px; border-radius:999px; }
  nav.top a:hover { color:var(--ink); }
  nav.top a.active { background:var(--ink); color:var(--bg); }
  main { max-width:820px; margin:0 auto; padding:32px 24px 80px; }
  .crumbs { font-size:13px; color:var(--muted); margin-bottom:28px; }
  .crumbs a:hover { color:var(--ink); }
  h1 { font-size:clamp(30px,4.6vw,44px); font-weight:600; letter-spacing:-0.03em; line-height:1.08; margin-bottom:14px; }
  .lede { font-size:17px; line-height:1.6; color:var(--ink); margin-bottom:8px; max-width:64ch; }
  .meta-line { font-size:13px; color:var(--muted); margin-bottom:34px; }
  h2 { font-size:22px; font-weight:600; letter-spacing:-0.02em; margin:42px 0 16px; }
  h3 { font-size:16px; font-weight:600; margin:0 0 4px; }
  p { font-size:15px; line-height:1.65; margin-bottom:14px; }
  .facts { width:100%; border-collapse:collapse; margin:8px 0 10px; font-size:14px; }
  .facts td { padding:9px 12px 9px 0; border-bottom:1px solid var(--line); vertical-align:top; }
  .facts td:first-child { color:var(--muted); white-space:nowrap; width:160px; }
  .tl-item { border-left:2px solid var(--line); padding:0 0 26px 20px; position:relative; }
  .tl-item:before { content:""; position:absolute; left:-5px; top:5px; width:8px; height:8px; border-radius:50%; background:var(--accent); }
  .tl-date { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em; margin-bottom:3px; }
  .tl-date .cat { background:var(--card); border:1px solid var(--line); border-radius:999px; padding:1px 8px; margin-left:6px; text-transform:none; letter-spacing:0; }
  .tl-item p { font-size:14px; color:var(--ink); margin:4px 0 6px; max-width:62ch; }
  .tl-src { font-size:13px; color:var(--muted); }
  .tl-src a { color:var(--accent); }
  .tl-img { max-width:340px; width:100%; border-radius:10px; border:1px solid var(--line); margin:8px 0 4px; display:block; }
  .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:14px; margin-top:8px; }
  .mcard { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; display:flex; flex-direction:column; gap:6px; transition:border-color .15s ease; }
  .mcard:hover { border-color:var(--ink); }
  .mcard .co { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; }
  .mcard .nm { font-size:17px; font-weight:600; letter-spacing:-0.01em; }
  .mcard .tp { font-size:13px; color:var(--muted); }
  .mcard .nn { font-size:12px; color:var(--muted); margin-top:auto; padding-top:8px; }
  .faq details { border-bottom:1px solid var(--line); padding:12px 0; }
  .faq summary { font-size:15px; font-weight:600; cursor:pointer; }
  .faq p { margin:10px 0 2px; color:var(--ink); }
  .art-list { display:flex; flex-direction:column; gap:0; }
  .art-row { display:block; padding:20px 0; border-bottom:1px solid var(--line); }
  .art-row .d { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em; }
  .art-row h3 { font-size:19px; margin:5px 0 6px; }
  .art-row:hover h3 { color:var(--accent); }
  .art-row p { font-size:14px; color:var(--muted); margin:0; }
  article h2 { margin-top:38px; }
  article ul, article ol { margin:0 0 16px 22px; font-size:15px; line-height:1.65; }
  article li { margin-bottom:6px; }
  article table { width:100%; border-collapse:collapse; margin:10px 0 18px; font-size:14px; }
  article th, article td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); }
  article th { color:var(--muted); font-weight:600; }
  article blockquote { border-left:3px solid var(--accent); padding:2px 0 2px 16px; color:var(--muted); margin:0 0 16px; }
  .related { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px 20px; margin-top:30px; }
  .related .t { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px; }
  .related a { display:inline-block; margin:0 12px 4px 0; font-size:14px; color:var(--accent); }
  footer { border-top:1px solid var(--line); padding:26px 40px; font-size:13px; color:var(--muted); display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px; }
  footer a { color:var(--muted); margin-right:14px; }
  footer a:hover { color:var(--ink); }
`;

function page({ title, description, canonical, active, body, jsonld, ogImage }) {
  const ld = (Array.isArray(jsonld) ? jsonld : [jsonld]).filter(Boolean);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${canonical}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:type" content="${canonical.includes("/blog/") ? "article" : "website"}" />
<meta property="og:site_name" content="freym" />
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}" />\n<meta name="twitter:card" content="summary_large_image" />` : `<meta name="twitter:card" content="summary" />`}
${ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join("\n")}
<style>${CSS}</style>
</head>
<body>
<header>
  <a class="wordmark" href="/">freym<span>.</span></a>
  <nav class="top">
    <a href="/"${active === "work" ? ' class="active"' : ""}>work</a>
    <a href="/news/"${active === "news" ? ' class="active"' : ""}>news</a>
    <a href="/models/"${active === "models" ? ' class="active"' : ""}>models</a>
    <a href="/blog/"${active === "blog" ? ' class="active"' : ""}>blog</a>
    <a href="/creators/">creators</a>
    <a href="/youtube/">youtube</a>
  </nav>
</header>
<main>
${body}
</main>
<footer>
  <div>
    <a href="/models/">models</a><a href="/blog/">blog</a><a href="/news/">news</a><a href="/llms.txt">llms.txt</a>
  </div>
  <div>freym — AI models, prompts and news · updated ${today}</div>
</footer>
</body>
</html>
`;
}

const breadcrumbs = (parts) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: parts.map(([name, url], i) => ({
    "@type": "ListItem",
    position: i + 1,
    name,
    item: SITE + url,
  })),
});

// ---------- articles (fragments in content/articles) ----------

const artDir = path.join(ROOT, "content/articles");
const articles = [];
if (fs.existsSync(artDir)) {
  for (const f of fs.readdirSync(artDir).filter((f) => f.endsWith(".html"))) {
    const raw = fs.readFileSync(path.join(artDir, f), "utf8");
    const m = raw.match(/^<!--meta\s+(\{[\s\S]*?\})\s*-->/);
    if (!m) throw new Error(`article ${f}: missing <!--meta {json}--> front matter`);
    const meta = JSON.parse(m[1]);
    articles.push({ ...meta, slug: f.replace(/\.html$/, ""), html: raw.slice(m[0].length).trim() });
  }
}
articles.sort((a, b) => (a.date < b.date ? 1 : -1));

// ---------- model pages ----------

const modelsWithNews = registry
  .map((m) => ({ ...m, items: byModel.get(m.slug) }))
  .sort((a, b) => {
    const la = a.items[0]?.taken_at ?? "", lb = b.items[0]?.taken_at ?? "";
    return la < lb ? 1 : -1;
  });

pruneStale("models", modelsWithNews.map((m) => m.slug));

for (const m of modelsWithNews) {
  const latest = m.items[0];
  const availability = m.items.filter((it) => it.category === "availability");
  const platforms = [...new Set(availability.map((it) => sources[it.source_id]?.company).filter(Boolean))];
  const related = articles.filter((a) => (a.models ?? []).includes(m.slug));
  const ogImage = m.items.find((it) => it.image_url)?.image_url;

  const faq = [
    [`What is ${m.name}?`, m.description],
    [`Who makes ${m.name.split(" (")[0]}?`,
      `${m.name.split(" (")[0]} is developed by ${m.company}. This page tracks its official announcements as they happen.`],
    ...(platforms.length
      ? [[`Where is ${m.name.split(" (")[0]} available?`,
          `Based on official announcements tracked here, it is available via: ${platforms.join(", ")}.`]]
      : []),
    ...(latest
      ? [[`What is the latest ${m.name.split(" (")[0]} news?`,
          `${latest.headline} (${fmtDate(latest.taken_at)}). ${latest.summary ?? ""}`]]
      : []),
  ];

  const timeline = m.items.map((it) => {
    const s = sources[it.source_id] ?? {};
    return `<div class="tl-item">
  <div class="tl-date"><time datetime="${isoDay(it.taken_at)}">${fmtDate(it.taken_at)}</time><span class="cat">${esc(it.category ?? "news")}</span></div>
  <h3>${esc(it.headline ?? "")}</h3>
  ${it.image_url ? `<img class="tl-img" src="${esc(it.image_url)}" alt="${esc(it.headline ?? m.name)}" loading="lazy" />` : ""}
  <p>${esc(it.summary ?? "")}</p>
  <div class="tl-src">Source: <a href="${esc(it.url)}" rel="nofollow noopener" target="_blank">@${esc(s.handle ?? "")} on X →</a></div>
</div>`;
  }).join("\n");

  const body = `
<div class="crumbs"><a href="/">freym</a> / <a href="/models/">models</a> / ${esc(m.name)}</div>
<h1>${esc(m.name)}</h1>
<p class="lede">${esc(m.description)}</p>
<div class="meta-line">By ${esc(m.company)} · ${esc(m.type)}${latest ? ` · Last update tracked ${fmtDate(latest.taken_at)}` : ""} · Page updated ${today}</div>

<h2>Key facts</h2>
<table class="facts">
  <tr><td>Developer</td><td>${esc(m.company)}</td></tr>
  <tr><td>Category</td><td>${esc(m.type)}</td></tr>
  <tr><td>Notable for</td><td>${esc(m.highlight)}</td></tr>
  ${platforms.length ? `<tr><td>Available via</td><td>${esc(platforms.join(", "))}</td></tr>` : ""}
  <tr><td>Tracked announcements</td><td>${m.items.length}</td></tr>
</table>

${m.items.length ? `<h2>Announcement timeline</h2>\n${timeline}` : ""}

<h2>FAQ</h2>
<div class="faq">
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}
</div>

${related.length ? `<div class="related"><div class="t">Read more on freym</div>${related.map((a) => `<a href="/blog/${a.slug}/">${esc(a.title)}</a>`).join("")}</div>` : ""}
<div class="related"><div class="t">Explore</div><a href="/models/">All models</a><a href="/news/">Live model news feed</a><a href="/next/">Prompt gallery</a></div>
`;

  const jsonld = [
    breadcrumbs([["freym", "/"], ["Models", "/models/"], [m.name, `/models/${m.slug}/`]]),
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: `${m.name} — release timeline, availability and news`,
      url: `${SITE}/models/${m.slug}/`,
      dateModified: today,
      description: m.description,
      mainEntity: {
        "@type": "Thing",
        name: m.name,
        description: m.description,
        creator: { "@type": "Organization", name: m.company },
      },
      publisher: { "@type": "Organization", name: "freym", url: SITE },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map(([q, a]) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    },
  ];

  writePage(
    `models/${m.slug}`,
    page({
      title: `${m.name} by ${m.company} — release timeline & news | freym`,
      description: `${m.name}: ${m.type} by ${m.company}. ${m.highlight} Release timeline and availability, tracked from official announcements.`,
      canonical: `${SITE}/models/${m.slug}/`,
      active: "models",
      body,
      jsonld,
      ogImage,
    }),
  );
}

// ---------- models hub ----------

const companies = [...new Set(registry.map((m) => m.company))];
const hubCards = modelsWithNews.map((m) => {
  const latest = m.items[0];
  return `<a class="mcard" href="/models/${m.slug}/">
  <div class="co">${esc(m.company)}</div>
  <div class="nm">${esc(m.name)}</div>
  <div class="tp">${esc(m.type)}</div>
  <div class="nn">${m.items.length} tracked announcement${m.items.length === 1 ? "" : "s"}${latest ? ` · latest ${isoDay(latest.taken_at)}` : ""}</div>
</a>`;
}).join("\n");

const hubBody = `
<div class="crumbs"><a href="/">freym</a> / models</div>
<h1>AI model catalog</h1>
<p class="lede">The freym model catalog tracks ${registry.length} generative-AI models from ${companies.length} companies — image, video, audio and language models — built from ${items.length} official announcements scraped from the model makers' own X accounts. Each model page has a dated release timeline, availability across platforms, and sourced citations.</p>
<div class="meta-line">Updated ${today} · Sources: official company X accounts · <a href="/news/" style="color:var(--accent)">live news feed →</a></div>
<div class="cards">
${hubCards}
</div>
`;

writePage(
  "models",
  page({
    title: "AI model catalog — every gen-AI model release, tracked | freym",
    description: `Catalog of ${registry.length} generative-AI models from ${companies.length} companies (ByteDance, OpenAI, Alibaba, Black Forest Labs, Tencent, Google…) with dated release timelines built from official announcements.`,
    canonical: `${SITE}/models/`,
    active: "models",
    body: hubBody,
    jsonld: [
      breadcrumbs([["freym", "/"], ["Models", "/models/"]]),
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: "freym AI model catalog",
        numberOfItems: registry.length,
        itemListElement: modelsWithNews.map((m, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: m.name,
          url: `${SITE}/models/${m.slug}/`,
        })),
      },
    ],
  }),
);

// ---------- blog ----------

pruneStale("blog", articles.map((a) => a.slug));

for (const a of articles) {
  const relatedModels = (a.models ?? [])
    .map((slug) => registry.find((m) => m.slug === slug))
    .filter(Boolean);
  const body = `
<div class="crumbs"><a href="/">freym</a> / <a href="/blog/">blog</a> / ${esc(a.title)}</div>
<article>
<h1>${esc(a.title)}</h1>
<div class="meta-line">Published <time datetime="${a.date}">${fmtDate(a.date)}</time> · by freym · sourced from official announcements</div>
${a.html}
</article>
${relatedModels.length ? `<div class="related"><div class="t">Models in this story</div>${relatedModels.map((m) => `<a href="/models/${m.slug}/">${esc(m.name)}</a>`).join("")}</div>` : ""}
<div class="related"><div class="t">Explore</div><a href="/models/">Model catalog</a><a href="/news/">Live model news feed</a><a href="/blog/">All articles</a></div>
`;
  writePage(
    `blog/${a.slug}`,
    page({
      title: `${a.title} | freym`,
      description: a.description,
      canonical: `${SITE}/blog/${a.slug}/`,
      active: "blog",
      body,
      jsonld: [
        breadcrumbs([["freym", "/"], ["Blog", "/blog/"], [a.title, `/blog/${a.slug}/`]]),
        {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: a.title,
          description: a.description,
          datePublished: a.date,
          dateModified: a.date,
          url: `${SITE}/blog/${a.slug}/`,
          author: { "@type": "Organization", name: "freym", url: SITE },
          publisher: { "@type": "Organization", name: "freym", url: SITE },
        },
      ],
    }),
  );
}

const blogBody = `
<div class="crumbs"><a href="/">freym</a> / blog</div>
<h1>Model news, explained</h1>
<p class="lede">Articles on new AI model releases and what they mean — written from the official announcements we track in the <a href="/news/" style="color:var(--accent)">live news feed</a> and the <a href="/models/" style="color:var(--accent)">model catalog</a>.</p>
<div class="meta-line">Updated ${today}</div>
<div class="art-list">
${articles.map((a) => `<a class="art-row" href="/blog/${a.slug}/"><div class="d"><time datetime="${a.date}">${fmtDate(a.date)}</time></div><h3>${esc(a.title)}</h3><p>${esc(a.description)}</p></a>`).join("\n")}
</div>
`;
writePage(
  "blog",
  page({
    title: "Blog — AI model releases, explained | freym",
    description: "Articles on new generative-AI model releases — Seedance, FLUX, Qwen, GPT and more — written from official announcements.",
    canonical: `${SITE}/blog/`,
    active: "blog",
    body: blogBody,
    jsonld: [breadcrumbs([["freym", "/"], ["Blog", "/blog/"]])],
  }),
);

// ---------- robots.txt / llms.txt / sitemap.xml ----------

fs.writeFileSync(path.join(DOCS, "robots.txt"), `# freym.app — all crawlers welcome, including AI search crawlers.
User-agent: *
Allow: /

User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

Sitemap: ${SITE}/sitemap.xml
`);

const llms = `# freym
> freym tracks generative-AI models: a catalog of model releases built from official announcements, a live model-news feed, and a gallery of AI works with the full prompts behind them.

## Model catalog
- [All models](${SITE}/models/): ${registry.length} gen-AI models with dated release timelines and availability
${modelsWithNews.map((m) => `- [${m.name}](${SITE}/models/${m.slug}/): ${m.type} by ${m.company} — ${m.highlight}`).join("\n")}

## Articles
${articles.map((a) => `- [${a.title}](${SITE}/blog/${a.slug}/): ${a.description}`).join("\n")}

## Feeds & galleries
- [Model news](${SITE}/news/): live feed of model releases and updates from official company X accounts
- [Prompt gallery](${SITE}/next/): curated AI works, each with the complete prompt
- [Creators](${SITE}/creators/): hand-picked AI creators worth following
- [YouTube tutorials](${SITE}/youtube/): fresh tutorials for models in the news
`;
fs.writeFileSync(path.join(DOCS, "llms.txt"), llms);

// sitemap: every index.html under docs/
const urls = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === "index.html") {
      const rel = path.relative(DOCS, path.dirname(p)).replace(/\\/g, "/");
      const url = rel === "" ? `${SITE}/` : `${SITE}/${rel}/`;
      urls.push({ url, lastmod: fs.statSync(p).mtime.toISOString().slice(0, 10) });
    }
  }
})(DOCS);
urls.sort((a, b) => a.url.localeCompare(b.url));
fs.writeFileSync(path.join(DOCS, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.url}</loc><lastmod>${u.lastmod}</lastmod></url>`).join("\n")}
</urlset>
`);

// ---------- IndexNow ping (Bing/Copilot) ----------
// Key file lives at docs/<key>.txt. Pings only genuinely changed pages;
// --ping-all submits every sitemap URL (one-time seeding); --no-ping skips.

const INDEXNOW_KEY = "79404fdffa854642b50fb5d8f4f0de30";
const pingList = process.argv.includes("--ping-all") ? urls.map((u) => u.url) : changedUrls;
if (!process.argv.includes("--no-ping") && pingList.length) {
  try {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: "freym.app",
        key: INDEXNOW_KEY,
        keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`,
        urlList: pingList.slice(0, 10000),
      }),
    });
    console.log(`indexnow: HTTP ${res.status} for ${pingList.length} urls`);
  } catch (e) {
    console.log(`indexnow: ping failed (${e.message}) — non-fatal`);
  }
}

console.log(`built: ${modelsWithNews.length} model pages, ${articles.length} articles, ${urls.length} sitemap urls, ${changedUrls.length} changed, archive ${Object.keys(archive.items).length} items`);
