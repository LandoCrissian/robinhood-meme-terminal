# RMT NFT Market Plugin — research boundary v1

**Status:** RESEARCH ONLY / NOT RUNTIME / NOT PRODUCTION

This directory is an intentionally isolated Codex handoff bundle for a future RMT NFT market layer. It remains outside `apps/*` and `packages/*`; it does not add a production route, indexer process, API key, signer, wallet prompt, deployed contract, Railway service, Vercel variable or active fee collection.

The word **plugin** means a self-contained engineering handoff boundary, not a Codex runtime plugin ABI.

## Product boundary

RMT should discover, value and eventually execute trades for **existing onchain NFTs** inside the same VNext terminal. This does not revive paused NFT minting, creator/V7 drops or an RMT-owned marketplace.

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
        +-> explicit 25-bps RMT execution economics
        +-> wallet authorization only after atomic settlement admission
```

Marketplace visibility, project origin, market existence and RMT execution attribution remain independent.

## Additive domain

Current VNext fungible identity is not sufficient for NFTs. NFT identity requires `(chainId, contract, tokenId)` and ERC-1155 additionally requires quantity. This plugin keeps NFT identity additive until both domains are proven, rather than rewriting active fungible execution work prematurely.

## Source posture

| Source | Research admission | Reason |
| --- | --- | --- |
| OpenSea / Seaport 1.6 | `verification_ready` | Robinhood support and canonical protocol identity are anchored; execution remains blocked. |
| Mintera | `candidate` | Live marketplace exists; exact secondary settlement authority is not yet pinned. |
| HoodMarket | `candidate` | Public docs separate secondary trading from mint contracts; current app APIs are private. |
| Nightgarden | `catalogue_only` | Market settlement is not independently live/verified. |
| StonkBrokers / Anvil | `candidate` | Separate AMM family; exact runtime/ABI/live fee math still require proof. |
| Reservoir hosted API | `unsupported` | Robinhood Chain is not assumed supported by the hosted API. |

No website/UI is allowed to promote itself into execution authority.

## Standards covered

- ERC-721 identity/ownership;
- ERC-1155 quantities/transfers/URI semantics;
- ERC-2309 consecutive mint coverage;
- ERC-4906 metadata refresh;
- ERC-2981 royalty discovery as advisory evidence;
- ERC-6551 token-bound accounts as a later portfolio/NAV layer.

## Robinhood-specific chain rule

Robinhood Chain is an Arbitrum Orbit chain. Preserve rollup block height separately from L1/Solidity `block.number` semantics where relevant. Never compare the clocks as though they were the same number space.

## OpenSea / Seaport rule

Pinned research identities:

- Chain ID `4663`;
- OpenSea slug `robinhood`;
- Seaport 1.6 `0x0000000000000068F116a894984e2DB1123eB395`;
- Robinhood WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`.

OpenSea fulfillment output is untrusted authorization input. RMT must independently verify order hash/state, signature/EIP-1271, zone, conduit, criteria proof, NFT identity/quantity, ownership, approvals, payment asset, all consideration recipients/amounts, creator-fee choice, recipient, target/value/selector, freshness and full simulation.

## Explicit NFT RMT execution economics

Owner direction captured by this research:

- **25 bps / 0.25% on successful RMT-originated NFT buys and sells**;
- basis = normalized venue gross NFT payment;
- floor rounding;
- no minimum fee;
- buy = buyer-side surcharge in the exact payment asset;
- sell = seller-side deduction from payment proceeds;
- approvals, signatures, cancellations and quote observation = zero fee;
- failed/reverted execution = zero fee;
- no fee is counted as revenue without independently verified atomic settlement;
- provider order economics remain exact; RMT fee settlement is a separate execution obligation.

This is a **research policy**, not production activation. It does not inherit production status from fungible `RMT_EXECUTION_V1/V2` merely because the rate is also 25 bps.

Read:

- `FEE_SETTLEMENT.md` — canonical economics and settlement invariants;
- `CODEX_FEE_HANDOFF.md` — implementation tranches;
- `contracts/IRmtNftFeeSettlementV1.sol` — non-deployed semantic interface;
- `src/execution-fee.ts` — tested policy/economics model;
- `src/venues/seaport-fee-settlement.ts` — side-specific Seaport settlement design.

## Validate locally

Requires Node 22+ and TypeScript 5.8+. There are no runtime npm dependencies.

```bash
cd research/nft-market-plugin
npm run validate
```

Expected terminal markers:

```text
RMT_NFT_MARKET_PLUGIN_SMOKE: PASS (... source registrations)
RMT_NFT_EXECUTION_FEE_SMOKE: PASS
```

## Main files

- `src/domain.ts` — NFT/order/quote types and validators.
- `src/chain-evidence.ts` — transfer evidence, dual clocks, ERC-2309 expansion.
- `src/metadata.ts` — hostile metadata/URI controls.
- `src/market.ts` — asks/bids/proceeds/costs/sweeps.
- `src/activity.ts` — explainable organic-activity signals.
- `src/adapters.ts` / `src/venues/*` — source admission and provider contracts.
- `src/execution-fee.ts` — 25-bps NFT payment-side economics and atomic proof model.
- `src/integration.ts` — current red zones and staged admission plan.
- `INDEXER_BLUEPRINT.md` — future shadow service design.
- `SECURITY.md` — threat model.
- `RESEARCH.md` — evidence ledger.
- `CODEX_HANDOFF.md` — complete implementation sequence.

## Hard stop

Do not move this directory into the pnpm workspace, add VNext routes, add production keys, deploy an executor, authorize a wallet path or collect fees merely because research tests pass. Runtime and fee activation require separate architecture admission, provider proof, policy hash/runtime pinning and explicit owner release.
