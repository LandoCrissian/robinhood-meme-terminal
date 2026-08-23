# RMT NFT Market Plugin — research boundary v1

**Status:** RESEARCH ONLY / NOT RUNTIME / NOT PRODUCTION

This directory is an intentionally isolated handoff bundle for a future RMT NFT market layer. It is outside `apps/*` and `packages/*`, so the current pnpm workspace does not discover it. It does not add a route, indexer process, API dependency, signer, wallet prompt, fee, contract, Railway service, Vercel variable, or production behavior.

The word **plugin** here means a clean, self-contained Codex handoff boundary. It is not a claim that Codex has a special runtime plugin ABI.

## Product boundary

This work is about discovering, valuing and eventually executing trades for **existing onchain NFT assets** inside the one VNext terminal. It does not revive paused V7 creator tooling, NFT minting, drops, or an RMT-owned marketplace.

The intended long-term loop remains:

```text
scan -> verify -> analyze -> execute -> reconcile -> manage
```

For NFTs that becomes:

```text
chain asset truth
  + venue/order truth
  + project/origin truth
  + RMT execution truth
        |
        v
normalized NFT market model
        |
        +-> Active / Trending / New / All
        +-> exact item / collection workspace
        +-> best ask / best executable bid / sweep
        +-> strict provider verification
        +-> wallet authorization only after admission
```

These truth dimensions stay separate. A marketplace listing does not prove collection origin. A collection being visible does not prove a live order. A route observed by RMT does not prove RMT executed it.

## Why the domain is additive

Current VNext `AssetId` and `TradeIntent` are optimized for fungible atomic-unit assets. An NFT requires at minimum `(chain, contract, tokenId)` and ERC-1155 also requires quantity. This research package does not mutate the current fungible execution domain while draft execution PRs are active. A later architecture review may generalize the shared asset model after both domains are proven.

## Source posture

| Source | Research admission | Reason |
| --- | --- | --- |
| OpenSea / Seaport 1.6 | `verification_ready` | Robinhood Chain support is public; canonical Seaport 1.6 and WETH identities are independently anchored. Execution is still blocked. |
| Mintera | `candidate` | Live marketplace surface exists, but exact secondary protocol/API identity is not yet independently anchored. |
| HoodMarket | `candidate` | Public docs distinguish secondary trading from published mint contracts; app APIs are explicitly private. |
| Nightgarden | `catalogue_only` | Its docs state the market contract is written/tested but not deployed. |
| StonkBrokers / Anvil | `candidate` | Exact marketplace deployment/ABI/event boundary must be independently proven. |
| Reservoir hosted API | `unsupported` | Current hosted-chain list does not include Robinhood Chain. |

No candidate source can silently become authoritative because its website appears functional.

## Standards covered

- ERC-721 `(contract, tokenId)` identity and `Transfer` ownership evidence.
- ERC-1155 `TransferSingle`, `TransferBatch`, `URI`, quantities and event-driven enumeration.
- ERC-2309 `ConsecutiveTransfer` so large consecutive ERC-721 mints are not missed.
- ERC-4906 metadata refresh events.
- ERC-2981 royalty discovery as **advisory data**, never proof a venue enforces payment.
- ERC-6551 token-bound-account compatibility as a later portfolio/NAV enrichment layer, not NFT ownership truth.

## Robinhood-specific chain rule

Robinhood Chain is an Arbitrum Orbit chain. Research evidence preserves both rollup block number and L1/Solidity block number when available. Do not compare `eth_blockNumber` to a contract field derived from Solidity `block.number` without using the matching L1 clock.

## OpenSea / Seaport rule

Pinned research identities:

- Chain ID: `4663`
- OpenSea chain slug: `robinhood`
- Seaport 1.6: `0x0000000000000068F116a894984e2DB1123eB395`
- Robinhood WETH: `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`
- listings: native ETH by default in the OpenSea SDK chain mapping
- offers: WETH by default in the OpenSea SDK chain mapping

OpenSea fulfillment data is an **input to verification**, never a transaction RMT blindly forwards. Before a future wallet prompt, RMT must independently verify order hash/status, maker, signature/EIP-1271, zone, conduit, criteria proof, NFT identity/quantity, ownership, approvals, payment asset, all consideration recipients/amounts, creator-fee treatment, recipient, calldata target/value/selector, quote expiry and a fresh simulation.

## No implicit RMT NFT fee

This package deliberately sets NFT quote `rmtFeeState` to `not_admitted`. It must not inherit the fungible `RMT_EXECUTION_V1` or draft V2 economics. A future NFT fee policy, if any, requires an explicit independent owner decision and provider-specific settlement proof.

## Validate locally

Requires Node 22+ and TypeScript 5.8+; there are no npm dependencies.

```bash
cd research/nft-market-plugin
npm run validate
```

Expected:

```text
RMT_NFT_MARKET_PLUGIN_SMOKE: PASS
```

## Files

- `src/domain.ts` — canonical NFT/order/quote types and validators.
- `src/chain-evidence.ts` — transfer evidence, dual clocks and bounded ERC-2309 expansion.
- `src/metadata.ts` — metadata URI safety policy and ERC-1155 URI substitution.
- `src/market.ts` — best ask/bid, proceeds/cost economics and bounded sweep planner.
- `src/activity.ts` — explainable organic-activity signals without claiming wash-trade certainty.
- `src/adapters.ts` — venue/source admission contract.
- `src/venues/*` — pinned/candidate venue registrations and Seaport verification contract.
- `src/integration.ts` — current Codex red zones and staged RMT admission plan.
- `INDEXER_BLUEPRINT.md` — future shadow service design.
- `SECURITY.md` — threat model and mandatory verification gates.
- `RESEARCH.md` — source-of-truth research ledger.
- `CODEX_HANDOFF.md` — exact future implementation sequence.

## Hard stop

Do not move this directory into the pnpm workspace, add it to VNext routes, add production keys, deploy a service, or wire wallet submission merely because the research smoke tests pass. Runtime admission is a separate reviewed change.
