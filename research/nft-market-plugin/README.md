# RMT NFT and Ecosystem Market Plugin — research boundary v1

**Status:** RESEARCH ONLY / NOT RUNTIME / NOT PRODUCTION

This directory is an intentionally isolated Codex handoff bundle for a future RMT NFT market and external-project capability layer. It remains outside `apps/*` and `packages/*`; it does not add a production route, indexer process, API key, signer, wallet prompt, deployed contract, Railway service, Vercel variable, or active fee collection.

The word **plugin** means a self-contained engineering handoff boundary, not a Codex runtime plugin ABI.

## Product boundary

RMT should discover, value, and eventually execute trades for **existing onchain NFTs and external project capabilities** inside the same VNext terminal. This does not revive paused NFT minting, creator/V7 drops, or an RMT-owned marketplace.

```text
chain asset truth
  + venue/order truth
  + project/origin truth
  + capability/claim truth
  + RMT execution truth
        |
        v
normalized asset and project graph
        |
        +-> Active / Trending / New / All
        +-> exact item / collection / project workspace
        +-> best ask / best executable bid / sweep
        +-> claims / refunds / redemptions / distributions
        +-> agents / subscriptions / paid APIs
        +-> strict provider verification
        +-> explicit 25-bps RMT buy/sell economics
        +-> wallet authorization only after atomic settlement admission
```

Marketplace visibility, project origin, market existence, claim source, external provider authority, and RMT execution attribution remain independent.

## External technology rule

RMT integrates other projects through evidence-bound adapters. It does not copy their contracts or present their technology as RMT-owned.

- HoodStreet supplies project identity and capability presentation.
- RMT resolves and verifies assets, markets, claims, accounts, agents, and actions.
- External protocols retain contract ownership, governance, fees, and settlement authority.
- RMT's 25-bps policy applies only to separately admitted, proven RMT buys/sells.
- Claims, refunds, subscriptions, API payments, and distributions do not inherit that trade fee.

Read:

- `ECOSYSTEM_FLYWHEEL.md` — full project/user/revenue flywheel;
- `PROJECT_CAPABILITY_ADAPTERS.md` — evidence and admission model;
- `UNIVERSAL_CLAIM_LAYER.md` — normalized pending/claimable/refundable positions;
- `HOODSTREET_MARKET_BUILDING.md` — project identity/passport concept;
- `CONTRACT_RADAR_2026-08-23.md` — NFT/RWA/stock/agent standards and projects;
- `CODEX_ECOSYSTEM_HANDOFF.md` — staged implementation sequence.

## Additive domains

Current VNext fungible identity is not sufficient for NFTs. NFT identity requires `(chainId, contract, tokenId)` and ERC-1155 additionally requires quantity. Claims require `(source contract, claim locator, beneficiary, lifecycle)`. Project capabilities require independent authority/evidence dimensions.

This plugin keeps those domains additive until each is proven, rather than rewriting active fungible execution work prematurely.

## Source posture

| Source | Research admission | Reason |
| --- | --- | --- |
| OpenSea / Seaport 1.6 | `verification_ready` | Robinhood support and canonical protocol identity are anchored; execution remains blocked. |
| Mintera | `candidate` | Live marketplace exists; exact secondary settlement authority is not yet pinned. |
| HoodMarket | `candidate` | Public docs separate secondary trading from mint contracts; current app APIs are private. |
| Nightgarden | `catalogue_only` | Market settlement is not independently live/verified. |
| StonkBrokers / Anvil | `candidate` | Separate AMM family; exact runtime/ABI/live fee math still require proof. |
| Reservoir hosted API | `unsupported` | Robinhood Chain is not assumed supported by the hosted API. |
| Givest claims | `adapter_candidate` | Strong stock-token claim/refund model; exact deployed source/runtime must be reverified before admission. |
| Hoodsea lifecycle | `multi_adapter_candidate` | NFT, token, market, liquidity, vault, and reward capabilities require separate verification. |
| HoodClaw / Bowyer | `service_adapter_candidate` | Paid API/agent services can be discovered and verified without RMT owning the runtime. |

No website/UI or paid project membership is allowed to promote itself into execution authority.

## Standards covered

NFT market foundation:

- ERC-721 identity/ownership;
- ERC-1155 quantities/transfers/URI semantics;
- ERC-2309 consecutive mint coverage;
- ERC-4906 metadata refresh;
- ERC-2981 royalty discovery as advisory evidence;
- ERC-6551 token-bound accounts as a later portfolio/NAV layer.

Ecosystem radar:

- ERC-3525 and ERC-5725 financial/vesting positions;
- ERC-7540 and ERC-7575 asynchronous/multi-asset vault claims;
- ERC-7943 RWA transfer/compliance introspection;
- ERC-7496 dynamic traits;
- ERC-8004 agent identity;
- ERC-8199, ERC-8226, and ERC-8325 as emerging draft research references;
- Safe/ERC-7579 modules, Hats roles, EAS attestations, and delegation as external primitives to integrate rather than clone.

## Robinhood-specific chain and stock-token rules

Robinhood Chain is an Arbitrum Orbit chain. Preserve rollup block height separately from L1/Solidity `block.number` semantics where relevant. Never compare the clocks as though they were the same number space.

For Robinhood Stock Tokens:

- canonical identity comes from Robinhood's registry;
- raw/base units and `uiMultiplier()` display semantics remain separate;
- price/NAV/order/claim calculations must not omit or double-apply the multiplier;
- route availability remains separate from jurisdiction and policy eligibility;
- an NFT, TBA, claim link, or project account may not bypass regulated-asset controls.

## OpenSea / Seaport rule

Pinned research identities:

- Chain ID `4663`;
- OpenSea slug `robinhood`;
- Seaport 1.6 `0x0000000000000068F116a894984e2DB1123eB395`;
- Robinhood WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`.

OpenSea fulfillment output is untrusted authorization input. RMT must independently verify order hash/state, signature/EIP-1271, zone, conduit, criteria proof, NFT identity/quantity, ownership, approvals, payment asset, all consideration recipients/amounts, creator-fee choice, recipient, target/value/selector, freshness, and full simulation.

## Explicit NFT RMT execution economics

Owner direction captured by this research:

- **25 bps / 0.25% on successful RMT-originated NFT buys and sells**;
- basis = normalized venue gross NFT payment;
- floor rounding;
- no minimum fee;
- buy = buyer-side surcharge in the exact payment asset;
- sell = seller-side deduction from payment proceeds;
- approvals, signatures, cancellations, and quote observation = zero fee;
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

## New tested ecosystem contracts

- `src/ecosystem-capabilities.ts` — project/capability graph, authority dimensions, admission, evidence, risk, and fee boundaries.
- `src/claim-layer.ts` — exact claim identity, lifecycle, compliance, and provider-specific action evidence with no implicit RMT trade fee.
- `src/hoodstreet-market-building.ts` — nontransferable/controller-migration project passport manifest whose floors point only to external capabilities.
- `test/ecosystem-smoke.ts` — adversarial checks for paid membership, runtime binding, fee isolation, claim authority, project graph integrity, financial-rights rejection, and RWA custody bypass.

## HoodStreet Market Building boundary

HMB-1 is a read-only-first project identity/passport concept. It may show capability floors and evidence-backed dynamic traits. It is explicitly not:

- revenue share or financial rights;
- a safety badge;
- paid market ranking;
- a universal treasury;
- regulated-asset custody bypass;
- execution admission.

No Market Building contract is deployed or authorized by this research.

## Universal Claim Layer boundary

RMT can normalize existing escrow, vesting, distribution, refund, bridge, fee-collection, and asynchronous-vault claims before considering any new claim token.

The first product is read-only lifecycle visibility. A transferable Claim Position NFT is not admitted because legal rights, compliance, transferability, tax, and double-claim semantics must first be proven per source.

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
RMT_ECOSYSTEM_FLYWHEEL_SMOKE: PASS
```

## Hard stop

Do not move this directory into the pnpm workspace, add VNext routes, add production keys, deploy an executor/passport/claim wrapper, authorize a wallet path, collect fees, or mutate Railway/Vercel merely because the research tests pass. Runtime and fee activation require separate architecture admission, provider proof, policy hash/runtime pinning, controlled evidence, and explicit owner release.
