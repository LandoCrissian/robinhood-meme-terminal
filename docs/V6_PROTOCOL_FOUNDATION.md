# RMT V6 Protocol Foundation

## Status

V6 is the required launch foundation before public token creation reopens. The production terminal may remain online, but the public launch path stays paused until V6 is deployed, verified, activated, and independently reviewed.

## Product contract

V6 exposes one public launch flow:

- `Launch Token`
- fixed supply
- deterministic fee policy
- automatic bonding-curve trading
- automatic graduation
- permanent post-graduation flywheel

Community, verified, partner, and other future launch styles are not separate factory contracts. They are versioned launch policies registered behind a common factory interface. V6 ships with two immutable public policies behind one simple Fair Start toggle:

- `RMT_SIMPLE_FAIR_V1` — the default protected opening
- `RMT_SIMPLE_OPEN_V1` — the same economics without the opening limits

## Upgrade model

The active factory remains selected by the existing version registry. Each major protocol release is immutable after deployment and activated as a new version:

- V6 introduces the policy registry, on-chain launch pause, and perpetual post-graduation revenue.
- V7 may add launch policies without changing the website's core launch transaction model.
- Existing token markets remain bound to the contracts and economics disclosed at launch.

No proxy-admin path may silently mutate live token economics.

## Required components

### 1. `RMTLaunchFactoryV6`

Responsibilities:

- reserve canonical token names and symbols across legacy factories
- expose one canonical `launch(policyId, metadata)` entry point
- retain `launchSimple(name, symbol, metadataURI)` as a compatibility wrapper
- reject disabled or unknown policies
- deploy fixed-supply token, reward vault, market, and graduation configuration
- require the shared on-chain launch gate from every launch entry point
- emit complete launch policy and economics metadata

The pause must block every launch entry point. Existing markets, claims, graduation, and discovery must continue operating.

### 2. `RMTLaunchPolicyRegistry`

A launch policy is immutable once used and contains:

- policy ID and version
- public visibility and enabled state
- curve fee
- creator share
- protocol share
- post-graduation fee allocation
- graduation target
- implementation addresses or implementation-set identifier

Governance may register a new policy version and enable or disable it for future launches. Governance must not alter the policy attached to an existing launch.

V6 enables only the reviewed Fair and Open variants. Future Community or Verified policies become additional policy IDs, not ad hoc branches in the website.

### 3. Governance and pause controller

- emergency pause: immediate, authorized guardian action
- unpause: delayed governance action after health checks
- policy registration: delayed governance action
- version-registry activation: existing delayed governance flow
- all actions emit public events

A compromised guardian may pause launches but may not withdraw funds, change economics, activate a factory, or unpause instantly.

### 4. Pre-graduation market

The market must:

- preserve fixed supply and Fair Start protections
- charge the disclosed curve fee on buys and sells
- route fees through the launch's immutable policy
- graduate only after the disclosed net reserve threshold
- keep curve-to-pool price continuity within the tested bound

V6 Simple policy should favor a clear creator/protocol split without optional user-selected destinations.

### 5. Graduation adapter and permanent liquidity

The adapter must:

- migrate the full tracked native reserve and remaining token inventory
- mint/record protocol-owned full-range liquidity
- permanently lock principal
- expose no owner or governance path to remove principal
- support permissionless collection of accrued fees
- route collected fees through deterministic policy destinations

### 6. Post-graduation flywheel

Graduation must not end creator or protocol economics.

The V6 pool charges 0.5% on post-graduation swaps. The permanently locked full-range position earns both fee currencies. Anyone may realize those fees, but the adapter can route them only to the launch's immutable splitter:

- 70% creator
- 30% protocol treasury

The same 70/30 split applies to the 1% bonding-curve fee before graduation. The collector cannot redirect proceeds, and neither creator nor protocol can remove the locked liquidity principal.

The original launch creator remains part of the permanent historical launch record. The current creator may move future reward payments to a new wallet through a two-step nomination and acceptance flow. Governance and the protocol operator cannot perform this change. Rewards deferred before a wallet change remain claimable only by the wallet that originally earned them.

Post-graduation fee routing must not permit withdrawal of locked liquidity principal.

### 7. Protocol treasury boundary

V6 sends the disclosed 30% protocol share directly to the configured protocol treasury. V6 does not promise an automatic buyback, weekly contest, referral allocation, or multi-vault split. If the protocol later uses treasury funds for a disclosed bonus buy or buyback, that is an operational treasury action and must be reported separately from immutable token economics.

## Website alignment

The website must read capabilities and policy metadata from the active factory rather than infer contract versions from incidental ABI calls.

Required factory views:

- `protocolVersion()`
- `launchesPaused()`
- `defaultPolicyId()`
- `getPolicy(policyId)`
- `isPolicyEnabled(policyId)`
- `launchCount()`
- `isNameUsed(name)`
- `isSymbolUsed(symbol)`

The launch page renders one flow from `defaultPolicyId` and one Fair Start toggle that selects between the two reviewed V6 policies. When future styles are enabled, the same policy metadata powers the selection UI, disclosures, fee summaries, and transaction arguments.

The website must fail closed: an unknown factory version, unavailable policy, unhealthy registry, or paused factory disables launch submission while keeping read-only terminal features online.

## Indexer alignment

Every `TokenLaunched` event must include or resolve:

- protocol version
- policy ID and policy version
- market fee
- graduation target
- creator and protocol splits
- market, vault, hook, adapter, and pool identifiers

The indexer stores these values per launch. It must never display current global economics as though they applied to historical tokens.

## Release gates

V6 cannot be activated until all gates pass:

1. contract build and unit tests
2. buy/sell fee-accounting tests
3. policy immutability tests
4. pause authorization and delayed-unpause tests
5. identity-protection tests across legacy factories
6. graduation valuation and price-continuity tests
7. post-graduation fee-routing tests
8. permanent-liquidity/non-withdrawal invariants
9. permissionless fee-collection tests
10. deployment-console binding verification
11. website production build and contract-capability tests
12. indexer migration and event-ingestion tests
13. independent security review
14. mainnet dry run and wallet-operated deployment
15. registry activation while launches remain paused
16. final production health verification before unpause

## Non-negotiable security properties

- No hidden mint authority.
- No token blacklist or transfer tax.
- No owner withdrawal of graduation liquidity principal.
- No mutable economics for an existing launch.
- No website-only pause as the final safety control.
- No public launch entry point that bypasses the pause or policy registry.
- No activation before independent review and verified deployment artifacts.
