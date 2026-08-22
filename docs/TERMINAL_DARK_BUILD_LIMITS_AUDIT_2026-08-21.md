# Terminal dark-build limits audit — 2026-08-21

**Status:** audit evidence; not architecture authority or release authorization

**Repository:** `LandoCrissian/robinhood-meme-terminal`

**Base:** `9b7825bd6297d340c4338a9695093c7d77cd3e94`

**Scope:** current Terminal completeness, market discoverability, freshness, provider/RPC cost, Vercel/Railway usage, degraded operation, and release gates

This document classifies current constraints. It does not change runtime behavior, infrastructure, environment variables, ranking, execution, caches, refresh intervals, or release state. Each inventory item has exactly one classification: **KEEP**, **ADAPTIVE**, **REMOVE**, or **RELEASE_GATE**.

## Executive finding

The current code has strong permanent cost architecture: universal search is explicit-submit rather than per-keystroke, exact identifiers bypass third-party candidate discovery, background reads pause while hidden, expensive workspace reads are selected-token driven, requests and responses are bounded, stale last-good evidence is retained honestly, and execution independently refreshes and verifies before wallet review.

The remaining correctness problem is not the existence of limits by itself. It is that ordinary browse still obtains market existence from two provider-shaped paths: the three-token fast directory and the broader `/api/markets/external` route. Each is capped at 144, while the canonical market indexer is used only for exact/search verification and remains release-gated. Consequently, “All” means the loaded browse window, not all supported Robinhood Chain markets. Exact token/pool search can escape that window only when the canonical adapter is configured and the relevant indexer history is present; text search can still miss a legitimate market when DEX Screener does not place its token inside the first 30 pairs / 12 unique candidates.

The authority conflict materially affects Terminal core. A cleanup tranche should make canonical inventory the browse existence owner before ranking consolidation. It must retain the non-canonical exact-address identity fallback for canonical-inventory outages.

## Audit method and historical evidence

Current-main code was read at the exact base above. Historical motives are recorded only where the merged PR text or code proves them:

- PR #51, merge `14dce00f839b2e741051ec4ff4de7b042bf735b1`, disabled automatic feature-branch Vercel deployments after the Hobby project hit its 100-deployments-per-24-hours limit; GitHub Actions remained the branch validation layer.
- PR #149, merge `725fbf270493b8b0016ca30c81f95c41250bad23`, replaced repeated visitor-triggered V6 history scans with indexed reads and introduced shared caching, in-flight deduplication, last-confirmed snapshots, hidden-tab pausing, and retry backoff. Its V6 compatibility details are not assumed to be current VNext ownership.
- PR #184, merge `ed697a905f43321562cabafd475ba3b7ced7770a`, added opt-in rebuildable market-indexer storage and a database-size guard after a disposable Railway shadow rehearsal filled its fixed trial volume. Durable storage remained the default.
- PR #364, merge `c39caf3d99a4a97c547e2af37987382abe09dcf6`, explicitly reduced Vercel Hobby function usage by pausing hidden-tab polling, separating wallet discovery from balance reads, using existing public caches, and keeping live quotes at four seconds only while the ticket was active.
- PR #373, merge `ec1763f9ddadf3a6661fda7e6a1496ed6c545b1c`, retired legacy terminal trees and removed obsolete dynamic market sitemap/Open Graph fetch work to reduce Hobby usage.
- PR #387, merge `62aa1c1b2821d2daa8d6a9541324a42e339de436`, restored provider/onchain market discovery while Railway was unavailable and explicitly aligned its result capacity to 144.
- PRs #410–#414, merges `fd8a952b3619f588065ead32f7914e393048c355` through this audit base, added exact canonical inventory queries, the web trust adapter, universal server search, Terminal integration, and independent asset/market/metrics/chart/execution state.

Where history did not prove a motive, the tables say **UNKNOWN / NOT PROVEN**.

## Current constraint inventory

There are **55** relevant constraints: **17 KEEP**, **25 ADAPTIVE**, **7 REMOVE**, and **6 RELEASE_GATE**.

### KEEP

| ID | File / symbol | Current value / behavior | Current effect | Cost effect | Correctness effect | Historical reason | Classification | Replacement / release condition | Follow-up tranche |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| K01 | `use-vnext-market-directory.ts` / `submitUniversalSearch` | Universal search runs only on explicit submission; typing remains local. | Separates responsive filtering from authoritative search. | Avoids a server/RPC/provider call per keystroke. | Prevents transient provider state from continuously rewriting the list. | PRs #412–#413. | KEEP | None; revisit only with a separately budgeted local index. | None |
| K02 | `vnext-universal-market-search.ts` / exact query dispatch | Complete address or bytes32 queries use first-party inventory and make zero DEX Screener candidate calls. | Exact token, V2/V3 pool, and V4 PoolId paths are deterministic. | Avoids unnecessary provider traffic. | Prevents third-party candidate data from becoming exact-identity authority. | PR #412. | KEEP | None. | None |
| K03 | `vnext-market-indexer.ts` / configuration and response schemas | Separate server-only URL/token; HTTPS or loopback only; strict `4663`, `shadow`, `authoritative:false`, manifest, pool, and query-continuity validation. | Establishes a narrow trust boundary. | Rejects retries against malformed/misconfigured upstreams early. | Fail-closed canonical evidence; browser receives no Railway secret or URL. | PR #411. | KEEP | Preserve after activation; authority status may change only through a new reviewed schema/release. | None |
| K04 | `vnext-universal-market-search.ts` / `MAXIMUM_PROVIDER_RESPONSE_BYTES` | Provider response is capped at 1,000,000 bytes. | Bounds parser/memory work. | Limits abusive or accidental serverless resource use. | Oversize data is unavailable, never partially trusted. | PR #412; precise 1 MB rationale otherwise UNKNOWN. | KEEP | Change only for measured payload evidence and abuse review. | None |
| K05 | `vnext-market-indexer.ts` / `MAXIMUM_RESPONSE_BYTES` | Canonical inventory response is capped at 2,000,000 bytes and 500 rows. | Bounds parser/memory work at the internal boundary. | Limits function duration and memory. | Oversize evidence fails closed. | PR #411. | KEEP | Pagination may reduce the needed ceiling; do not remove the bound. | Canonical pagination follow-up if needed |
| K06 | `use-visibility-refresh.ts` | Hidden tabs clear timers; return schedules an immediate read only when the prior start is stale; one task runs at a time. | Uniform background-read lifecycle. | Avoids hidden-tab function/provider/RPC usage. | Preserves freshness on return without overlapping writes. | PR #364. | KEEP | None; future scheduling should reuse this helper. | None |
| K07 | Search, identity, chart, and workspace hooks / abort and sequence guards | New requests abort or supersede old work; late results cannot replace a newer identity/query. | Race-safe UI state. | Avoids redundant in-flight work. | Prevents stale response corruption. | PRs #364, #413. | KEEP | None. | None |
| K08 | `use-vnext-asset-workspace.ts`, workspace evidence hooks | External market, onchain workspace, chart, trade activity, risk, and constellation evidence start for the selected asset/compatible market rather than every browse row. | Demand-driven deep intelligence. | Major provider/RPC/serverless savings. | Search/existence remains independent of optional enrichment. | PR #364 and current component boundaries. | KEEP | None; required existence data must never migrate behind selection. | None |
| K09 | Directory, external market, and public inventory snapshots | Successful snapshots remain visible as explicitly stale when refresh fails. | Degraded service retains known data. | Reduces retry storms and repeated cold upstream work. | Failure is not converted to an empty/not-found result. | PR #149 pattern; current VNext implementations verified. | KEEP | Persistent/shared snapshots may replace process memory, but truthful last-good semantics stay. | Reliability follow-up, optional |
| K10 | `shouldUseExactAddressDegradedFallback` and `selectAddress` | Only a complete nonzero 20-byte address falls back on inventory/client unavailability; not on `not_found`, text, or V4 PoolId. Result is identity-only/non-canonical. | Direct contract access survives canonical-inventory outages. | Uses bounded demand-only reads. | Does not fabricate market evidence or enter ranking. | PR #413 CI fix. | KEEP | Retire only if canonical infrastructure has proven equal or better outage availability and an owner approves loss of identity-only access. | No current retirement |
| K11 | `background-quote.ts`, `trade-intent-composer.tsx` | 120 ms initial debounce, 4 s visible-ticket refresh, 6 s reuse age, at least 5 s remaining lifetime; disabled outside authenticated external-wallet trade-ready state. | Live quote intelligence is scoped to active trading. | Avoids global Terminal quote polling. | Execution never relies on directory/workspace freshness. | PR #364. | KEEP | Cadence can be measured, but expiry/verification gates must not weaken. | Execution review only |
| K12 | `/api/vnext/quotes`, `/api/vnext/verify`, authorization paths | Quote/verify responses are no-store; exact identity, expiry, recipient, provider, simulation, and authorization checks remain independent. | Execution freshness is separate from discovery polling. | Costs occur only for explicit trade preparation. | Slow intelligence refresh cannot authorize stale execution. | Architecture freeze and execution tests. | KEEP | Security review only; not a dark-build cleanup. | None |
| K13 | V4 identity and chart checks | Canonical V4 keeps bytes32 PoolId and null `poolAddress`; chart input requires explicit chart-eligible EVM-address evidence. | V4 existence survives without invented chart support. | Avoids invalid provider/chart calls. | Prevents PoolId/address conflation. | PRs #410–#414. | KEEP | Add a real V4 chart provider only through a separate admitted contract. | Future V4 chart tranche, optional |
| K14 | `apps/web/vercel.json` / `git.deploymentEnabled` | Automatic deployments: `main=true`, all other refs=false; GitHub status noise is silent. | Production deploys remain main-only. | Preserves Hobby deployment quota. | CI, not an unreviewed preview, is the PR gate. | PR #51 proves the 100-deployments/24h incident. | KEEP | Revisit only with a funded preview policy, isolation, and quota evidence. | Explicit preview-policy review |
| K15 | `apps/web/app/sitemap.ts` and retired dynamic market OG/sitemap code | Sitemap is static and revalidates every 300 s; legacy per-market sitemap/OG fetch work is gone. | Public routes remain discoverable without market fan-out. | Avoids unnecessary server requests. | Does not define Terminal market existence. | PR #373. | KEEP | Add dynamic inventory only with bounded canonical pagination and cache design. | SEO inventory tranche |
| K16 | Market-indexer storage mode and DB ceiling | `durable` is default; `rebuildable` is explicit; mode drift fails; optional max DB is 64–1,000,000 MB. | Supports durable service and constrained disposable rehearsals without silently changing guarantees. | Rebuildable mode/ceiling protects trial storage. | Durable remains required for authoritative use. | PR #184. | KEEP | Never use rebuildable storage for authoritative inventory; environment choice remains operational. | Railway operations review |
| K17 | Error/sensitive routes and universal search route | Failures and security-sensitive reads use `no-store`/private no-store; query length is capped at 160. | Prevents caching of credentials, failure evidence, or unbounded input. | Bounds work and avoids bad-response amplification. | Failures remain distinct and sanitized. | Current route tests; exact rationale for 160 otherwise UNKNOWN. | KEEP | Bounds may be tuned, not removed. | None |

### ADAPTIVE

| ID | File / symbol | Current value / behavior | Current effect | Cost effect | Correctness effect | Historical reason | Classification | Replacement / release condition | Follow-up tranche |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A01 | `VNEXT_MARKET_DIRECTORY_MAX_MARKETS` | 144; applied by both fast and broad provider directory routes before the browser union. | Caps ordinary browse acquisition/normalization and the rows eligible for view ranking. | Bounds provider payload, React work, and Vercel response size. | Legitimate markets outside the window are absent from browse; exact canonical search may still find them when configured. | PR #387 explicitly aligned outage discovery to 144. | ADAPTIVE | Replace fixed existence window with canonical pagination; keep a bounded page/window. Safe trigger: canonical browse ready and measured page costs. | `TERMINAL_LIMITS_AND_LEGACY_PATH_CLEANUP_V1` |
| A02 | `VNEXT_MARKET_DIRECTORY_PAGE_SIZE` | 24; `visibleVNextMarketDirectoryMarkets` and Load More add 24 locally. | Controls rendered browse increment, not upstream acquisition. | Bounds DOM/layout work. | Does not make an acquired market unreachable, but “All” initially shows 24. | Present with VNext directory; exact historical motive NOT PROVEN. | ADAPTIVE | Tune from device/performance evidence; plausible 12–48 local page sizes. | UI performance review |
| A03 | `VNEXT_CLIENT_REFRESH_POLICY.marketDirectoryMs` | 60,000 ms, visibility-aware. | Refreshes the three-token fast directory. | Bounds Vercel/provider calls. | Up to roughly 60 s stale while visible; not used for execution. | PR #364. | ADAPTIVE | Tune using change rate, cache hit rate, function usage, and stale UX; keep visibility pause. | Dark-build cleanup / observability |
| A04 | `ecosystemDirectoryMs` | 300,000 ms, visibility-aware. | Refreshes broad `/api/markets/external` browse enrichment. | Large reduction in expensive multi-provider calls. | New provider-observed markets may appear up to five minutes late. | PR #364. | ADAPTIVE | Reassess after canonical browse cutover; provider enrichment can remain slower than existence. | `TERMINAL_LIMITS_AND_LEGACY_PATH_CLEANUP_V1` |
| A05 | `assetWorkspaceMs` | 60,000 ms, selected asset only and visibility-aware. | Refreshes selected external market plus onchain ecosystem workspace. | Bounds deep provider/RPC work. | Workspace intelligence may be one minute old; execution is independent. | PR #364. | ADAPTIVE | Tune from selected-workspace usage and source freshness; preserve demand-driven scope. | Workspace observability |
| A06 | `walletBalanceMs` | 60,000 ms, visible/connected only. | Refreshes wallet balances. | Bounds Blockscout/onchain reads. | Portfolio can lag; post-execution paths separately refresh. | PR #364. | ADAPTIVE | Change from measured balance latency and event-driven options; preserve explicit post-transaction refresh. | Wallet reliability tranche |
| A07 | `walletDiscoveryMs` | 300,000 ms; discovery is separated from balance refresh. | Limits expensive token discovery while balance reads can be more frequent. | Significant provider savings. | Newly received assets can take five minutes unless another trigger refreshes. | PR #364. | ADAPTIVE | Add safe event/manual triggers before shortening globally. | Wallet reliability tranche |
| A08 | `ethPriceMs` | 300,000 ms, visibility-aware and enabled only where needed. | Refreshes gas-value display. | Bounds price endpoint usage. | Display estimate can lag; transaction gas mechanics do not use it as authorization. | PR #364. | ADAPTIVE | Tune to display tolerance/provider cache; not a signing input. | Cost observability |
| A09 | Universal search and market-indexer timeouts | Defaults 5,000 ms; accepted override 250–10,000 ms; client also times out at 5,000 ms. | Bounds search latency and server lifetime. | Prevents hung provider/Railway/RPC work. | Slow healthy infrastructure may surface as unavailable, not not-found. | PRs #411–#413; 5 s exact rationale NOT PROVEN. | ADAPTIVE | Tune from p95/p99 latency while below route max duration; preserve explicit unavailable state. | Search SLO review |
| A10 | `MAXIMUM_PROVIDER_PAIRS` | First 30 DEX Screener text-search pairs are inspected. | Bounds candidate parsing. | Limits provider response work and downstream verification fan-out. | A legitimate same-name/symbol token after pair 30 is invisible to text search. | PR #412. | ADAPTIVE | Use measured recall, canonical symbol index, or paginated candidate discovery; never make provider authoritative. | `TERMINAL_LIMITS_AND_LEGACY_PATH_CLEANUP_V1` |
| A11 | `MAXIMUM_CANDIDATE_TOKENS` | At most 12 unique exact token contracts reach inventory/onchain verification. | Bounds canonical and RPC fan-out. | Caps up to 12 inventory and identity reads. | Later same-name/symbol contracts can be missed. | PR #412. | ADAPTIVE | Prefer a canonical identity/search index; otherwise tune with concurrency/budget evidence. | `TERMINAL_LIMITS_AND_LEGACY_PATH_CLEANUP_V1` |
| A12 | `MAXIMUM_RESULTS` | Text search returns at most 12 verified contracts. | Bounds UI response. | Small response/render cost. | More than 12 valid same-name/symbol contracts are omitted despite verification. | PR #412. | ADAPTIVE | Add continuation/pagination or explicit truncation metadata before increasing. | Search pagination tranche |
| A13 | `INVENTORY_LIMIT` in universal search | 100 markets per token/pool query; adapter maximum is 500. | Preserves up to 100 canonical markets per verified asset. | Bounds response and validation work. | Assets with over 100 markets have incomplete provenance; exact pool searches normally return far fewer rows. | PRs #411–#412. | ADAPTIVE | Add cursor/continuation and completeness evidence; do not silently raise to 500 without payload metrics. | Canonical inventory pagination tranche |
| A14 | Fast directory caching | Upstream revalidate 20 s; response `s-maxage=20, stale-while-revalidate=60`; failures no-store. | Shared short-lived provider snapshot. | Reduces repeated DexScreener calls. | Data can be stale for the SWR window but is labeled stale after refresh failure. | PR #364 cache-use principle; exact TTL motive NOT PROVEN. | ADAPTIVE | Tune from hit rate/provider rate limits; remove route as existence owner during canonical cutover. | `TERMINAL_LIMITS_AND_LEGACY_PATH_CLEANUP_V1` |
| A15 | Broad external directory caching | Candidate/profile fetch 60 s; token/pair fetch 30 s; success `s-maxage=30, stale-while-revalidate=90`. | Shares expensive provider aggregation. | Reduces DexScreener/Gecko/Sushi/registry requests. | Provider metrics may lag up to the cache/SWR windows. | PR #364 pattern; values predate/extend it, exact motives NOT PROVEN. | ADAPTIVE | Preserve provider-enrichment caching after it relinquishes existence authority. | Provider enrichment cleanup |
| A16 | Asset identity cache | `/api/vnext/asset-identity`: `s-maxage=60, stale-while-revalidate=300`; failures no-store. | Shares immutable-ish ERC-20 identity reads. | Reduces repeat RPC calls. | Contract identity changes are rare but could take minutes to surface. | UNKNOWN / NOT PROVEN. | ADAPTIVE | Increase only for proven immutability; shorten for proxy/mutable identity evidence. | Identity SLO review |
| A17 | Asset workspace cache | `/api/vnext/asset-workspace`: `s-maxage=30, stale-while-revalidate=120`; client refresh 60 s. | Shares onchain identity/ecosystem reads for selected assets. | Reduces RPC/serverless use. | Ecosystem evidence can lag; execution rechecks separately. | PR #364 supports the client bound; route TTL motive NOT PROVEN. | ADAPTIVE | Tune by evidence type or split immutable identity from dynamic ecosystem data if measured need exists. | Workspace cache review |
| A18 | Risk and constellation caches | Success `s-maxage=60, stale-while-revalidate=300`; selected full-market only. | Shares expensive holder/risk evidence. | Reduces provider/explorer/RPC work. | Five-minute stale-while-revalidate is acceptable for intelligence, never for execution. | UNKNOWN / NOT PROVEN. | ADAPTIVE | Tune to provider freshness and risk UX; keep warning and execution separation. | Risk-data SLO review |
| A19 | Chart ranges and cache/refresh | Client refresh 15–60 s by range; upstream revalidate 3–180 s; max 120 candles; hidden-tab paused. | Range-sensitive selected-pool charts. | Bounds GeckoTerminal traffic and render size. | Chart can lag its range; missing chart never erases asset/market. | PR #364 for visibility/cache use; per-range origins NOT PROVEN. | ADAPTIVE | Tune per provider limits and observed candle close cadence; keep 120-point render bound or paginate. | Chart SLO review |
| A20 | External trade stream degraded polling | SSE primary; fallback polls every 6 s; reconnect backoff up to 8 s; watchdog checks every 5 s and recovers after 20 s. | Keeps selected-market activity alive through stream failure. | Can become a high request rate on prolonged SSE failure. | Honest `fallback`/`reconnecting` state; no execution authority. | Exact historical motive NOT PROVEN. | ADAPTIVE | Measure SSE reliability; add visibility gating (R06) and consider longer/adaptive fallback. | `TERMINAL_LIMITS_AND_LEGACY_PATH_CLEANUP_V1` |
| A21 | Public SEO liquidity qualification | Minimum observed liquidity $5,000. | Filters public index pages only. | Keeps static/public inventory small. | Does not control Terminal existence; excludes thin but real markets from SEO. | Current public copy; historical motive NOT PROVEN. | ADAPTIVE | Change only from SEO quality/abuse evidence; never reuse as Terminal existence. | Public SEO review |
| A22 | Public SEO volume qualification | Minimum observed 24 h volume $100. | Filters public index pages only. | Keeps low-value pages out of crawl/cache work. | Does not control Terminal existence; excludes inactive real markets from SEO. | Current public copy; historical motive NOT PROVEN. | ADAPTIVE | Same as A21. | Public SEO review |
| A23 | Public SEO revalidation | 300 s on market inventory pages, fetch, and sitemap. | Five-minute public inventory cadence. | Bounds server regeneration and upstream reads. | SEO pages may lag Terminal; not a trading source. | PR #373 reduced dynamic work; exact 300 s motive NOT PROVEN. | ADAPTIVE | Tune from crawl/cache behavior and canonical inventory readiness. | Public SEO review |
| A24 | `MAX_DIRECT_V6_ORIGIN_RECORDS` | 128 records; direct onchain fallback fails closed above it. | Bounded origin de-duplication if the origin indexer is unavailable. | Prevents unbounded serverless factory reads. | Above 128, origin coverage becomes unavailable rather than misclassifying tokens. It does not prove market existence. | PR #387; paused V6 set was exactly two at review. | ADAPTIVE | Keep while V6 is paused/small; retire or paginate once origin-indexer availability is proven and count approaches limit. | Origin fallback review |
| A25 | Market-indexer worker defaults | Batch size up to/default 5,000 and poll interval 5,000 ms in config/example. | Controls Railway backfill and steady-state cadence. | Direct compute/RPC/database cost. | Smaller batches slow canonical coverage; larger batches raise reorg/retry/resource impact. | Existing config; precise current values predating recovery are NOT PROVEN as optimal. | ADAPTIVE | Tune only from Railway metrics, RPC limits, lag, and the $10 circuit breaker; never accelerate merely to unblock UI. | Railway capacity review |

### REMOVE

| ID | File / symbol | Current value / behavior | Current effect | Cost effect | Correctness effect | Historical reason | Classification | Replacement / release condition | Follow-up tranche |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R01 | `/api/vnext/market-directory` / `DIRECTORY_TOKENS` | Acquires pairs only for USDG, WETH, and RMT, then treats that set as the fast availability baseline. | Produces quick browse candidates around three settlement/official tokens. | Only three provider requests per refresh. | Accidentally acts as market-existence authority; markets outside those pair neighborhoods are absent. | Railway-unavailable broad-discovery period; exact three-seed origin NOT PROVEN. | REMOVE | Canonical indexer browse/pagination becomes existence input; keep provider calls only for metrics/enrichment. | `TERMINAL_LIMITS_AND_LEGACY_PATH_CLEANUP_V1` |
| R02 | `use-vnext-market-directory.ts` / fast + ecosystem merge and `/api/markets/external` | Browser unions two provider-derived directories; comment says fast directory is authoritative for availability. | Two systems compete to decide which markets exist. | Duplicates requests, normalization, sorting, and snapshots. | Provider observation can add/erase existence independently of canonical inventory. | PR #387 explicitly restored broad discovery without Railway. | REMOVE | One canonical browse inventory owns existence; provider route enriches exact known contracts only. | `TERMINAL_LIMITS_AND_LEGACY_PATH_CLEANUP_V1` |
| R03 | `VNEXT_MARKET_DIRECTORY_VIEWS` / `all` label | “All” reports only the loaded union, each upstream capped at 144, with local pages of 24. | UI implies completeness it does not have. | No direct cost. | Misstates coverage and hides truncation. | UNKNOWN / NOT PROVEN. | REMOVE | Rename to “Loaded”/“Browse” until canonical pagination can truthfully supply all supported markets. | `TERMINAL_LIMITS_AND_LEGACY_PATH_CLEANUP_V1` |
| R04 | `/api/markets/external` / `buildAssetMarketRecord(evidence, { requireChart: true })` and `primaryMarket` requirement | Broad provider route still drops observed markets without chart eligibility/preferred primary market. | Couples existence to presentation enrichment despite P3 state separation elsewhere. | Reduces rows/calls downstream, but by deleting valid evidence. | Real V4/non-chart markets can disappear from this path. | Legacy external workspace model; historical motive NOT PROVEN. | REMOVE | Provider enrichment should emit observed evidence independently; canonical inventory owns existence. | `TERMINAL_LIMITS_AND_LEGACY_PATH_CLEANUP_V1` |
| R05 | `/api/markets/external` / `PREVIEW_MARKET_UPSTREAM` | In Vercel Preview, origin resolution can call the Production external-market endpoint. | Cross-environment compatibility branch despite automatic previews being disabled. | Adds a remote server request when manually previewed. | Couples preview truth to Production provider output and duplicates origin resolution. | Railway outage compatibility; exact PR provenance NOT PROVEN. | REMOVE | Use explicit preview fixtures/configured origin service, or fail closed; do not proxy Production market discovery. | `TERMINAL_LIMITS_AND_LEGACY_PATH_CLEANUP_V1` |
| R06 | `use-external-market-stream.ts` | SSE and 6 s fallback interval are not stopped when the tab becomes hidden; visibility only triggers recovery on return. | Selected-market activity may continue offscreen. | Avoidable Vercel/provider usage, especially during fallback. | No correctness benefit while hidden; can create unnecessary reconnect load. | PR #364 did not cover this hook; motive UNKNOWN. | REMOVE | Apply the established visibility lifecycle: close/pause hidden, resume once visible and stale. | `TERMINAL_LIMITS_AND_LEGACY_PATH_CLEANUP_V1` |
| R07 | External rank, fast-directory liquidity sort, client merge sort, and view sorts | Several reachable paths order the same browse universe differently before/after truncation. | Ordering and which 144 survive depend on path. | Repeats sorting but cost is minor. | Competing rank layers can change visibility before the planned single ranking layer. | Layering accumulated across outage and VNext integration; exact motive partly UNKNOWN. | REMOVE | Establish canonical browse completeness first, then one ranking owner; presentation pagination must not pre-filter authority. | Cleanup first, then `MARKET_RANKING_CONSOLIDATION_V1` |

### RELEASE_GATE

| ID | File / symbol | Current value / behavior | Current effect | Cost effect | Correctness effect | Historical reason | Classification | Replacement / release condition | Follow-up tranche |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G01 | `apps/market-indexer/src/sources.ts`, server `/ready` | Compiled activation lock is `true`; health is `shadow`, `authoritative:false`, `servingProductionTraffic:false`; `/ready` is 503. | Service cannot claim Production authority. | Permits dark backfill without public cutover load. | Prevents incomplete shadow history from becoming truth. | Market-indexer shadow design and current system map. | RELEASE_GATE | All sources caught up at finalized boundaries, reorg/duplicate/runtime evidence green, operational/abuse review complete, and an explicit owner release changes the lock. | Market-indexer authority release review |
| G02 | `RMT_MARKET_INDEXER_URL`, `RMT_MARKET_INDEXER_READ_TOKEN`, optional timeout | Web adapter returns `not_configured`/`misconfigured`/unavailable; no provider fallback becomes canonical. | Production can remain disconnected from Railway. | Zero canonical-query usage until configured. | Search reports inventory unavailable rather than false not-found. | PR #411 and incomplete Railway backfill checkpoint. | RELEASE_GATE | Exact reviewed deployment, complete relevant backfill, bearer/HTTPS, health, cost limits, and owner-authorized Vercel configuration. | Canonical web connection release |
| G03 | Universal search Production availability | Server authority exists, but live canonical search depends on G02 and indexed coverage; client preserves degraded exact identity access. | Search UI code can ship without claiming live canonical completeness. | Avoids premature Vercel→Railway traffic. | Text/exact canonical results remain unavailable until evidence exists. | PRs #412–#413 and recorded STONKBROKER pending-backfill state. | RELEASE_GATE | G02 plus representative exact token/V2/V3/V4 coverage, STONKBROKER evidence, unavailable/not-found acceptance, and cost observation. | Live universal-search activation |
| G04 | Canonical browse cutover | No current web route consumes unfiltered canonical inventory as the ordinary directory source. | Provider browse remains active during shadow recovery. | Avoids broad Railway traffic before pagination/backfill proof. | Blocks removal of R01/R02 and truthful “All.” | PRs #410–#414 intentionally limited canonical use to exact/search evidence. | RELEASE_GATE | Add bounded canonical browse/pagination, prove completeness/lag states, connect G02, retain provider metrics as enrichment, then explicitly cut over. | `TERMINAL_LIMITS_AND_LEGACY_PATH_CLEANUP_V1` |
| G05 | Public SEO V4 inventory | Public qualification requires an EVM `pairAddress`; canonical V4 PoolId/null address is excluded. | Public pages remain compatible with address links and current metric source. | Avoids new canonical/SEO fan-out. | V4 can exist in Terminal/search but is not publicly indexed as a market page. | Current public inventory contract; motive otherwise UNKNOWN. | RELEASE_GATE | Canonical public inventory supports PoolId-safe presentation/provenance, avoids `/address/<PoolId>`, and has independent SEO qualification. | Public canonical SEO inventory tranche |
| G06 | Provider observation/authorization/submission and fee gates | Capability-specific execution gates remain independent; directory state always says execution `not-evaluated`. | Market discovery cannot activate trading routes. | Prevents unused providers from generating quote/submission load. | Maintains provider, recipient, simulation, fee, and wallet safety. | Architecture freeze and release evidence. | RELEASE_GATE | Each provider requires its existing controlled proof and explicit release; cost is not sufficient reason to change it. | Provider-specific release task only |

## Domain conclusions

### Directory and browse

The 144 cap affects both provider acquisition routes before they reach the browser. Normalization itself can preserve what it receives, but ranking/sorting occurs before the cap in each route, and the client then merges and sorts the already truncated sets. The 24-row page size is local presentation only. Public SEO inventory consumes the same fast directory and applies additional qualification; it is not a separate canonical browse source.

A market outside the loaded 144 remains reachable by complete token, V2/V3 pool address, or V4 PoolId only when the canonical adapter is configured and the relevant row is indexed. Text reach is not complete because candidate discovery inspects only the first 30 provider pairs and first 12 unique contracts. In the current release-gated state, canonical unavailability falls back only for exact 20-byte identity, not market existence. Therefore a legitimate market can be unreachable by browse and text, and “All” currently means “all loaded markets.”

### Fast directory seed model

The USDG/WETH/RMT seed is not merely a cache-warming/enrichment optimization. `/api/vnext/market-directory` constructs the fast list from those three provider queries, the browser treats it as the availability baseline, and it selects from that result. The broader provider route supplements it, but canonical inventory does not yet own ordinary browse. R01/R02 are therefore correctness cleanup, not a request to remove provider metrics.

### Universal search bounds

Exact identifier searches do not use the provider and are bounded primarily by the 100-row inventory limit. Text search is intentionally a provider-candidate pipeline, then canonical market proof, then onchain identity proof. The 1 MB response cap and timeout are safety controls. The 30-pair, 12-candidate, 12-result, and 100-inventory values are adaptive completeness controls and need explicit continuation/recall evidence rather than simple increases.

### Refresh, selected enrichment, and execution freshness

The general 60/300-second policies are intelligence cadences. Hidden tabs pause the shared visibility scheduler, and return refreshes only when stale. Selected workspace enrichment remains demand-driven. The exception is the selected trade stream, whose SSE/fallback lifecycle continues while hidden and should adopt the existing visibility boundary.

Live quote refresh is separate: four seconds only while authenticated, externally connected, trade-ready, visible, and not already authorizing/submitted. Quote reuse is limited to six seconds with at least five seconds of remaining lifetime. Verification, simulation, recipient binding, approval scope, fee proof, and authorization remain pre-sign execution requirements and are not dark-build removal candidates.

### Cache and degraded-mode summary

| Surface | Current cache/degraded behavior | Freshness consequence | Cost consequence | Classification |
| --- | --- | --- | --- | --- |
| Fast directory | Upstream 20 s; CDN 20 s + 60 s SWR; process last-good | Short provider lag; stale snapshot on failure | Shared three-token fetches | ADAPTIVE (A14), snapshot KEEP (K09) |
| Broad external directory | Upstreams 30/60 s; CDN 30 s + 90 s SWR; process last-good | Metrics/discovery lag; stale snapshot on failure | Shares multi-provider aggregation | ADAPTIVE (A15), existence role REMOVE (R02/R04) |
| Canonical inventory adapter | `no-store`, 5 s default timeout, strict response bound | Fresh exact shadow proof or explicit unavailable | One Railway request per submitted verification | Trust boundary KEEP; timeout ADAPTIVE |
| Universal search | `no-store`, explicit submit, 5 s bounded candidate request | No cached errors; provider outage stays distinct | Bounded request fan-out | KEEP/ADAPTIVE as itemized |
| Asset identity | 60 s + 300 s SWR; error no-store | Metadata may lag | Shares RPC reads | ADAPTIVE (A16) |
| Asset workspace | 30 s + 120 s SWR; visible client 60 s | Intelligence may lag | Shares selected RPC reads | ADAPTIVE (A05/A17) |
| Risk/constellation | 60 s + 300 s SWR; failure no-store | Evidence may lag or be unavailable | Shares expensive reads | ADAPTIVE (A18) |
| OHLCV | Range revalidate 3–180 s; response SWR 30 s; fallback 15 s + 60 s SWR | Chart-only lag | Shares GeckoTerminal reads | ADAPTIVE (A19) |
| External trades | SSE; REST 6 s cache + 30 s SWR; client fallback 6 s | Activity can be near-live or explicitly fallback | Potentially high during prolonged fallback | ADAPTIVE (A20), hidden work REMOVE (R06) |
| Wallet assets/quotes/verification | Private/no-store | Fresh per request | No shared cache | KEEP security boundary |
| Public SEO inventory | 300 s revalidate plus last-good snapshot | Five-minute public lag | Bounds regeneration | ADAPTIVE (A21–A23) |

## Railway outage fallbacks

| Path | Still reachable? | Current role | Finding |
| --- | --- | --- | --- |
| Exact-address degraded identity (`selectAddress`) | Yes, only on canonical inventory/client unavailability | Verify identity and open workspace without canonical market claim | KEEP; necessary outage resilience and explicitly non-ranking |
| Broad `/api/markets/external` provider discovery | Yes, every five minutes while visible | Supplemental directory plus metrics | REMOVE as existence authority; retain/refactor as enrichment |
| Three-token fast directory | Yes, every minute while visible | Availability baseline | REMOVE as existence authority after canonical browse release |
| Direct V6 factory-origin enumeration | Yes when origin indexer is absent/fails | Bounded origin de-duplication, not market existence | ADAPTIVE; currently safe for paused small V6 set |
| Preview → Production external-market fetch | Only under `VERCEL_ENV=preview` | Origin compatibility | REMOVE; previews are normally disabled and cross-environment truth is undesirable |
| Last-good in-process snapshots | Yes after one successful request | Truthful stale degraded mode | KEEP; shared persistence may improve durability later |

## Vercel Hobby controls

Main-only automatic deployment remains a good cost/change-control boundary. Feature-branch previews are intentionally not automatic; GitHub CI is the PR validation layer. PR #373 removed obsolete dynamic per-market sitemap and Open Graph work. Current public market pages use bounded revalidation rather than per-visitor fan-out. No current VNext Terminal feature was found to require a cron. Server functions use explicit timeouts/caches/no-store according to their data class. The audit found no justification to enable previews or change `vercel.json`.

## Public SEO inventory boundary

The $5,000 liquidity and $100 24-hour volume thresholds and 300-second revalidation qualify public crawlable pages only. They are not referenced by `deriveVNextMarketState`, selection, canonical search, or execution. Terminal market existence can therefore remain canonical/observed with null metrics while SEO excludes it. Public pages additionally require an EVM token and EVM `pairAddress`; a canonical V4 PoolId with `poolAddress:null` is intentionally absent from the current SEO shape. That is a separate public-inventory release gate, not permission to invent an address or hide V4 from Terminal search/workspace.

## Authority and no-layering map

| Fact / responsibility | Current owner | Current fallbacks / compatibility paths | Long-term owner | Retirement needed? |
| --- | --- | --- | --- | --- |
| Asset identity | Onchain `universal-market-resolver` / `/api/vnext/asset-identity`; verified search identity | Built-in trusted assets; exact-address degraded path still resolves onchain identity | Onchain identity reader | No; remove provider identity as authority wherever found |
| Market existence | Canonical market indexer for exact/search evidence; provider fast/broad directories still compete for browse | Identity-only exact fallback has **no** market claim | Canonical market indexer | **Yes:** retire provider/seed existence ownership after G04 |
| Text candidate discovery | Fixed DEX Screener search endpoint | None; outage is `candidate_discovery_unavailable` | Bounded candidate service(s), never authority | No immediate retirement; improve recall/pagination adaptively |
| Exact token/pool search | Universal server search + canonical indexer + onchain identity | Exact 20-byte identity-only fallback on unavailability | Universal search over canonical inventory | Keep fallback until equal outage proof |
| Metrics | DexScreener/Gecko/Sushi/registry evidence normalized by external market route | Last-good provider snapshots | Provider enrichment layer attached to canonical assets/markets | **Yes:** strip existence authority, not enrichment |
| Chart | GeckoTerminal OHLCV for explicit chart-eligible EVM pool | Stale chart snapshot/unavailable presentation | Chart provider layer | No duplicate chart owner found; V4 remains unavailable until admitted support |
| Ranking | `external-market-ranking.ts`, fast route liquidity sort, client/view sorts | Deterministic address/liquidity tie-breaks | One ranking layer after canonical browse | **Yes:** R07; ranking consolidation follows existence cleanup |
| Selected workspace intelligence | `/api/vnext/asset-workspace`, exact external enrichment, selected chart/trades/risk/constellation hooks | Partial/stale/unavailable panels | Demand-driven workspace enrichment | Preserve pattern; visibility-fix trade stream |
| Execution route | VNext provider adapters and quote observation | Provider-specific fail-closed unavailable states | VNext execution orchestrator | No dark-build retirement |
| Execution verification | VNext verify/simulate/authorization, exact wallet codec and fee policy | None that can bypass verification | VNext execution verification | No; security gates remain |

The intended chain is not yet fully realized for browse:

```text
Robinhood Chain
      ↓
Canonical Market Indexer (exact/search only; release-gated for browse)
      ↓
Canonical Market Existence
      ↓
Search / Browse  ← current divergence: provider seed + broad provider route also own browse existence
      ↓
Provider Enrichment
      ↓
Single Ranking Layer  ← current divergence: multiple pre/post-cap sorts
      ↓
Asset Workspace
      ↓
Quote / Verify / Simulate
      ↓
Authorized Execution
```

## Recommended cleanup order

1. **`TERMINAL_LIMITS_AND_LEGACY_PATH_CLEANUP_V1`**: add a bounded canonical browse input with explicit coverage/lag/pagination semantics; remove the three-token and broad-provider routes as market-existence authorities; make “All” truthful; remove the preview-to-Production fallback; apply visibility gating to the selected trade stream. Preserve provider enrichment, exact-address degraded identity, all release locks, and every execution gate.
2. **Canonical release review**: only after Railway source catch-up, representative V2/V3/V4 coverage, STONKBROKER evidence, health/cost observation, and authorized Vercel server-only configuration. Do not remove shadow/authority validation merely to connect the service.
3. **`MARKET_RANKING_CONSOLIDATION_V1`**: run after browse existence has one owner so ranking does not encode an outage-era candidate universe. Add truncation/continuation evidence before changing 144/30/12/100 bounds.
4. **Public canonical SEO inventory**: separately decide PoolId-safe V4 pages, qualification, cache policy, and explorer links. Do not reuse SEO thresholds as Terminal existence rules.
5. **Measured cadence review**: use Vercel, Railway, provider, and user freshness metrics to tune ADAPTIVE values. Preserve hidden-tab pause, explicit-submit search, demand-driven enrichment, hard timeouts, response bounds, and no-store security routes.

## Explicit things not to change in cleanup

- Do not make DEX Screener, GeckoTerminal, DeFiLlama, or a name/symbol match canonical market authority.
- Do not remove exact-address degraded identity access until canonical outage availability is proven and explicitly approved.
- Do not synthesize V4 addresses, metrics, chart data, route eligibility, or execution authority.
- Do not make SEO liquidity/volume thresholds Terminal existence gates.
- Do not weaken quote expiry, simulation, recipient binding, approval scope, fee proof, provider verification, replay protection, or wallet authorization.
- Do not increase Railway compute, remove the market-indexer activation lock, connect Vercel Production, change environment variables, enable previews, or deploy as part of a code cleanup.
- Do not merge provider enrichment, origin attribution, canonical venue existence, and RMT execution attribution.

## Cost controls worth preserving

- Explicit-submit universal search and exact-identifier provider bypass.
- Hidden-tab pausing with stale-on-return refresh.
- Selected-token deep enrichment and chart loading.
- Separate wallet discovery and wallet balance cadences.
- Bounded request timeouts, response bytes, candidate fan-out, and UI pages.
- Shared CDN/SWR caches for public intelligence and private/no-store handling for wallet, quote, verification, authorization, and failures.
- Stale-last-good snapshots with explicit stale/error state.
- Main-only automatic Vercel deployments.
- Durable-by-default indexer storage with explicit rebuildable rehearsal mode and database ceiling.
- Independent execution freshness and provider release gates.

## Correctness blockers worth removing

- Provider/seed browse competing with the canonical indexer for market existence.
- The misleading “All” label over a capped loaded window.
- Chart/primary-market requirements still deleting evidence inside the broad external route.
- Text-search truncation without continuation/truncation evidence for same-name/symbol contracts.
- Preview-to-Production external-market coupling.
- Hidden-tab trade-stream/fallback activity.
- Multiple ranking/order passes selecting different capped universes before the single-ranking tranche.

## Unresolved questions and evidence gaps

- Current Production Vercel values for `RMT_MARKET_INDEXER_URL` and `RMT_MARKET_INDEXER_READ_TOKEN` were intentionally not inspected in this code-only audit. The last authorized operational checkpoint said live activation was gated by incomplete backfill.
- Current live Railway storage mode, database ceiling, p95 query latency, source lag, and per-source pool counts are external operational facts and were not queried or changed.
- No repository evidence establishes that 144, 24, 30, 12, 100, or the exact TTL values are measured optima. Their safety purpose is clear; their product-completeness optimum is not proven.
- DEX Screener search ordering/recall is outside RMT control. The current first-30 strategy has no completeness indicator.
- The current canonical indexer supports unfiltered bounded inventory, but the web adapter/API is deliberately exact-filter oriented. The safest browse pagination/continuation contract still requires a narrow design review.
- Process-local last-good snapshots are instance-local in serverless execution. Their behavior is useful but not guaranteed across cold starts/regions.
- The selected external trade stream's hidden-tab cost was not measured; current code proves that it remains active, which is sufficient to require visibility cleanup.
- Public V4 SEO demand and a PoolId-safe URL scheme are not yet proven. No EVM-address link may be fabricated while that remains unresolved.

## Audit conclusion

The existing permanent cost architecture should not be dismantled. The core cleanup is narrower: transfer ordinary browse market-existence ownership from outage-era provider paths to canonical inventory under the existing release gates, preserve provider data as enrichment, make caps and truncation explicit, and only then consolidate ranking. Until that cleanup and canonical release evidence are complete, live universal-search/browse activation must remain gated.
