# RMT architecture freeze

**Status: CURRENT — system of record**
**Effective:** 2026-08-28
**Baseline:** `main` at `7a7d0e5be09f8c412f6d3c3be84ed7cf9b0f0ef5`

This document records the durable product and system boundaries. It supersedes historical launchpad, V7 creator, profile, community and older terminal-roadmap language. It does not authorize deployment, production configuration changes, provider activation, fees, autonomous execution or destructive migration.

## Product

RMT is becoming the owner-curated market operating layer for Robinhood Chain:

- discovery;
- curated Token Terminal and market intelligence;
- curated NFT Terminal and Project Market;
- portfolio, ownership and market activity;
- canonical project-origin, venue, ownership, marketplace-evidence and execution-attribution layers;
- community and future distribution foundations;
- funding/access and RWA market surfaces.

The core market loop is **discover → verify → analyze → act → reconcile → manage**. The Token and NFT lanes remain technically separate and may connect only through verified Project Market identity. An NFT-to-ERC20 relationship is never inferred from matching names, symbols, branding, metadata or contract functions; it requires owner confirmation plus independent technical verification.

`RMT_CURATED_MARKET_REGISTRY` contains exactly eight owner-reviewed canonical seed markets. Bounded provider discovery may make additional Robinhood Chain markets visible in Search, Active, Trending, New and All without admitting them to that registry. Market visibility, curated-market authority, execution eligibility, project relationships and distribution eligibility are independent. Registry aliases are discovery hints; displayed ERC20 identity and canonical market bindings remain independently verified. Provider listing never authorizes execution, and exhaustive historical market or token-identity completion is not a Terminal dependency.

The NFT Terminal is an active curated, read-only-execution product lane. CCFF00 is the only public `ACTIVE` project. Robin Rabbits and Gogh Punks are technically verified `WATCHING` projects; `WATCHING` is non-public and never promotes automatically. NFT execution remains `NONE`, and marketplace providers remain evidence sources rather than canonical ownership authority.

## Canonical architecture

VNext is the only forward Token Terminal architecture. Its canonical domains live under `apps/web/lib/vnext/*` and `apps/web/lib/server/vnext-*`. Do not create a second Token state, execution or routing framework.

The NFT Terminal lives under `apps/web/app/nft/*`, its server readers under `apps/web/lib/server/nft-*`, and its shared authority domains under `packages/shared/src/nft/*`. The canonical NFT indexer owns mint, transfer, burn and ownership evidence. The NFT marketplace indexer owns provider-reported listing, offer, sale and volume evidence; a transfer is not a sale, and marketplace evidence is not ownership authority.

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

Public Token Terminal transaction submission is currently disabled. Preserve these values unless the owner explicitly authorizes a separate release action:

```text
NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED=false
RMT_VNEXT_AUTHORIZATION_ENABLED=false
NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED=false
```

VNext is served from production `/`. The former `/vnext` address redirects to `/`; it is not a competing terminal. Replaced `/market/[address]` and `/portfolio` presentation routes restore their intent inside `/` instead of mounting the retired frontend. Mature shared capabilities remain reusable through explicit boundaries, but they do not own a second terminal shell. Remaining completion evidence is governed by [`TERMINAL_COMPLETION_GATE.md`](TERMINAL_COMPLETION_GATE.md).

## Active security identity versus paused profile

Trading wallet identity is active security infrastructure. Sensitive server endpoints may require a minimal authenticated Privy session bound to the exact connected recipient wallet.

Public/social profile features are paused: display name, handle, bio, onboarding, cloud profile editing, follows, referrals, creator ownership, profile alerts and social features. Removing profile promotion must never weaken recipient binding, authentication, rate control or authorization.

Existing user/profile records, migrations and Firestore protections remain intact. Firebase may continue as narrow server-side terminal recovery persistence for funding sessions, transaction reconciliation and receipts; this does not make it a profile requirement.

## Paused product domains

The following remain preserved but inactive in the terminal roadmap:

- RMT Live/community chat, presence and trader overlay;
- creator applications, releases, media and collaborator products;
- V7 launch, creator ERC-721/ERC-1155 creation and creator marketplace preparation;
- new token launch work;
- referral and invite products;
- new autonomous Position Guard expansion.

Paused source and tests remain available as preservation evidence. Paused workers must not remain scheduled merely because their endpoints fail closed. This paused classification does not include the active curated NFT Terminal, NFT technical verification or NFT marketplace read-evidence foundations.

## Data and service authority

- `apps/indexer`: canonical deployed RMT V6 compatibility and history. It is not the universal ecosystem indexer.
- `apps/external-origin-indexer`: external project-origin attribution. `source-listed` never implies `token-created`.
- `apps/market-indexer`: preserved historical external-market index. It is optional to the curated Terminal and may be stopped after the cutover recovery window.
- `apps/nft-indexer`: canonical admitted NFT mint, transfer, burn and ownership authority plus technical-verification support. Provider/network failures remain inconclusive rather than contradictory contract evidence.
- `apps/nft-marketplace-indexer`: marketplace read evidence for explicitly admitted projects. It does not establish canonical ownership, verified settlement or NFT execution.
- future execution workers: separate explicit domain; never hidden inside the market indexer.

Project origin, token venue, NFT ownership, marketplace evidence and execution origin are separate dimensions. RMT-originated volume or economics require authoritative RMT session/receipt evidence and may not be inferred from origin, pool, wallet, ownership, page view or route observation.

## Providers and future sources

Current provider work includes Sushi, direct Uniswap, UniswapX and 0x foundations. New providers use VNext provider admission.

Future up. support uses two independent identities: `up-v2` and `up-cl`. Slipstream is not Uniswap V3-compatible. StonkBrokers belongs to project-origin attribution and never forces up. routing. Neither is activated by this freeze.

RWA identity comes from the canonical Robinhood asset registry. A canonical stock token is an RWA; an unrelated asset paired with it is only RWA-paired. Pool existence never overrides policy eligibility.

Across remains an asynchronous funding domain: external payment asset → confirmed Robinhood USDG in the user wallet → spendable balance. Pending output is never spendable.

## Economics

Current owner product policy is:

```text
shared fee policy: RMT_EXECUTION_V2 / version 2
fee: 25 basis points on the input asset
public provider: admitted Uniswap V3 V2 atomic settlement
controlled only: deployed and live-proven Uniswap V2 V2 atomic settlement
all other providers and unsupported routes: RMT_FEE = 0
```

The fee is permitted only when the exact provider-specific V2 executor atomically settles the disclosed input fee and swap. It is ranked on fee-adjusted trader economics, targets the approved treasury, uses exact approvals where required, and fails closed if its runtime, policy, controlled proof, route, simulation or settlement identity changes. Direct/no-fee providers remain available only where separately admitted and must never be labeled fee-bearing. No hidden spread or other fee is authorized.

The repository preserves the versioned `RMT_EXECUTION_V1` deployment and release record as immutable historical technical evidence. At its 2026-08-16 release boundary it authorized only the admitted Uniswap V3 V1 route. It no longer supplies forward policy authority:

```text
historical fee policy: RMT_EXECUTION_V1 / version 1
historical fee bps: 25
historical public release: admitted Uniswap V3 fee-executor routes
controlled proof: complete at Robinhood block 37772345
public release boundary: Robinhood block 37805030 / 2026-08-16T07:42:40Z
treasury: 0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC (verified 1-of-1 Safe)
policy from block: 35041945
policy hash: 0x295c900143405bb585a4d88c3788fadab522fd4313f69242f64e52e39827f141
```

The V1 policy remains explicit, hash-bound historical evidence. The current shared `RMT_EXECUTION_V2` policy is version `2`, charges exactly 25 basis points on input, uses treasury `0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC`, and is publicly live only through the admitted Uniswap V3 V2 corridor. The deployed Uniswap V2 V2 executor completed its controlled native ETH-to-PONS proof in transaction `0xb8ff9e561d4a333f5f91eb707daf6e8b00d0d0565de68355cf5966c1a6cdbb9e` at Robinhood block `53089890`; its public execution remains off until a separate explicit Production release. This does not claim a bidirectional V2 live proof. Deployed V6 70/30 economics likewise remain protocol-history facts rather than forward Token Terminal economics. See [`RMT_EXECUTION_REVENUE.md`](RMT_EXECUTION_REVENUE.md).

## Contracts

Contract source presence is not roadmap authority. The current classification is maintained in [`ACTIVE_SYSTEM_MAP.md`](ACTIVE_SYSTEM_MAP.md): deployed/current compatibility, optional terminal security, paused experimental and retired historical. Deployed source is not moved merely for a cleaner directory.

## Change control

- Sequential, reviewable PRs only.
- No automatic merge or deployment.
- No destructive data migrations.
- Production behavior stays fail closed.
- Open PRs and research documents remain inputs until explicitly admitted.
- The architecture changes only through an explicit owner decision recorded here and in the system map.
