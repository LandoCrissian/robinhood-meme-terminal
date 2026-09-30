# Token enrichment and project graph evidence

Authorized base: `8d453dc0d0467409f8830013fe3e9ba991afed26`, tree `d126ebec51178ffb6c2bcaebc07a2421e4263189`.

## Decision and dependency trace

The existing public terminal, workspace hook, chart component and responsive layout remain the state owners. A presentation model is keyed by Robinhood Chain 4663 and exact contract. Onchain identity, provider visual metadata, provider market observations and owner-confirmed project relationships publish independently. None is execution authority. Trading routes, composer, wallet, fee selector and recovery implementation are unchanged.

Before: chart client required a workspace pool before making an OHLCV request. The signed-out public SHCAT workspace displayed an unavailable chart and sent zero OHLCV requests, despite an exact token contract. Artwork could only use the three existing remote hosts directly. Provider descriptions and token-specific Gecko pool discovery did not enrich the workspace independently.

After: chart requests can start with the exact token. A current workspace canonical/observed pool or reviewed canonical market is used first. Otherwise a bounded Gecko token-pool page supplies exact chain/token relationships; the highest observed liquidity, then volume, then stable pool ID selects a market. Missing canonical pools permit one discovery fallback. Unknown protocols and low/null optional metrics do not exclude legitimate pools. OHLCV must identify the exact selected token; empty history is explicit, and no candles are invented. Provider token metadata supplies display labels, description and links without supplying execution decimals.

The existing chart node/range and trade composer remain mounted. New enrichment uses the existing visible-workspace refresh interval. It does not change quote cadence, authority, amount or payment selection. Desktop retains navigator, chart and intelligence; mobile retains its compact chart and persistent Buy/Sell entry. Project information is inside existing collapsed Market details.

## Bounds and provenance

- Fixed official Gecko HTTPS origin, 512 KiB JSON maximum, 3.5-second per-read deadline, no redirects or retry loop.
- Token-pool resolution caches for five minutes; visual metadata for 15 minutes; OHLCV uses the existing range cadence. Concurrent identical reads coalesce. Next fetch cache supplements the bounded 96-entry process cache.
- New reader budget: at most 24 starts/minute and four concurrent reads per process. A 429 pauses new token reads according to bounded Retry-After. Existing feed readers are unchanged; this is not a global quota guarantee across serverless instances or existing integrations.
- Last-good market/chart evidence is usable for 15 minutes; visual evidence for 24 hours. An unavailable category cannot erase independent ready categories. Client-retained evidence is explicitly stale.
- Artwork uses project-authoritative candidates, existing supported provider image hints, then Gecko metadata. No DexScreener API calls were added. Remote image hosts are no longer restricted to the three legacy hosts when selected from server provider metadata.
- Artwork validates public DNS and pins the approved IP for each HTTPS hop; at most two redirects, one three-second network/DNS deadline per candidate, 1 MiB raster bound, MIME and signature validation. SVG/HTML, credentials and private destinations are rejected. Image cache: 32 entries, one hour fresh/24 hours last-good; negative results 60 seconds. Fixed-size monogram fallback prevents layout changes. The route accepts contracts and restricted legacy hints, not arbitrary proxy URLs.
- Pool first-seen timestamps are labeled as pool evidence, never token creation. Pool movement and buy/sell counts only describe the selected base leg; missing/invalid optional counts remain unavailable.

## Project foundation

`@rmt/shared/project-identity` adapts the existing NFT project registry and supports multiple exact ERC20/ERC721/ERC1155 contracts, positive official evidence, public links and artwork provenance. ERC20 relationships reuse `OWNER_CONFIRMED_PROJECT_TOKEN`; names/symbols cannot establish an edge. Existing collection approval dates identify owner admission relationships only, not creation or technical verification.

No new canonical Token↔NFT pair was added. PEEPS/Founding Feathers, CANNACAT/CannaCats and HOPIUM/Hopium Machines need exact NFT/token contracts and independently verified relationship evidence. The sampled PEEP contract is not assumed to be PEEPS. PR553 remains separate and untouched.

## Genuine read-only evidence

`read-only-coverage-2026-09-30.json` contains sanitized genuine public-provider and signed-out RMT observations. It labels the precommit source as dirty rather than implying an exact-head artifact. No owner authentication or financial request was used.

In the same nine-contract sample: exact public identity 9/9, exact search 9/9, Gecko visual metadata 9/9, Gecko token-pool market evidence 9/9, provider artwork 6/9. Artwork absence uses a monogram; existing legacy artwork remains a candidate and was not included in that standalone provider-artwork count. Descriptions/socials are optional, so a READY metadata record does not imply every field is available.

OHLCV was available for STONKBROKER (60 candles); eight rows reported genuine HTTP 429. Separate bounded changed-reader probes returned SHCAT (59 candles) and USDG (60 candles), but those are not successes in the same sample window. This does not establish universal chart coverage. SHCAT and the new/thin control returned exact search results with no attached market rows; that is not a direct database-membership assertion. The new/thin control was independently found in the provider's new-pool feed (observed liquidity $0.5361); pool age is not token creation evidence.

The public before capture is signed-out production, while after screenshots/video are controlled local browser acceptance. These are different evidence profiles and different exact tokens, not a quantified production performance comparison. No production deployment, configuration or data was changed.

## Reproducible controlled acceptance

`pnpm --filter web test:token-presentation` tests real readers with controlled transport: poolless and bytes32 pool resolution, cold single-flight/warm reuse, exact token/chain binding, unavailable visual with ready market, genuine empty history, last-good fallback/expiry, rate-limit cooldown, artwork DNS/redirect/MIME/size bounds, and explicit multi-asset project relationships without inferred pairs.

`pnpm test:terminal-high-end` includes the public enrichment journey in the existing 0x desktop/mobile suite. It mounts the actual public workspace/chart/composer and real API handlers; only SDK/RPC/0x/Gecko boundaries are controlled. No direct quote POST substitutes for amount entry. Identity-only selected tokens request charts without a pool; delayed core/visual responses do not hold ready browsing/chart evidence; optional enrichment failure does not hold quote→verify→authorize preparation.

Each 1440×900 and 390×844 journey keeps the ticket open for 65 seconds through real chart/workspace timer cycles, including provider outage. It records amount, nonterminal caret, focus, scroll, chart node/range and bounds, request paths and errors. The earlier local run measured zero chart movement, stable amount/caret/focus/range/scroll, no horizontal overflow and zero financial requests. Exact-head CI emits the final measured values in `token-enrichment-browser.json`, with head/tree/profile labels, PNGs and WebM recordings in the existing `zerox-browser-acceptance-evidence` artifact.

Existing Stock view-only, native Buy, ERC20 Sell/approval, post-approval freshness, mutation/account isolation, expiry, duplicate and recovery suites remain required. No assertion of provider-native execution authority was weakened. Historical local browser startup attempts without matching public runtime auth flags failed with 404; the corrected local profile passed. Exact-head CI remains the release-review authority.

## Remaining acceptance

Actual iPhone hardware, authenticated production 0x quotes and owner-authorized settlement were not exercised. Real provider rate limits and missing artwork/description remain legitimate degraded states. Process-local artwork caches and single-flight do not imply durable cross-region caching. Chart resolution has bounded sequential reads, so a slow cold discovery plus OHLCV may reach the existing client deadline; subsequent reads reuse resolution without increasing quote or chart cadence. No merge or deployment is authorized by this task.
