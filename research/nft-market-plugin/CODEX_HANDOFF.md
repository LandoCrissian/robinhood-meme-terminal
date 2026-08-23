# Codex handoff — RMT NFT market layer

## Read this first

This package is an isolated research contract, not a drop-in runtime patch. It exists so Codex can implement from a reviewed domain instead of rediscovering NFT market structure while active VNext execution work is changing.

Research base: `cb4ab9b1af7200aa941bc7534795e3d43ac8dda4`.

Before any implementation, re-read current `AGENTS.md`, architecture freeze/system map/completion gate and every open PR touching VNext execution, fees, authorization or wallet submission. This branch never overrides system-of-record architecture docs by itself.

## Owner intent captured

RMT should discover, analyze and eventually trade **existing NFT assets** in the same VNext terminal. Do not revive creator/V7 minting, drops or an RMT-owned NFT marketplace.

Product principle: **RMT informs. The trader decides.** Broad visibility may be permissive; wallet authorization remains strict.

Owner economic direction captured 2026-08-23: successful RMT-originated NFT **buys and sells carry 25 bps / 0.25%**, with the separate NFT settlement semantics defined in `FEE_SETTLEMENT.md` and `CODEX_FEE_HANDOFF.md`.

This research decision is not production activation.

## Current collision boundary

Treat `src/integration.ts::CURRENT_CODEX_RED_ZONES` as research-time collision guidance. Reconcile current fungible fee policy/settlement code before porting NFT economics. Do not modify active VNext execution files from this research branch.

## Tranche 0 — reconcile

1. refresh exact main and open PR state;
2. inspect final `RMT_EXECUTION_V2`/successor semantics;
3. rerun this plugin's validation;
4. reverify driftable external facts: OpenSea chain/API support, Seaport runtime/conduit, venue registry states;
5. update evidence first if identities changed.

No production mutation.

## Tranche 1 — architecture admission

Explicitly distinguish:

- candidate active domain: analysis/trading of already-existing NFTs;
- still paused: NFT minting, creator/V7, drops and RMT marketplace creation.

Do not combine architecture admission with provider activation.

## Tranche 2 — shadow NFT indexer

Use `INDEXER_BLUEPRINT.md` and proven `apps/market-indexer` operational patterns:

- dedicated PostgreSQL;
- no signer;
- shadow-only lock;
- chain 4663 exact;
- dual RPC/archive backfill;
- reorg checkpoint/rollback;
- ERC-721, ERC-1155 and ERC-2309;
- isolated hostile-metadata worker;
- provenance/coverage states;
- no public VNext authority yet.

## Tranche 3 — read-only VNext integration

Do not mutate fungible `AssetId` first. Add parallel NFT identity:

`chainId + contract + tokenId + standard + quantity semantics`.

Use the one VNext shell:

`Tokens | NFTs`, then NFT `Active | Trending | New | All`.

Identity, inventory coverage and market evidence preserve verified/reported/conflicting/unknown and current/stale/partial/unavailable states rather than fake zeros.

## Tranche 4 — quote observation

OpenSea/Seaport first.

Normalize unique best asks, item/collection/trait offers, payment asset, venue gross payment, actual marketplace fees, required/optional royalties, buyer debit, seller proceeds, order status/expiry and provenance. Dedupe duplicate listings per token before floor/sweep.

No wallet authorization.

## Tranche 5 — strict provider verification

Build the provider-specific Seaport verifier before execution. Require exact chain/runtime/order hash/counter/signature/time/zone/conduit/item/criteria/ownership/approval/payment/consideration/recipient/calldata and fresh simulation.

OpenSea fulfillment data is not proof by itself.

## Tranche 6 — NFT fee settlement verification

Read `FEE_SETTLEMENT.md` and `CODEX_FEE_HANDOFF.md`.

Canonical research economics:

- 25 bps;
- basis = normalized venue gross NFT payment;
- floor rounding;
- no minimum;
- buy = buyer surcharge in payment asset;
- sell = seller proceeds deduction;
- non-execution actions = zero;
- failed/reverted execution = zero;
- provider order/consideration preserved;
- provider fill and RMT fee atomic;
- revenue exists only after receipt proof.

For Seaport V1 research design:

- listing buy -> pinned RMT executor + decoded `fulfillAdvancedOrder`, authenticated user as NFT recipient;
- offer sell -> unchanged buyer order + fee-bound seller counter-order + decoded `matchAdvancedOrders`;
- no direct Seaport wallet fallback for a fee-admitted RMT execution;
- no generic arbitrary-call executor;
- no temporary custody of seller NFT as a shortcut.

The Solidity interface under `contracts/` is semantic reference only, not deployable production approval.

## Tranche 7 — Anvil candidate

Stonk Anvil is a separate provider family, not Seaport. Before quote/execution admission independently pin deployment block, runtime hash, verified ABI/source, constructor/immutable bindings, buy/sell/snipe semantics, live fee math, events, inventory race behavior and fork/adversarial simulations.

Current candidate identities remain in `src/venues/stonk-anvil.ts` and must be reverified at implementation time.

## Tranche 8 — authorization and wallet execution

Only after current fungible VNext execution stabilizes and NFT provider + fee proof have controlled evidence.

NFT intent binds exact item vs collection/trait criteria, ERC-1155 quantity, max spend/min proceeds, recipient, approvals, provider/order, venue fees/royalties, RMT 25 bps, total/net economics, expiry, verified payload hash, policy hash, execution ID and receipt reconciliation.

Wallet target for fee-admitted execution is the pinned NFT executor, never an unverified direct provider fallback.

## Tranche 9 — reconciliation/release

Receipt proves independently:

- NFT transfer;
- venue/provider execution;
- seller/buyer economics;
- exact RMT fee transfer;
- treasury;
- execution origin;
- order/execution IDs;
- transaction and block evidence.

Project/collection origin, market venue and RMT execution attribution remain separate.

No release without explicit owner decision, provider admission, runtime pinning, policy hash, controlled proofs, monitoring and a production effective boundary.

## ERC-6551 later layer

After ordinary NFT execution is correct, enrich token-bound accounts. Reconcile the existing `research/ccff00-tba-probe` branch rather than duplicating it. Contained NAV remains separate from executable NFT market value and must be refreshed before settlement-sensitive use.

## Minimum adversarial suite before public execution

- ERC-721/1155 identity and quantities;
- ERC-2309 coverage and reorg rollback;
- hostile metadata SSRF/redirect/oversize/SVG;
- stale ownership/approval/order/counter/expiry;
- criteria mismatch;
- malicious zone/conduit/consideration;
- EIP-1271 maker;
- required vs optional royalties;
- duplicate listing dedupe and bounded sweep;
- best sell ranked by net seller proceeds;
- exact 25-bps floor vectors including zero-rounded tiny trades;
- buyer fee double-count prevention;
- seller fee/net underflow rejection;
- fee recipient/treasury substitution;
- policy hash substitution;
- direct-provider fee bypass;
- partial fill fee math;
- ERC-20 residual allowance;
- reentrancy/malicious token behavior;
- provider success + fee failure atomic revert;
- provider failure + zero fee;
- successful receipt without fee evidence rejected;
- uncertain transaction recovery;
- mobile/desktop wallet review acceptance.

## Completion signal

Each Codex tranche reports exact base/head SHA, files changed, source/identity bindings, tests/evidence, unresolved blockers, production mutation status and next recommended tranche. Never merge or deploy automatically.
