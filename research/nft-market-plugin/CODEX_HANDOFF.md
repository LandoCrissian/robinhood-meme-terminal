# Codex handoff — RMT NFT market layer

## Read this first

This package is intentionally **not** a drop-in runtime patch. It is a reviewed research contract designed to prevent Codex from spending usage rediscovering the domain or colliding with the active VNext execution track.

Research base: `cb4ab9b1af7200aa941bc7534795e3d43ac8dda4`

Before implementation, re-read the then-current:

- `AGENTS.md`
- `docs/ARCHITECTURE_FREEZE.md`
- `docs/ACTIVE_SYSTEM_MAP.md`
- `docs/TERMINAL_COMPLETION_GATE.md`
- current open PRs touching VNext execution/authorization/wallet submission

Do not infer that the existence of this branch overrides the system-of-record architecture docs.

## Owner intent captured by this research

Build toward the ability for RMT to discover/analyze/trade **existing NFT assets** through the same VNext terminal. Do not revive NFT minting, creator/V7, drops, or an RMT-owned marketplace. RMT should aggregate external NFT liquidity and eventually route to provider-specific execution after strict verification.

Product principle:

> RMT informs. The trader decides.

This means broad/permissive visibility is acceptable with truthful risk evidence. It does **not** mean arbitrary or unverified calldata can reach the wallet.

## Do not touch while active Codex execution work overlaps

At the research base, PR #427/#428 overlap these families and must be treated as red zones until reconciled:

- VNext authorization route;
- provider adapters;
- quote observation;
- pre-sign evidence;
- authorization plan;
- execution authority;
- wallet submission;
- trade-intent composer / wallet review;
- web package scripts;
- architecture/system-map/completion docs while another branch edits them.

`src/integration.ts` contains the exact research-time red-zone list.

## Tranche 0 — reconcile, do not code blindly

1. Refresh exact main.
2. Inspect all open VNext execution PRs and changed filenames.
3. Re-run this plugin's smoke/typecheck against the research package.
4. Verify external facts that can drift: OpenSea SDK/chain support, Seaport deployment/runtime, source registry states.
5. If any source identity changed, update research evidence first.

No production mutation.

## Tranche 1 — architecture admission only

Only after an explicit owner decision:

Record a narrow architecture distinction:

- **active candidate:** analysis/trading of already-existing NFT assets as part of terminal asset coverage;
- **still paused:** creator/V7 NFT minting, drops and RMT marketplace creation.

Do not combine this decision with runtime code or provider activation.

## Tranche 2 — shadow NFT indexer

Create future `apps/nft-market-indexer` only after Tranche 1.

Use `INDEXER_BLUEPRINT.md` and operational patterns from `apps/market-indexer`:

- dedicated database;
- no signer;
- shadow-only activation lock;
- chain ID 4663 exact;
- dual independent RPC/archive backfill;
- reorg checkpoints/rollback;
- ERC-721 + ERC-1155 + ERC-2309 coverage;
- metadata worker isolated from RPC/indexer process;
- bearer-protected detail APIs;
- no public VNext consumption.

Acceptance must include cross-provider ownership equivalence, ERC-2309 regression, reorg rehearsal and metadata SSRF/oversize tests.

## Tranche 3 — read-only domain integration

Do **not** mutate the existing fungible `AssetId` first.

Add a parallel internal NFT identity:

```text
chainId + contract + tokenId + standard + quantity semantics
```

Then integrate into the **one VNext shell**, not `/nft-terminal` or another frontend.

Future directory hierarchy:

```text
Tokens | NFTs

NFTs:
Active | Trending | New | All
```

Required truthful states:

- identity `verified/reported/conflicting/unknown`;
- inventory coverage `complete/partial/unavailable`;
- market evidence `current/stale/partial/unavailable`;
- no fake zeroes for missing floor/bid/volume.

## Tranche 4 — quote observation

First source: OpenSea/Seaport.

Server-only OpenSea API key. Current collection-based endpoints, not removed generic order-list endpoints.

Normalize:

- unique-token best ask;
- item offers;
- collection offers;
- trait offers;
- actual payment asset;
- required vs optional creator fee;
- marketplace fee;
- gross buyer cost;
- seller proceeds;
- order expiry/status;
- source reference/provenance.

Important: OpenSea best listings are not guaranteed unique by token ID. Dedupe before floor/sweep.

No wallet authorization.

## Tranche 5 — strict Seaport verifier

Implement a provider-specific verifier from `SEAPORT_STRICT_VERIFICATION_CHECKLIST`.

Required safety:

- exact chain/protocol/runtime;
- exact order hash;
- counter/cancellation/fill state;
- signature/EIP-1271;
- exact item type/contract/tokenId/quantity;
- exact criteria proof;
- zone semantics;
- conduit resolution;
- live ownership/balance and approval;
- live payment balance/allowance;
- every consideration transfer explained;
- required/optional royalties disclosed;
- exact recipient;
- exact target/value/selector;
- reject unknown extra calls;
- fresh simulation;
- expiry/checkpoint freshness.

OpenSea fulfillment data is a provider artifact, not the proof itself.

## Tranche 6 — Anvil candidate research

The Anvil AMM is not Seaport. Build a separate provider family.

Pinned candidate identities from current official docs:

- collection `0x539cdd042c2f3d93ebc5be7dfff0c79f3b4fabf0`;
- STONKBROKER `0xe934e36a439c94017b64a3fece66af12099abf50`;
- vault `0xe302733accf4800146e55fc45b46b4e4ffc032d2`.

Before quote observation:

1. pin creation tx/start block;
2. pin current runtime hash;
3. fetch/verify deployed ABI/source;
4. prove collection/token bindings;
5. enumerate buy/sell/snipe events/state;
6. derive **live** principal/fee math from the contract instead of copying UI prose;
7. adversarially test vault inventory races and approvals;
8. only then define a normalized quote adapter.

Keep project origin and AMM venue independent.

## Tranche 7 — wallet execution

Only after the current fungible VNext execution architecture is stable and the NFT strict verifier has controlled proof.

NFT execution needs its own intent semantics. Do not fake an NFT as an ERC-20 amount.

At minimum:

- exact item vs collection/trait intent;
- ERC-1155 quantity;
- user max spend / min proceeds;
- exact recipient;
- approval plan/operator disclosure;
- selected provider/order;
- fee breakdown;
- quote expiry;
- verified payload hash;
- receipt reconciliation;
- uncertain transaction recovery.

## RMT fee boundary

There is **no admitted NFT RMT fee** in this research package. Do not inherit 25 bps or any draft fungible settlement policy.

If the owner later wants an NFT execution fee, define a separate versioned policy and prove atomic settlement per execution family.

## Portfolio / ERC-6551 later layer

After ordinary NFTs are correct, add token-bound-account enrichment:

- discover account via ERC-6551 registry/implementation/salt evidence;
- enumerate assets held by the TBA;
- value them independently;
- prevent recursive/double-counted ownership graphs;
- display `contained NAV` separately from executable NFT bid/ask;
- never claim the NAV is guaranteed sale proceeds.

StonkBrokers is the first useful real-world acceptance fixture.

## Required tests before any public execution

- ERC-721 exact identity and same-name collision;
- ERC-1155 quantities/partial fills;
- ERC-2309 large-mint coverage;
- reorg rollback;
- metadata SSRF, redirect rebinding, oversize and unsafe SVG;
- stale listing after transfer/revoked approval;
- Seaport cancellation/counter/partial fill/expiry;
- collection/trait criteria mismatch;
- malicious zone/conduit/consideration injection;
- EIP-1271 maker;
- royalty required vs optional;
- exact recipient;
- no hidden NFT RMT fee;
- duplicate listings for one token do not distort floor/sweep;
- best sell ranks seller proceeds rather than gross bid;
- sweep is bounded, unique-item and budget constrained;
- stale provider API cannot authorize;
- wallet rejection/revert/unknown receipt recovery;
- mobile + desktop single-shell acceptance.

## Completion signal for Codex

A tranche is complete only when it reports:

- exact base/head SHA;
- exact files changed;
- source/identity bindings;
- tests and evidence;
- unresolved blockers;
- production mutation = NO unless separately authorized;
- next tranche recommendation.

Never merge or deploy automatically.

## Existing TBA research to reconcile

The repository already contains `research/ccff00-tba-probe`. Do not overwrite or blindly merge it. When the ERC-6551/TBA tranche begins, inspect that branch at its then-current SHA, compare it with this plugin's TBA model, reuse proven CCFF00/TBA evidence, and keep any superseded assumptions explicitly classified as research rather than runtime truth.
