# Contract and protocol radar — NFTs, RWAs, stock tokens, agents, and claims

**Research date:** 2026-08-23  
**Status:** RESEARCH / SOURCE CLASSIFICATION, NOT DEPLOYMENT AUTHORITY

This radar exists to stop RMT from cloning projects or treating every new interface as production-ready. Each item is classified by the capability RMT could integrate and the evidence still required.

## 1. Robinhood-native foundations

| Primitive | What it enables | RMT integration | Boundary |
| --- | --- | --- | --- |
| Robinhood Stock Tokens | ERC-20 economic exposure to stocks/ETFs on Robinhood Chain. | Canonical registry identity, balance/price/market discovery, trading, claims, portfolio. | They do not convey shareholder rights. Jurisdiction/policy eligibility remains independent. |
| ERC-8056 `uiMultiplier()` | Corporate-action/display scaling without rebasing raw balances. | Normalize displayed quantity, pricing, P&L, contained NAV, order amounts, and claim outputs. | Never double-apply or ignore the multiplier. Preserve base units separately. |
| Chainlink Data Streams / feeds | Low-latency signed stock/RWA pricing. | Price provenance, stale checks, asset/NAV evidence. | A price feed is not market liquidity or transfer eligibility. |
| EIP-4337 support | Smart accounts, paymasters, batched/user operations. | Future wallet/agent/account adapters. | Capability does not imply that an arbitrary account implementation is safe or admitted. |

Primary sources:

- https://docs.robinhood.com/chain/stock-tokens/
- https://docs.robinhood.com/chain/stock-tokens/building-with-stock-tokens/
- https://docs.robinhood.com/chain/connecting/account-abstraction/
- https://docs.chain.link/data-streams

## 2. NFTs becoming accounts and project identities

### ERC-6551 — Token-Bound Accounts

An NFT can control one or more deterministic smart-contract accounts. A TBA can hold fungible tokens, NFTs, LP positions, and other assets.

RMT use:

- inspect the exact registry/implementation/salt binding;
- value contained assets separately from NFT market price;
- expose account capabilities;
- verify current NFT owner and TBA signer authority;
- support StonkBrokers as the first real acceptance fixture.

Do not assume one TBA per NFT. Do not treat contained NAV as guaranteed sale proceeds. Prevent recursive/double-counted ownership graphs.

Source: https://eips.ethereum.org/EIPS/eip-6551

### ERC-7496 — Dynamic NFT traits (draft)

Onchain traits can represent current capabilities, entitlements, redeemed state, or project-building evidence.

RMT use:

- display-only HoodStreet Market Building traits;
- sale-time trait verification for assets whose value depends on current state;
- evidence-triggered capability health.

Do not accept project-written volume or safety traits as verified RMT evidence.

Source: https://eips.ethereum.org/EIPS/eip-7496

### ERC-7649 — Permissioned NFTs

Relevant for non-transferable or permissioned project/RWA identities.

RMT use:

- detect restricted transfer policy;
- fail closed on transfers until recipient eligibility is known;
- distinguish controller migration from ordinary sale.

Source: https://eips.ethereum.org/EIPS/eip-7649

### ERC-7891 — NFT split/merge (draft)

Potential future project-building subdivision, claim splitting, or position consolidation.

RMT posture: research only. Do not base HMB-1 on it until implementations, invariants, and market semantics are proven.

Source: https://eips.ethereum.org/EIPS/eip-7891

## 3. Financial NFTs and semi-fungible positions

### ERC-3525 — Semi-Fungible Tokens

`slot + value` is useful when positions share a class but have different quantities: bond tranches, vesting rights, invoices, credit positions, or claims.

RMT use:

- detect class/slot identity;
- show value separately from token ID;
- route claim/redemption rather than treating the token as a collectible;
- future claim-position research.

Source: https://eips.ethereum.org/EIPS/eip-3525

### ERC-5725 — Transferable vesting NFTs

Represents a vesting position with releasable token amounts.

RMT use:

- normalize vesting into the Universal Claim Layer;
- show vested/releasable/claimed state;
- verify transferability before any market action.

Source: https://eips.ethereum.org/EIPS/eip-5725

### ERC-7540 + ERC-7575 — Asynchronous and multi-asset vaults

ERC-7540 adds Pending → Claimable → Claimed request flows to tokenized vaults. ERC-7575 allows multiple vault contracts to share a share token and represent multiple underlying assets.

RMT use:

- pending deposit/redeem inventory;
- claimable shares/assets;
- multi-asset vault identity;
- valuation separate from executable redemption;
- first-class asynchronous claim states.

These standards are strong RWA infrastructure references. Production integration still requires actual Robinhood deployments, exact vault/compliance identity, and provider-specific verification.

Sources:

- https://eips.ethereum.org/EIPS/eip-7540
- https://eips.ethereum.org/EIPS/eip-7575

### ERC-7765 — RWA supporting NFTs

Research reference for an NFT whose supporting evidence or related RWA data matters to value.

RMT posture: inspect source, status, and implementation before use; prefer the generic asset/claim adapter model rather than hard-coding one RWA NFT type.

Source: https://eips.ethereum.org/EIPS/eip-7765

### ERC-7651 — Fractional NFTs

Combines fungible and non-fungible behavior in one system.

RMT risk: market identity, supply, ownership, and transfer semantics differ from normal ERC-20/721 assumptions. It needs its own adapter, not a generic “NFT fraction” label.

Source: https://eips.ethereum.org/EIPS/eip-7651

## 4. RWA compliance and asset evidence

### ERC-7943 — Universal RWA interface

Minimal interfaces for:

- `canSend`;
- `canReceive`;
- `canTransfer`;
- frozen-token state;
- forced transfer/freeze controls.

RMT use:

- introspect support;
- preflight sender/recipient/transfer eligibility;
- expose frozen/restricted state;
- block authorization when compliance is unresolved.

It applies across ERC-20, ERC-721, ERC-1155, and ERC-6909 implementations.

Source: https://eips.ethereum.org/EIPS/eip-7943

### ERC-8325 — Asset Anchor Registry (2026 draft)

Binds a token contract or token ID to a registry-scoped record with separate legal/evidence commitments, lifecycle, expiry, re-attestation, and invalidation history.

RMT use:

- project/RWA evidence anchors;
- HoodStreet building evidence floor;
- distinguish registry-only from mutually declared token bindings;
- preserve expiry/revocation/history.

Critical boundary: an anchor proves a registry record and lifecycle—not existence, ownership, legal validity, or value of the offchain asset.

Source: https://eips.ethereum.org/EIPS/eip-8325

### CMTAT / Chainlink ACE

Useful external implementation families for compliant token controls and policy/oracle integration.

RMT posture: adapter and interface integration, not an RMT token standard. Verify exact deployment, governance, upgrade authority, policy manager, and oracle provenance.

Sources:

- https://docs.openzeppelin.com/community-contracts/0.0.1/cmtat
- https://docs.chain.link/chainlink-ace

## 5. Agent identities, wallets, and regulated mandates

### ERC-8004 — Trustless Agents (draft)

ERC-721 identity plus reputation and validation registries for cross-organization agent discovery.

RMT use:

- agent identity reference;
- MCP/A2A endpoint association;
- reputation/validation evidence;
- project-building Agent Floor.

Payments and actual capabilities remain separate. Registration cannot prove that an agent is functional or safe.

Source: https://eips.ethereum.org/EIPS/eip-8004

### ERC-8199 — Sandboxed Smart Wallet (2026 draft)

Detached agent wallet with owner recovery, time windows, and check hooks.

RMT use:

- research reference for agent isolation;
- future mandate/account capability checks;
- avoid giving an agent broad authority over the owner's main wallet.

Do not make this a dependency until a reviewed implementation exists.

Source: https://eips.ethereum.org/EIPS/eip-8199

### ERC-8226 — Regulated Agent Mandate (2026 draft)

Adds scoped, time-bounded, financially capped mandates for agents operating regulated tokens. It is designed to compose with agent identities such as ERC-8004 and regulated tokens such as ERC-7943.

RMT opportunity:

```text
agent identity
+ principal compliance
+ exact asset/action mandate
+ expiry / per-trade cap / cumulative cap
+ allowance/operator approval
+ token-level compliance
+ provider-specific transaction verification
```

All layers must pass; a mandate never replaces token ownership/allowance or token-level compliance.

Source: https://eips.ethereum.org/EIPS/eip-8226

### Safe + ERC-7579 modules

Modular smart accounts can separate validators, executors, hooks, and fallback handlers.

RMT use:

- externally owned project/agent accounts;
- narrow modules and recovery;
- install/remove modules without inventing an RMT wallet.

Verify exact Safe/module deployment and module security before use.

Sources:

- https://docs.safe.global/advanced/smart-account-modules
- https://eips.ethereum.org/EIPS/eip-7579

### Hats + ERC-6551 Hat accounts

Onchain roles represented by ERC-1155 “hats,” with optional token-bound accounts controlled by current role wearers.

RMT use:

- project roles and expiring operator authority;
- HoodStreet controller/operator/distributor/agent-manager roles.

Source: https://docs.hatsprotocol.xyz/

### Delegate registry

Useful for allowing a hot wallet to exercise narrow NFT/token rights without moving assets from cold storage.

RMT use:

- read-only rights/delegation evidence;
- exact scope and expiry checks;
- no inference that delegation transfers ownership.

Source: https://docs.delegate.xyz/

## 6. Market and distribution protocols to integrate

### OpenSea / Seaport

Current strongest first NFT order source. RMT normalizes orders and independently verifies Seaport state/calldata before authorization.

Posture: verification-ready research, execution blocked pending full provider/fee proof.

### StonkBrokers / Anvil

Robinhood-native NFT AMM, ERC-6551 accounts, stock-token holdings, and agent experiments.

Posture: separate provider family. Do not route through a Seaport verifier.

### Hoodsea

ERC-1155 collections, automatic ERC-20 launch, V3/V4 liquidity, locked principal, built-in market, and claimable reward cycles.

Posture: capability graph candidate:

- project origin;
- NFT collection;
- token factory;
- NFT market;
- DEX markets;
- LP positions;
- airdrop/claim source.

Each must be verified separately.

### Givest

Stock-token escrow links with create/claim/refund/expiry and gasless relayer behavior.

Posture: best first Universal Claim Layer fixture after exact deployment/runtime/event verification.

### HoodClaw

Operator registry and settlement router for paid APIs.

Posture: service-payment capability; RMT may verify invoice/asset/amount/recipient/source without becoming the merchant or operator.

### Bowyer

MCP agent businesses with direct onchain subscription payments.

Posture: subscription/agent discovery capability; RMT should not host or claim ownership of agent runtimes.

### Splits

External immutable or mutable split contracts for ETH/ERC-20 distributions.

RMT posture: optional distribution destination/recipient topology after exact deployment verification. Do not replace the existing RMT Distribution Engine or infer RMT fee allocation.

Source: https://docs.splits.org/

## 7. The convergence RMT should build around

The useful common object is not “NFT.” It is an **onchain capability-bearing asset or project**:

```text
identity
+ assets
+ markets
+ accounts
+ claims
+ roles
+ agents
+ compliance
+ price evidence
+ external settlement actions
```

RMT's task is to normalize and verify that graph. HoodStreet renders it as a project location. External protocols keep ownership of their technology.

## 8. What not to deploy now

- an RMT clone of Seaport, Anvil, Givest, Hoodsea, HoodClaw, Bowyer, Hats, EAS, Safe, or Splits;
- a generic arbitrary-call project adapter;
- a tradeable project-control NFT;
- an NFT wrapper around Robinhood Stock Tokens to evade restrictions;
- a universal transferable claim NFT before source/legal transferability is proven;
- an agent wallet with broad access to a user's main account;
- an RWA “verification” badge based only on metadata or a paid project claim;
- a new fee for claims/subscriptions/distributions inferred from the 25-bps trade policy.
