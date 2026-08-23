# RMT ecosystem flywheel — integrate, verify, route

**Research date:** 2026-08-23  
**Status:** RESEARCH ONLY / NO RUNTIME OR PRODUCTION AUTHORITY

## Thesis

RMT should not own every marketplace, vault, escrow, agent, RWA contract, or distribution primitive that appears on Robinhood Chain.

RMT should become the layer that can answer, for any onchain object:

1. What is it?
2. Which project claims it, and what is independently proven?
3. Which markets, accounts, claims, agents, roles, and services are attached?
4. Which action is available now?
5. Which external implementation will settle the action?
6. Can RMT independently verify the exact action before authorization?
7. What actually settled, who received what, and which fees were paid?

The moat is the verified graph and adapter system—not relabeled copies of other projects' contracts.

## Product boundaries

### HoodStreet

HoodStreet owns project identity, presence, and navigation.

A project may claim a HoodStreet Market Building and expose independently verified capabilities. Membership/payment may buy commercial presence, but it may not buy:

- a safety endorsement;
- fabricated project origin;
- favorable RMT market ranking;
- execution admission;
- relaxed verification;
- jurisdictional eligibility.

### RMT

RMT owns asset resolution, discovery, market/claim intelligence, quote normalization, provider verification, action routing, receipt reconciliation, and execution attribution.

RMT does not become the protocol owner merely because it integrates an adapter.

### External protocols

External projects retain:

- contract identity;
- governance;
- fees;
- settlement semantics;
- upgrade/recovery authority;
- project identity;
- legal/compliance responsibilities.

Examples:

- OpenSea/Seaport remains the NFT order system;
- StonkBrokers/Anvil remains its NFT AMM/TBA ecosystem;
- Givest remains the stock-token escrow/claim source;
- Hoodsea remains its NFT→token/liquidity/reward lifecycle;
- HoodClaw remains its paid-API settlement router/operator registry;
- Bowyer remains its agent-business runtime/subscription system;
- Robinhood's registry remains canonical for Robinhood Stock Token identity.

### RMT Distribution Center

The existing Distribution Engine already supports explicit ERC-20, ERC-721, and ERC-1155 distributions with manifest/evidence and utility-cost boundaries. It is a post-settlement capability—not an automatic trading-fee splitter.

## Flywheel

```text
PROJECT ARRIVES
      |
      v
HoodStreet project claim + controller proof
      |
      +---- membership/payment is commercial state only
      |
      v
RMT independently resolves contracts and capabilities
      |
      +--> tokens / stock tokens / NFTs / vault shares / LP positions
      +--> DEX pools / NFT orders / NFT AMMs / lenders
      +--> ERC-6551 or modular project accounts
      +--> escrows / vesting / redemptions / refunds / distributions
      +--> agent identities / MCP endpoints / mandates / subscriptions
      +--> RWA compliance / price-feed requirements
      |
      v
ONE PROJECT GRAPH + ONE TERMINAL WORKSPACE
      |
      +--> discover / inspect
      +--> quote / buy / sell / swap
      +--> claim / refund / redeem
      +--> subscribe / pay
      +--> distribute
      +--> delegate / operate agent
      |
      v
provider-specific verification + user authorization
      |
      v
external protocol settles
      |
      +--> external venue/provider fees remain external
      +--> royalty/creator economics remain explicit
      +--> RMT receives 25 bps only on admitted, proven RMT buy/sell execution
      +--> claims/services/distributions do not inherit that fee
      |
      v
receipt + independent attribution + updated state
      |
      +--> project analytics
      +--> HoodStreet building traits
      +--> user portfolio and claims inventory
      +--> Distribution Center source evidence
      +--> agent reputation/service history
      |
      v
projects deepen liquidity, add capabilities, distribute rewards, attract users
      |
      v
more projects want a verified HoodStreet location and RMT integration
```

## Why projects join

A HoodStreet project gets more than a profile:

- canonical project record and controller evidence;
- claimed vs independently verified contracts;
- token/NFT/RWA/position/account mapping;
- every verified market in one terminal;
- external venue routing instead of venue lock-in;
- claim, refund, vesting, and redemption visibility;
- agent/service capability discovery;
- verified activity and receipt attribution;
- distribution planning and source evidence;
- a persistent project location that evolves with proven capabilities.

The project does not surrender contracts, users, liquidity, or settlement control to RMT.

## Why users return

A wallet contains more than spot balances. RMT can normalize the actions users currently hunt for across separate sites:

```text
TRADE       best verified buy/sell route
CLAIM       escrow, airdrop, vesting, distribution
REDEEM      asynchronous vault or protocol position
REFUND      expired escrow or failed bridge/funding path
SUBSCRIBE   project/agent service
OPERATE     approved agent or token-bound account
DISTRIBUTE  explicit ERC-20/721/1155 manifest
MANAGE      approvals, mandates, receipts, pending actions
```

RMT hides fragmentation—not provenance.

## Five reinforcing loops

### 1. Market loop

More projects → more mapped assets/venues → better discovery/routing → more verified execution → more RMT fee revenue → stronger infrastructure → more projects.

### 2. Claims loop

More protocols → more pending claims/redemptions/refunds → RMT makes them visible/actionable → users return → projects improve claim completion and support burden → more protocols integrate.

### 3. Distribution loop

Verified holders/traders/claimants/receipts → explicit snapshots/manifests → ERC-20/721/1155 distributions → stronger retention → more market/claim activity.

### 4. Agent loop

Agents and TBAs become discoverable → users grant narrow mandates → agents perform verified actions → receipts/reputation improve trust → more useful agents/services join.

### 5. HoodStreet loop

Verified capabilities/activity update project buildings → HoodStreet becomes a live economic map → users browse by what projects can actually do → credible projects value a permanent location.

## Economic boundaries

### RMT buy/sell execution

Owner direction remains 25 bps on successful, admitted, RMT-originated buys and sells.

Revenue evidence requires:

- authenticated RMT execution origin;
- exact policy/treasury binding;
- provider-specific verification;
- successful transaction;
- independently verified atomic fee settlement.

No RMT trade fee is earned on:

- approvals;
- signatures;
- listings without execution;
- cancellations;
- quote observation;
- failed/reverted transactions;
- external trades merely displayed by RMT;
- claims, refunds, subscriptions, service payments, or distributions without a separate explicit policy.

### External fees

RMT preserves/discloses rather than replaces:

- marketplace fee;
- actual required/selected creator royalty;
- AMM fee;
- vault or redemption fee;
- relayer/gas-sponsorship cost;
- operator or subscription fee;
- RWA issuance/redemption/compliance cost.

### HoodStreet commercial state

Payment may buy space/tooling. It cannot affect RMT market ranking, safety evidence, origin proof, or execution admission.

## Example project graphs

### StonkBrokers

```text
project identity
  -> ERC-721 collection
  -> ERC-6551 account implementation
  -> stock-token holdings / contained NAV
  -> Anvil NFT AMM
  -> STONKBROKER token markets
  -> MCP/agent capability
  -> distribution and LP-lock positions
```

RMT resolves and verifies each edge separately.

### Givest

```text
project identity
  -> StockDrops escrow
  -> claim-key identity
  -> stock-token output
  -> pending / claimable / claimed / refundable
  -> relayer/gasless execution evidence
```

RMT can expose the claim while Givest remains the claim/settlement authority.

### Hoodsea

```text
project identity
  -> ERC-1155 collection
  -> built-in NFT market
  -> ERC-20 factory at sellout
  -> V3/V4 pools and LP positions
  -> fee hook / vault
  -> epoch burn and claimable rewards
```

Project origin, collection identity, market venue, token liquidity, claim source, and RMT execution origin remain separate.

### HoodClaw / Bowyer

```text
project identity
  -> operator or agent-business identity
  -> MCP/API endpoint
  -> quote/invoice/subscription
  -> onchain settlement evidence
  -> service entitlement
  -> reputation/receipt history
```

RMT can discover and verify access/payment without becoming the service runtime.

## The missing layer: Universal Claims

Ordinary terminals hide rights that are pending, claimable later, refundable, vested, queued, or asynchronous.

RMT can become the first **spot + claims terminal**:

```text
ASSETS | POSITIONS | NFTs | CLAIMS
```

Details are in `UNIVERSAL_CLAIM_LAYER.md`.

## The missing project primitive: HoodStreet Market Building

A project needs one durable identity that can add external capabilities over time without migrating profiles or pretending one contract owns everything.

HMB-1 is:

- a project identity/passport;
- nontransferable or controller-migration-only;
- rendered from verified capability evidence;
- optionally linked to an external project smart account;
- explicitly not a revenue share, security, safety badge, or custody wrapper.

Details are in `HOODSTREET_MARKET_BUILDING.md`.

## Defensible moat

RMT's moat becomes the accumulated evidence/relationship graph:

- canonical asset identities;
- controller and project claims;
- deployment/runtime fingerprints;
- source-specific event history;
- market/order/claim normalization;
- provider-specific verification;
- compliance and price dependencies;
- receipts and exact fee attribution;
- project/venue/execution separation;
- cross-project portfolio and claim state.

A page is easy to copy. A multi-year verified capability graph is not.

## Non-negotiable boundaries

1. Do not copy external contracts and relabel them as RMT.
2. Do not let a project claim make its contracts authoritative without independent proof.
3. Do not let membership/payment buy safety, ranking, or execution admission.
4. Do not use an NFT/TBA/container to bypass stock/RWA restrictions.
5. Do not treat contained TBA assets as guaranteed NFT sale value.
6. Do not infer RMT volume/fees from page views or displayed routes.
7. Do not make a generic arbitrary-call adapter.
8. Do not make claims inherit the 25-bps trade fee.
9. Do not tokenize a legal/claim right before transferability and compliance are proven.
10. Do not create a second terminal shell.

## Recommended order

1. Read-only capability registry and project graph.
2. Read-only claims inventory/adapters.
3. HoodStreet project records and Market Building presentation.
4. NFT/stock/TBA/position enrichment.
5. Agent/service capability discovery.
6. Strict provider verification and controlled proofs.
7. Only then wallet routing, explicit fees, and production admission.
