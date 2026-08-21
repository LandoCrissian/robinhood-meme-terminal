# CCFF00 Community Engine — planning track

**Status:** PLANNING ONLY — NOT ACTIVE ROADMAP / NOT AUTHORIZED FOR EXECUTION  
**Branch:** `planning/ccff00-community-engine-v1`  
**Baseline:** `main` at branch creation on 2026-08-21  
**Owner decision:** preserve this work for a clean future OpenAI Codex handoff after the current terminal-completion lane is finished.

This directory captures the agreed design for an automated CCFF00 community utility that can discover and safely acquire free Robinhood Chain NFT mints, distribute acquired NFTs fairly to current CCFF00 holders, accept voluntary ETH for gas without creating extra allocation rights, and later let RMT act as a utility payment token without programmatic RMT selling.

This planning track does **not** override `docs/ARCHITECTURE_FREEZE.md`, `docs/ACTIVE_SYSTEM_MAP.md`, or `docs/TERMINAL_COMPLETION_GATE.md`. Community/NFT runtime work remains paused until the current completion gate is explicitly resolved and the owner separately authorizes implementation. No production behavior, environment variable, signer, worker, route, contract deployment, fee policy, or scheduled automation is changed by these documents.

## Locked product decisions

1. **One current CCFF00 owner address = one Community Engine seat in V1.** A wallet holding 1, 3, or 10 public CCFF00 Squares receives one seat, not one seat per Square.
2. **Multiple Squares still matter as destinations.** When a seat receives an NFT, the engine chooses one of that owner's currently held Squares, favoring the least-served Square and using deterministic public randomness for ties.
3. **Do not infer human identity across unrelated wallets.** Original mint clustering is retained as analytics/evidence only. Two addresses are never auto-merged because of funding source, transaction behavior, IP, or other heuristics.
4. **Current ownership is authoritative for eligibility.** A legitimate buyer becomes a community seat at the next admitted snapshot. Original mint history never overrides current `ownerOf` state.
5. **Public community supply is the default V1 census.** The existing CCFF00 adapter's public-mint range is authoritative; founder/project reserve IDs do not create V1 community seats without a later explicit owner decision.
6. **Contributing ETH buys no entitlement.** Gas contributors and non-contributors are allocation-equal. Funding data must never be an input to the allocation algorithm.
7. **Fairness before randomness.** The least-served active seats are eligible first. Randomness chooses among equally served seats; nobody advances to allocation level `N+1` while an eligible seat remains at `N`.
8. **NFT assignment is blind to value.** Floor price, rarity, token price movement, social hype, or operator preference never influence recipient assignment.
9. **No cherry-picking after acquisition.** Every successfully acquired NFT admitted by a mint run is committed to an inventory manifest before recipient randomness is known.
10. **The engine only auto-executes known mint adapters.** Unknown/custom calldata can be observed and reported but is not automatically signed.
11. **Free means zero mint value.** Automatic Collector V1 requires the exact mint transaction native `value` to equal zero; only network gas may be spent.
12. **One collector identity; no wallet-limit evasion.** The engine respects project per-wallet and allowlist rules and does not create burner wallets to bypass creator limits.
13. **Operator control stays narrow.** The intended operator controls are `START`, `STOP`, and `WATCH PROJECT`/allowlist input. Watching a project never overrides safety policy.
14. **Dedicated execution boundary.** The collector signer must never be an RMT treasury/admin wallet and must not hold RMT, CCFF00, user assets, or valuable NFTs beyond transient acquired inventory. It carries only a capped gas balance.
15. **RMT Pay does not sell RMT.** Approved future RMT utility payments send RMT to the conventional dead address `0x000000000000000000000000000000000000dEaD`; the system does not swap collected RMT for ETH.
16. **Gas funding is separate from RMT burn accounting.** Community ETH and, only after a later explicit economics decision, RMT terminal revenue may fund gas. Burned RMT never needs to be sold to replenish gas.
17. **No RMT redeployment is required by this design.** The current token's ordinary `transfer`/`approve`/`transferFrom` surface is sufficient for the planned utility path; native `burn()`/`permit()` are not prerequisites.

## Existing RMT primitives to reuse

Do not create parallel frameworks for capabilities already present:

- `apps/web/lib/vnext/distribution-ccff00.ts` — canonical CCFF00 collection identity, public supply, current owners, canonical ERC-6551 accounts and runtime evidence.
- `apps/web/lib/vnext/distribution-ccff00-owner-withdrawal-proof.ts` — owner control of the CCFF00 token-bound account and RMT movement proof domain.
- `apps/web/lib/vnext/distribution-domain.ts` — deterministic manifests, ERC-721/1155 distribution representation, hashing and batching patterns.
- `packages/contracts/src/RMTDistributionEngineV1.sol` — security reference for sender-bound, replay-protected NFT transfer logic. Do **not** reuse its current RMT-per-recipient economics for the gas-only Collector.
- `apps/indexer` is **not** a CCFF00 data store; repository authority reserves it for deployed V6 compatibility/history. Reuse its reorg/idempotency patterns conceptually, but do not extend its domain without a separate architecture decision. V1 census/provenance should use bounded read-only CCFF00 chain reads/logs first.
- `scripts/metamask-agent-wallet-preflight.mjs` — signer capability evidence. Current transaction use remains intentionally unauthorized.
- `packages/contracts/src/RMTRetirementSinkV1.sol` — existing legacy retirement primitive remains untouched; RMT Pay V1 uses the conventional dead address for simpler public burn optics.
- `packages/contracts/src/ProtocolPurposeVault.sol` and revenue-router patterns — references for a later explicitly authorized gas-funding path, not authority to modify current economics.

## Planned documents

- [`ARCHITECTURE_V1.md`](ARCHITECTURE_V1.md) — complete system architecture, state machines, census semantics, fairness algorithm, safety policy and funding boundaries.
- [`RMT_PAY_V1.md`](RMT_PAY_V1.md) — RMT utility-payment and burn semantics, gas abstraction boundary and accounting.
- [`CODEX_HANDOFF.md`](CODEX_HANDOFF.md) — sequential bounded work packages for OpenAI Codex after the current completion lane is cleared.

## External infrastructure posture

Use external infrastructure as adapters, never as sole truth where onchain evidence exists.

- OpenSea Drops API is a candidate discovery/mint-transaction builder. Its live Robinhood capability must be probed before admission; a provider response is never a substitute for local verification.
- Robinhood Chain is EVM-compatible and advertises ERC-4337 account abstraction/gas sponsorship support.
- Alchemy currently lists Robinhood Mainnet/Testnet support for bundling, gas sponsorship and ERC-20 gas payments. RMT Pay V1 nevertheless keeps RMT burn settlement separate from native gas sponsorship so no RMT sale is required.
- Blockscout/Robinhood explorer evidence can enrich contract verification, but exact chain reads/runtime hashes and local simulation remain authoritative.
- Public randomness should use a future, precommitted external beacon/admitted VRF adapter; never operator-chosen randomness or `Math.random()`.

## Hard boundary

Until the owner explicitly opens this project for implementation:

- no production code changes;
- no new scheduled worker;
- no private key/signer authorization;
- no mainnet/testnet mint;
- no contract deployment;
- no revenue-policy change;
- no public product route;
- no merge into `main` merely because this planning branch exists.
