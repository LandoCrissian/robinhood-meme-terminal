# RMT search distribution plan

**Status:** implementation plan aligned to the 2026-08-12 architecture freeze
**Scope:** unpaid search discovery and public web distribution
**Canonical product:** VNext at `https://www.rmtlaunch.fun/`

## Objective

Make RMT discoverable outside social media when users search for Robinhood Chain markets, trading, market intelligence, token contracts, DEX activity, RWA context and related ecosystem workflows.

This is a search-distribution program, not a second terminal and not a content-farm program. Search surfaces must point users back to the canonical VNext terminal and must not create a competing execution architecture.

## Non-negotiable boundaries

- VNext remains the only forward terminal architecture.
- Do not modify active execution, wallet, provider, fee or settlement behavior for SEO.
- Do not publish wallet-specific, profile, admin, API, operator or other private URLs to search engines.
- Do not use fake `lastmod` timestamps or automatically resubmit unchanged URLs merely to look fresh.
- Do not create thin keyword permutations, doorway pages, hidden crawler-only content or generated articles with no distinct user value.
- Keep project origin, market venue, RWA identity and RMT execution attribution separate.
- State clearly that RMT is independent software and is not Robinhood Markets, Inc. or an endorsement by Robinhood.
- Compatibility-only `/market/[address]` pages may continue to function while present, but future search architecture must not make the canonical VNext terminal depend on them.

## Search-engine distribution

### Google

Keep the canonical root sitemap advertised in `robots.txt` and Search Console. Sitemap URLs must be canonical, indexable public pages. Add `lastmod` only when RMT has a truthful significant-change timestamp for the page.

Google no longer supports the old unauthenticated sitemap ping endpoint. Do not add it back. Search Console and crawlable internal links remain the owner-controlled submission/diagnostic surfaces.

Primary references:

- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- https://developers.google.com/search/blog/2023/06/sitemaps-lastmod-ping

### Bing and IndexNow participants

RMT may notify IndexNow when a canonical public URL is added, materially updated or deleted. Ownership is proven with the public key file at the canonical RMT origin. The submission helper must reject foreign hosts and non-public RMT routes.

Do not schedule indiscriminate repeated full-sitemap submissions. Use the full sitemap as a controlled initial/release seed; use incremental notifications for known public static search surfaces when repository changes identify the affected canonical URLs, and later extend the same discipline to trustworthy market-directory lifecycle events.

Primary reference:

- https://www.indexnow.org/documentation

## Query architecture

RMT should build authority around useful intent clusters rather than trying to rank immediately for generic terms such as `crypto` or `trading` alone.

### Brand and entity

- Robinhood Meme Terminal
- RMT terminal
- RMT Robinhood Chain
- rmtlaunch.fun

### Robinhood Chain discovery

- Robinhood Chain trading terminal
- Robinhood Chain market terminal
- Robinhood Chain market scanner
- Robinhood Chain token scanner
- Robinhood Chain markets
- Robinhood Chain tokens
- Robinhood Chain DEX markets
- new Robinhood Chain markets

### Execution and market evidence

- trade tokens on Robinhood Chain
- Robinhood Chain Sushi trading
- Robinhood Chain Uniswap trading
- Robinhood Chain market liquidity
- Robinhood Chain token contract
- verify Robinhood Chain token
- Robinhood Chain token risk
- non-custodial Robinhood Chain trading

### RWA intent

- Robinhood Chain RWA markets
- Robinhood Chain stock tokens
- Robinhood stock token markets
- RWA trading Robinhood Chain

These terms are topic targets, not strings to repeat mechanically. A page earns the query by answering the intent with real RMT data or evidence.

## Phase 1 — isolated search foundation

The first implementation tranche is intentionally outside Codex's active VNext market-directory files:

1. Add `/robinhood-chain` as a server-rendered public authority page with canonical metadata, visible explanatory content, internal links, WebPage/CollectionPage semantics and an independence disclosure.
2. Add the page to the canonical sitemap and public footer navigation.
3. Add `WebApplication` structured identity alongside the existing `WebSite` identity.
4. Add an IndexNow public key, same-origin URL guard, deduplicated payload builder and controlled submission script.
5. Cover the new canonical route and application identity with branch/source/build tests while keeping the production-health verifier aligned to the currently deployed release until the new surface is actually deployed.
6. Add focused source-level and IndexNow boundary smoke tests.

No VNext market-directory, quote, execution, wallet, provider, fee, contract or environment file is changed in this tranche.

## Phase 1B — brand identity and incremental refresh

The next non-overlapping tranche strengthens free distribution without changing the terminal runtime:

1. Publish a canonical `Organization` entity for Robinhood Meme Terminal and connect the existing `WebSite` and `WebApplication` entities to it.
2. Publish `/rmt` as a substantive identity/provenance page that distinguishes the canonical RMT website, official V6 token, official V6 compatibility market and legacy provenance anchor by exact address.
3. Link `/rmt` through ordinary public navigation and add it to the sitemap.
4. Preserve the successful one-time full-sitemap IndexNow seed as historical release evidence.
5. Add a push-to-main incremental IndexNow workflow limited to known public search files. It maps changed files to affected canonical URLs and does not schedule repeated full-sitemap submissions.
6. Keep private routes and `/vnext` excluded through the existing fail-closed IndexNow canonicalization guard.

The `/rmt` page is an identity and anti-impersonation authority surface, not a token promotion or doorway page. It must not imply that a matching ticker, third-party listing or pool proves official RMT identity.

## Phase 2 — canonical market search surfaces after the active directory work settles

Do not implement this by editing around an active Codex PR. After the canonical VNext directory change is merged or otherwise resolved:

1. Re-read the final VNext market-directory contract and types from `main`.
2. Expose a server-rendered, crawlable public market inventory sourced from that canonical directory boundary, without duplicating route-selection or execution logic.
3. Give eligible markets stable canonical public URLs only when each page has enough distinct, verified content to justify indexing.
4. Link public inventory pages with ordinary `<a>` links and bounded pagination so crawlers do not depend on client-only `Load more` behavior.
5. Keep thin, unknown, severe-risk or identity-incomplete markets `noindex` until they satisfy the public-search policy.
6. Emit truthful changed-URL events for IndexNow when an indexable market enters, materially changes or leaves the public inventory.
7. Reconcile or retire compatibility-only `/market/[address]` search behavior without making VNext depend on it.

## Phase 3 — topical authority surfaces

Add only pages that have distinct user value and verifiable RMT evidence. Candidate surfaces include:

- Robinhood Chain RWA market guide tied to canonical Robinhood asset-registry evidence;
- execution venue guide explaining Sushi, direct Uniswap and future admitted providers without claiming unsupported availability;
- token verification guide explaining exact-contract search, project origin, venue and risk evidence;
- funding/access guide only for payment paths that have passed the relevant production release gate;
- market methodology page explaining rankings, risk flags, data freshness and limitations.

Every page must have a clear user task, canonical metadata, normal internal links and an explicit path back to the live terminal.

## External authority work

Repository SEO alone cannot create domain authority. Owner-authenticated external tasks should be handled separately and only with truthful listings:

- Google Search Console: verify canonical property, submit sitemap, inspect indexing and query coverage.
- Bing Webmaster Tools: verify/import the site and sitemap, then monitor crawl/index status.
- Robinhood Chain ecosystem/project directory: submit RMT if the current intake accepts independent terminals.
- Relevant ecosystem directories and developer resources: use the same canonical name, URL and independence language.
- GitHub repository and transparency repository: keep canonical website references and product description consistent.

Avoid bulk backlink packages, paid directory spam, fake reviews and irrelevant guest-post networks.

## Measurement

Track progress with search-engine data, not vanity keyword counts:

- indexed canonical pages;
- excluded/noindex pages and reasons;
- non-brand impressions and clicks;
- Robinhood Chain query impressions and average position;
- exact-contract landing traffic;
- click-through rate by landing page;
- organic sessions that continue into the canonical terminal;
- crawl/sitemap errors;
- IndexNow rejection/error rate;
- branded-result consistency for `Robinhood Meme Terminal` and `RMT` plus Robinhood Chain qualifiers.

## Release sequence

1. Apply each isolated search tranche on its own branch from current `main`.
2. Run `pnpm --filter web exec tsx lib/search-reach-smoke.ts`.
3. Run `pnpm --filter web exec tsx lib/server/indexnow-smoke.ts`.
4. Run `pnpm --filter web test:public-discovery` and `pnpm --filter web test:market-reach` when that command exists on the branch.
5. Run the terminal release lane, web typecheck, production build, production dependency audit, repo hygiene and secret scan required by `AGENTS.md`.
6. Review new public authority pages at desktop and mobile widths.
7. Merge/deploy only after explicit owner authorization and green review.
8. After production is confirmed, verify any search-notification workflow against the deployed proof file and canonical URLs.
9. Configure/verify Search Console and Bing Webmaster Tools using owner-authenticated accounts.
10. Promote stable new route/application checks into production-health verification in a release-aware follow-up where appropriate.

## Codex coexistence rule

Before each search-distribution tranche, inspect the current open PR set and changed filenames. If Codex or Sparks is editing a target file, defer that file and move the search work to a non-overlapping layer. Search growth must never force a conflict into canonical terminal work merely to ship faster.
