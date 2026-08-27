# RMT architecture freeze

**Status: CURRENT — system of record**
**Effective:** 2026-08-12
**Baseline:** `main` at or after `35bd37a1d81bcdeb47e7f7dc5c8e310e438a9e7e`

This document records the durable product and system boundaries. It supersedes historical launchpad, V7 creator, profile, community and older terminal-roadmap language. It does not authorize deployment, production configuration changes, provider activation, fees, autonomous execution or destructive migration.

## Product

RMT is an owner-curated Robinhood Chain:

- discovery and market-intelligence terminal;
- execution terminal;
- wallet portfolio and asset terminal;
- funding/access terminal;
- project-origin, venue and execution-attribution layer;
- RWA market surface.

The core loop is **scan → verify → analyze → execute → reconcile → manage**. New token launches, creator profiles, social profiles, NFT/marketplace creation and community chat are not part of the terminal-completion program.

Normal Search, Active, Trending, New, market workspace and trading admission are bounded by `RMT_CURATED_MARKET_REGISTRY`. Token existence is separate from RMT directory admission. Registry aliases are discovery hints; displayed ERC20 identity and canonical market bindings remain independently verified. Exhaustive historical market or token-identity completion is not a Terminal dependency.

## Canonical architecture

VNext is the only forward terminal architecture. Its canonical domains live under `apps/web/lib/vnext/*` and `apps/web/lib/server/vnext-*`.

The execution lifecycle is:

```text
user intent
→ provider quote observation
→ normalized comparison
→ candidate selection
→ provider-specific strict verification
→ local wallet codec / authorization plan
→ wallet review and submission
→ receipt or asynchronous settlement
→ recovery and reconciliation
```

Observation, strict verification, wallet authorization and production activation are four independent admissions. A provider may safely stop at any level. No provider is required merely to increase provider count.

VNext is served from production `/`. The former `/vnext` address redirects to `/`; it is not a competing terminal. Replaced `/market/[address]` and `/portfolio` presentation routes restore their intent inside `/` instead of mounting the retired frontend. Mature shared capabilities remain reusable through explicit boundaries, but they do not own a second terminal shell. Remaining completion evidence is governed by [`TERMINAL_COMPLETION_GATE.md`](TERMINAL_COMPLETION_GATE.md).

## Active security identity versus paused profile

Trading wallet identity is active security infrastructure. Sensitive server endpoints may require a minimal authenticated Privy session bound to the exact connected recipient wallet.

Public/social profile features are paused: display name, handle, bio, onboarding, cloud profile editing, follows, referrals, creator ownership, profile alerts and social features. Removing profile promotion must never weaken recipient binding, authentication, rate control or authorization.

Existing user/profile records, migrations and Firestore protections remain intact. Firebase may continue as narrow server-side terminal recovery persistence for funding sessions, transaction reconciliation and receipts; this does not make it a profile requirement.

## Paused product domains

The following remain preserved but inactive in the terminal roadmap:

- RMT Live/community chat, presence and trader overlay;
- creator applications, releases, media and collaborator products;
- V7 launch, ERC-721/ERC-1155, NFT and marketplace preparation;
- new token launch work;
- referral and invite products;
- new autonomous Position Guard expansion.

Paused source and tests remain available as preservation evidence. Paused workers must not remain scheduled merely because their endpoints fail closed.

## Data and service authority

- `apps/indexer`: canonical deployed RMT V6 compatibility and history. It is not the universal ecosystem indexer.
- `apps/external-origin-indexer`: external project-origin attribution. `source-listed` never implies `token-created`.
- `apps/market-indexer`: preserved historical external-market index. It is optional to the curated Terminal and may be stopped after the cutover recovery window.
- future execution workers: separate explicit domain; never hidden inside the market indexer.

Project origin, market venue and execution origin are separate dimensions. RMT-originated volume or fees require authoritative RMT session/receipt evidence and may not be inferred from origin, pool, wallet, page view or route observation.

## Providers and future sources

Current provider work includes Sushi, direct Uniswap, UniswapX and 0x foundations. New providers use VNext provider admission.

Future up. support uses two independent identities: `up-v2` and `up-cl`. Slipstream is not Uniswap V3-compatible. StonkBrokers belongs to project-origin attribution and never forces up. routing. Neither is activated by this freeze.

RWA identity comes from the canonical Robinhood asset registry. A canonical stock token is an RWA; an unrelated asset paired with it is only RWA-paired. Pool existence never overrides policy eligibility.

Across remains an asynchronous funding domain: external payment asset → confirmed Robinhood USDG in the user wallet → spendable balance. Pending output is never spendable.

## Economics

The owner approved and explicitly released the versioned `RMT_EXECUTION_V1` policy for admitted public Uniswap V3 executions: 25 basis points, floor rounding, no minimum fee and 100% allocation to RMT operations. V1 remains immutable historical/public settlement evidence.

The additive forward architecture is `RMT_EXECUTION_V2`: exactly 25 basis points on gross input for every successfully executed RMT wallet trade, without a static per-token allowlist. The provider is quoted with post-fee input; the fee and swap must revert atomically; approvals and failed swaps settle zero. A provider without an explicitly registered V2 atomic settlement implementation is quote-only, and configuration failure cannot expose a fee-free direct-router fallback. V2 foundation does not select an effective block, deploy a contract, or activate collection.

```text
fee policy: RMT_EXECUTION_V1 / version 1
fee bps: 25
public routing enabled: true for admitted Uniswap V3 fee-executor routes
controlled proof: complete at Robinhood block 37772345
public release boundary: Robinhood block 37805030 / 2026-08-16T07:42:40Z
treasury: 0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC (verified 1-of-1 Safe)
policy from block: 35041945
policy hash: 0x295c900143405bb585a4d88c3788fadab522fd4313f69242f64e52e39827f141
```

The policy is explicit and hash-bound; execution logic must never infer 25 basis points as a fallback. The first exact-wallet controlled proof settled successfully, and the separately reviewed public release gate was enabled at Robinhood block `37805030` after PR #385. Missing treasury, effective boundary, proof binding, runtime identity or provider settlement admission still fails closed. Across funding, wallet transfers, failed executions and every provider without a separately admitted settlement path remain ineligible. Deployed V6 70/30 economics remain historical/current protocol facts and are not forward terminal economics. See [`RMT_EXECUTION_REVENUE.md`](RMT_EXECUTION_REVENUE.md).

## Contracts

Contract source presence is not roadmap authority. The current classification is maintained in [`ACTIVE_SYSTEM_MAP.md`](ACTIVE_SYSTEM_MAP.md): deployed/current compatibility, optional terminal security, paused experimental and retired historical. Deployed source is not moved merely for a cleaner directory.

## Change control

- Sequential, reviewable PRs only.
- No automatic merge or deployment.
- No destructive data migrations.
- Production behavior stays fail closed.
- Open PRs and research documents remain inputs until explicitly admitted.
- The architecture changes only through an explicit owner decision recorded here and in the system map.
