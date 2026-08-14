# RMT architecture freeze

**Status: CURRENT — system of record**
**Effective:** 2026-08-14
**Previous baseline:** `main` at or after `35bd37a1d81bcdeb47e7f7dc5c8e310e438a9e7e`

This document records the durable product and system boundaries. It supersedes historical launchpad, V7 creator, profile, community and older terminal-roadmap language. It does not authorize deployment, production configuration changes, provider activation, fees, autonomous execution or destructive migration.

## Product

RMT is a Robinhood Chain:

- discovery and market-intelligence terminal;
- execution terminal;
- wallet portfolio and asset terminal;
- funding/access terminal;
- project-origin, venue and execution-attribution layer;
- RWA market surface.

The core loop is **scan → verify → analyze → execute → reconcile → manage**. New token launches, creator profiles, social profiles, NFT/marketplace creation and community chat are not part of the terminal-completion program.

A durable paper-only AI-agent evaluation foundation is now an admitted forward domain after the terminal UI/completion track. It does not make autonomous live execution part of the current production terminal.

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

VNext is served from production `/`. The former `/vnext` address redirects to `/`; it is not a competing terminal. Mature legacy capabilities may still be reused through explicit shared boundaries, while `/market/[address]` and `/portfolio` remain compatibility-only routes that the canonical terminal does not require. Remaining retirement and completion evidence is governed by [`TERMINAL_COMPLETION_GATE.md`](TERMINAL_COMPLETION_GATE.md).

## Agent foundation

The owner has explicitly admitted a durable paper-only agent foundation under [`agents/ARCHITECTURE.md`](agents/ARCHITECTURE.md).

- `packages/agent-core` owns pure agent schemas, policy validation, state transitions, canonical hashes and deterministic scoring.
- `apps/agent-engine` owns paper-only agent state/evaluation and must remain a separate domain from `apps/market-indexer`.
- The engine now defines seasons, immutable strategy versions, decisions, predictions, paper accounts/orders/fills, portfolio snapshots, risk events and score snapshots.
- `DurableAgentEngine` adds restart recovery, canonical request hashes, caller-supplied idempotency keys and optimistic revision control around the deterministic engine.
- `PostgresAgentStateStore` defines an injected PostgreSQL persistence boundary with canonical snapshot hashes, a mutation journal, per-stream advisory transaction locking and normalized query projections. No production database is connected or configured by this admission.
- The foundation has no signer, private key, wallet submission, contract-write path, provider/fee activation, production environment mutation or live execution method.
- Strategy quality and execution authority are independent. The admitted execution mode is only `PAPER_ONLY`, and the PostgreSQL schema repeats that restriction as a database constraint.
- A future live agent may only propose a typed RMT execution intent into the existing VNext verification/authorization/reconciliation lifecycle. It never becomes a second routing stack.
- Natural-language model orchestration, Arena UI, public MCP, delegated signing, onchain identity and revenue buy-and-retire are later independently reviewed phases.

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
- `apps/market-indexer`: external market discovery and enrichment. It remains read-oriented.
- `packages/agent-core`: agent schema, policy and deterministic scoring authority; no market or execution authority.
- `apps/agent-engine`: durable paper-only agent evaluation authority; no signer, live submission or treasury authority.
- future execution workers: separate explicit domain; never hidden inside the market indexer.

Project origin, market venue and execution origin are separate dimensions. RMT-originated volume or fees require authoritative RMT session/receipt evidence and may not be inferred from origin, pool, wallet, page view or route observation. Future agent attribution must additionally bind the exact agent and strategy version to the canonical RMT execution ID without weakening that rule.

## Providers and future sources

Current provider work includes Sushi, direct Uniswap, UniswapX and 0x foundations. New providers use VNext provider admission.

Future up. support uses two independent identities: `up-v2` and `up-cl`. Slipstream is not Uniswap V3-compatible. StonkBrokers belongs to project-origin attribution and never forces up. routing. Neither is activated by this freeze.

RWA identity comes from the canonical Robinhood asset registry. A canonical stock token is an RWA; an unrelated asset paired with it is only RWA-paired. Pool existence never overrides policy eligibility.

Across remains an asynchronous funding domain: external payment asset → confirmed Robinhood USDG in the user wallet → spendable balance. Pending output is never spendable.

## Economics

The owner has approved implementation support for the versioned `RMT_EXECUTION_V1` policy: 25 basis points, floor rounding, no minimum fee and 100% allocation to RMT operations. This decision supersedes the earlier unapproved-percentage state but does not authorize production activation.

```text
fee policy: RMT_EXECUTION_V1 / version 1
fee bps: 25
enabled: false
treasury: 0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC (verified 1-of-1 Safe)
policy from block: 35041945
policy hash: 0x295c900143405bb585a4d88c3788fadab522fd4313f69242f64e52e39827f141
```

The policy is explicit and hash-bound; execution logic must never infer 25 basis points as a fallback. Missing treasury, effective boundary or provider settlement admission fails closed. Across funding, wallet transfers and failed executions are ineligible. Deployed V6 70/30 economics remain historical/current protocol facts and are not forward terminal economics. See [`RMT_EXECUTION_REVENUE.md`](RMT_EXECUTION_REVENUE.md).

The agent foundation does not change this policy, activate collection or authorize buyback allocation. Any future RMT buy-and-retire program is a separate versioned revenue-policy decision.

## Contracts

Contract source presence is not roadmap authority. The current classification is maintained in [`ACTIVE_SYSTEM_MAP.md`](ACTIVE_SYSTEM_MAP.md): deployed/current compatibility, optional terminal security, paused experimental and retired historical. Deployed source is not moved merely for a cleaner directory.

The paper-only agent foundation adds no contract and does not make historical/paused agent, NFT or revenue-router source current authority.

## Change control

- Sequential, reviewable PRs only.
- No automatic merge or deployment.
- No destructive data migrations.
- Production behavior stays fail closed.
- Open PRs and research documents remain inputs until explicitly admitted.
- Agent performance evidence never self-grants execution authority.
- Durable agent persistence must remain restart/replay-safe and idempotent before any production service wiring.
- The architecture changes only through an explicit owner decision recorded here and in the system map.
