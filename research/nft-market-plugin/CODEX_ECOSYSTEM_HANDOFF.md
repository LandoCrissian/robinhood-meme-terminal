# Codex handoff — RMT ecosystem capability and claims layer

**Research parent:** `9d554819c2d18bd4ad60c193fdda0710bbc76c30`  
**Scope:** isolated research only

## Owner direction

RMT should integrate useful technology from other Robinhood Chain projects and open standards rather than copy it or claim it as RMT's own.

HoodStreet supplies project identity/presence. RMT resolves assets, capabilities, markets, claims, agents, and actions. External protocols remain settlement authority. Successful admitted RMT buy/sell execution retains the explicit 25-bps policy; other actions do not inherit it.

## Read first

- current `AGENTS.md`;
- architecture freeze/system map/completion gate;
- current execution/fee/authorization PRs;
- NFT market/fee handoffs in this directory;
- `ECOSYSTEM_FLYWHEEL.md`;
- `PROJECT_CAPABILITY_ADAPTERS.md`;
- `UNIVERSAL_CLAIM_LAYER.md`;
- `HOODSTREET_MARKET_BUILDING.md`;
- `CONTRACT_RADAR_2026-08-23.md`.

This branch does not override architecture authority.

## Collision boundary

At research time, active work includes PRs #427–#431 across Sushi execution, universal fees/executor/deployment, and terminal polish. Do not edit those branches from this track.

## Tranche A — architecture decision only

Record these distinctions:

- candidate active: external project capability integration;
- candidate active: read-only universal claims inventory;
- candidate active: HoodStreet project identity/presence;
- still paused: RMT-owned creator launchpad/NFT minting/marketplace revival;
- not admitted: Market Building deployment;
- not admitted: claim-token wrapper;
- not admitted: new fee policy beyond approved buy/sell boundaries.

No runtime code in the same PR.

## Tranche B — capability domain

Port tested research from:

- `src/ecosystem-capabilities.ts`;
- `src/hoodstreet-market-building.ts`.

Acceptance:

- independent authority dimensions;
- payment cannot change evidence/ranking/admission;
- capability admission ladder;
- exact contract/runtime binding before execution admission;
- fee boundary per capability;
- RMT trade fee binds only buy/sell;
- project, asset, venue, provider, claim, agent, compliance, oracle, and distribution evidence remain separate.

No provider execution.

## Tranche C — read-only project graph

Create storage/API for:

- controller claims;
- claimed vs verified contracts;
- capabilities/relationships;
- source references;
- evidence state;
- observation block/time;
- revocation/conflict history.

Do not collapse external-origin fields with venue or execution origin.

## Tranche D — HoodStreet presentation

Initial Market Building is read-only and generated from capability graph. No NFT contract required.

Required truths:

- paid/member state separate from verification;
- every floor names external source;
- candidate/observed/quote-only/etc. state visible;
- degraded/revoked history explainable;
- no self-reported volume shown as verified;
- no safety badge implied by membership.

## Tranche E — claim domain and shadow adapters

Port `src/claim-layer.ts` semantics.

Start read-only with one source that has exact contract/event/state evidence. Givest is a strong research fixture; production requires fresh deployment/runtime/policy review.

Required states:

- unknown;
- pending;
- claimable;
- partially claimable;
- claimed;
- refundable;
- expired;
- cancelled;
- blocked.

No wallet action before provider-specific verification/simulation.

## Tranche F — RWA/stock requirements

Before any stock/RWA action:

- canonical Robinhood registry identity;
- exact decimals and `uiMultiplier()` semantics;
- price-feed source and multiplier treatment;
- jurisdiction/policy eligibility;
- transfer/compliance interface checks where supported;
- recipient/account/TBA restrictions;
- no NFT/container compliance bypass.

Draft ERC-8226, ERC-8199, and ERC-8325 are references—not deployed dependencies.

## Tranche G — agent capability discovery

Read-only first:

- identity;
- project relationship;
- MCP/A2A endpoint;
- wallet/account binding;
- supported actions;
- read-only/live mode;
- mandate/delegation evidence;
- spend/time/action caps;
- reputation/validation source.

Do not store private keys or own external agents.

## Tranche H — action routing

Only after capability-specific proof:

```text
user action
 -> capability resolver
 -> provider quote/state
 -> strict adapter verification
 -> exact fee/compliance disclosure
 -> authorization plan
 -> wallet review/submission
 -> receipt reconciliation
 -> project/venue/execution/claim attribution
```

No generic arbitrary-call route.

## Tranche I — Market Building contract research

Do not deploy first.

Prototype:

- signed project manifest;
- controller migration;
- capability hash registry;
- revocation;
- dynamic evidence traits;
- optional external account link;
- nontransferable/controller-migration-only semantics;
- no financial rights;
- no regulated-asset custody bypass.

Only after read-only utility is proven should a minimal contract be reviewed.

## Required adversarial tests

- paid project cannot become verified;
- verified project claim cannot make a candidate provider executable;
- one source cannot implicitly occupy multiple authority dimensions;
- runtime drift downgrades admission;
- revoked capability cannot remain authorization-ready;
- duplicate project/capability/claim IDs rejected;
- stale claim cannot authorize;
- wrong beneficiary/recipient rejected;
- blocked compliance prevents action;
- claims do not inherit buy/sell fee;
- trade fee cannot attach to subscribe/pay/claim/distribute without separate policy;
- building cannot claim financial rights or safety endorsement;
- building transfer cannot move authority accidentally;
- project account cannot bypass RWA restrictions;
- TBA NAV separate from executable NFT price;
- dynamic traits require receipt/evidence roots;
- external provider fees retain external attribution;
- every receipt identifies project, asset, provider/venue, and RMT execution origin independently.

## Completion report

Each tranche reports exact base/head SHA, files changed, evidence/deployment/runtime identities, admission state per capability, tests, blockers, production mutation state, and next narrow tranche.

Never merge, deploy, enable a provider, or create a fee policy automatically.
