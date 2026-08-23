# RMT Project Capability Adapter architecture

**Status:** RESEARCH ONLY

## Purpose

A project may own or use many unrelated systems:

- ERC-20 / stock tokens;
- NFT collections;
- DEX pools;
- NFT orderbooks or AMMs;
- token-bound accounts;
- vaults and LP positions;
- escrows and claim contracts;
- lending markets;
- distributions;
- agents and MCP endpoints;
- subscriptions or API-payment routers;
- RWA compliance and oracle dependencies.

RMT needs a generic integration boundary without pretending they share one ABI or one authority model.

## Core rule

**Register capabilities, not projects as monoliths.**

A verified project controller may claim:

> “This contract/capability belongs to our project.”

That claim does not prove:

- the runtime is safe;
- the market is liquid;
- a quote is executable;
- the asset is canonical;
- an action was executed through RMT;
- the user is eligible for a regulated asset.

## Independent authority dimensions

| Dimension | Meaning |
| --- | --- |
| `project_identity` | Who controls/claims the project record. |
| `asset_identity` | Exact chain/contract/token ID/standard. |
| `market_venue` | Where orders or liquidity exist. |
| `execution_provider` | Which implementation settles an action. |
| `claim_source` | Which contract creates/controls a claim. |
| `agent_identity` | Which registry/identity represents an agent. |
| `compliance_provider` | Which source answers eligibility/transfer checks. |
| `price_oracle` | Which source signs/publishes valuation data. |
| `distribution_source` | Which manifest/snapshot created recipient eligibility. |

A marketplace listing cannot become project-origin evidence. A project claim cannot become execution evidence. A price feed cannot become liquidity evidence.

## Tested research contract

`src/ecosystem-capabilities.ts` defines and validates:

- canonical capability/project IDs;
- exact contract deployment/runtime identities;
- authority dimensions;
- evidence state;
- admission state;
- actions and asset classes;
- contract/API/MCP endpoints;
- risk flags;
- provider-specific verification requirements;
- fee boundaries;
- relationship graph integrity.

## Admission ladder

```text
unsupported
  -> catalogue_only
  -> observation
  -> quote_only
  -> verification_ready
  -> execution_admitted
```

### Catalogue only

RMT may display identity/evidence. No live action is implied.

### Observation

RMT may read state. It may not present an executable quote.

### Quote only

RMT may normalize provider economics but wallet authorization is prohibited.

### Verification ready

A provider-specific verifier contract/checklist is complete enough for testing. Production authorization remains blocked.

### Execution admitted

Requires separately reviewed:

- deployment transaction/block;
- runtime code hash;
- verified ABI/source or independently decoded interface;
- exact targets/selectors/calldata schema;
- exact asset/amount/recipient binding;
- balances/allowances/approvals;
- fees/deadlines/freshness;
- full simulation;
- receipt reconciliation;
- settlement and RMT fee policy proof where applicable;
- recovery/disable controls;
- explicit production release.

A functioning website is not admission.

## Capability families

### Markets

- spot DEX liquidity;
- NFT orderbook;
- NFT AMM;
- RFQ/auction;
- vault redemption;
- lending/liquidation;
- LP-position management.

### Claims

- stock-token escrow drop;
- airdrop;
- vesting;
- async vault deposit/redeem;
- bridge refund;
- fee collection;
- protocol distribution.

### Services

- subscription;
- paid API / x402-style settlement;
- agent endpoint;
- operator desk;
- report/alert entitlement.

### Accounts/identity

- ERC-6551 TBA;
- ERC-8004 agent identity;
- Safe/ERC-7579 modular account;
- role/delegation registry;
- project-controller claim.

### RWA

- canonical asset registry;
- ERC-8056 multiplier/corporate-action state;
- price feed;
- transfer/compliance checks;
- asset anchor/legal evidence;
- regulated agent mandate.

## Action resolver

The interface asks the graph for available actions rather than hard-coding one flow.

Example:

```text
selected object: StonkBroker #1842

- inspect NFT metadata
- inspect ERC-6551 account
- value contained stock tokens
- buy/sell through Anvil
- buy/sell through Seaport
- inspect registered agent
- inspect claimable distributions
```

Each action resolves to one provider-specific adapter/verifier.

## Fee boundary

Every capability carries an explicit fee boundary.

### RMT trade fee

- actions: `buy`, `sell` only;
- exactly 25 bps in current research policy;
- production admission is separate;
- no route is RMT fee-admitted without atomic receipt proof.

### External provider fee

RMT discloses external fees and attributes them to their provider. It does not relabel them as RMT revenue.

### No implicit fee

`discover`, `inspect`, `claim`, `refund`, and many distribution/service actions do not inherit the buy/sell fee.

## RWA/stock requirements

For Robinhood Stock Tokens:

- resolve exact canonical contracts from Robinhood's registry;
- preserve base units and `uiMultiplier()` display semantics;
- prevent double/missing multiplier use in price, P&L, claims, or NAV;
- keep route availability separate from user/jurisdiction eligibility;
- never use an NFT/TBA wrapper as a compliance bypass.

For ERC-7943-like assets:

- detect interface support;
- query sender/receiver/transfer eligibility;
- expose frozen/restricted state;
- fail closed when unresolved.

For agent execution on regulated assets:

- agent identity;
- principal compliance;
- mandate scope/expiry/caps;
- token allowance/operator approval;
- token-level compliance;
- provider-specific transaction proof;
- all independently pass.

## Graph storage

Recommended logical records:

```text
Project
  -> ProjectClaim
  -> AssetIdentity
  -> CapabilityRegistration
  -> ContractIdentity
  -> MarketEvidence
  -> ClaimPosition
  -> AgentIdentity
  -> ComplianceDependency
  -> PriceFeed
  -> ExecutionReceipt
  -> DistributionEvidence
```

Each edge carries source, evidence state, and observation block/time.

## Freshness

Read-only snapshots may remain visible as stale with timestamps.

Authorization evidence never becomes stale-and-usable. Stale runtime, quote, claim state, ownership, approval, mandate, compliance, or oracle data blocks authorization.

## Adapter rule

An adapter may normalize:

- identity;
- state;
- quote;
- fee;
- approval requirements;
- claim lifecycle;
- verification inputs;
- receipt outputs.

It may not:

- forward arbitrary provider calldata;
- infer unknown security-critical fields;
- add hidden recipients;
- bypass provider-specific verification;
- pretend one protocol family is another;
- claim ownership of external technology.
