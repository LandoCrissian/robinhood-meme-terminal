# RMT V6 Protocol Foundation

## Status

V6 is the required launch foundation before public token creation reopens. The production terminal may remain online, but the public launch path stays paused until V6 is deployed, verified, activated, and independently reviewed.

## Product contract

V6 exposes one public launch flow:

- `Launch Token`
- fixed supply
- deterministic fee policy
- automatic bonding-curve trading
- automatic curve completion with permissionless one-time V4 finalization
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
- refuse every launch when V6 is not the active factory in the on-chain version registry
- deploy fixed-supply token, fee splitter, market, and graduation configuration
- require the shared on-chain launch gate from every ordinary public launch entry point
- emit complete launch policy and economics metadata

The pause blocks every ordinary public launch entry point. One narrow exception lets only the immutable RMT operator consume the exact, one-time official `Robinhood Meme Terminal` / `RMT` migration under the reviewed Fair policy after V6 is active, while the public gate remains paused. The V6 factory and migration helper are permanently bound to legacy token `0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C`; construction fails unless that exact contract has code and reports the expected creator, name, and ticker, while the legacy factory reports both identity reservations. The migration event records the old token and new launch. That transaction does not unpause the gate and cannot launch any other identity. Existing markets, claims, graduation, and discovery continue operating.

Identity protection is scoped to the active, origin-verified RMT launch pipeline. V6 canonicalizes new names across case and separators, canonicalizes tickers case-insensitively, and consults legacy reservations. No launchpad can prevent an unrelated ERC-20 contract elsewhere on the chain from copying display text, so the terminal must always label token origin and never advertise chain-wide exclusivity.

### 2. `RMTLaunchPolicyRegistry`

A launch policy is immutable once used and contains:

- policy ID and version
- public visibility and enabled state
- curve fee
- creator share
- protocol share
- post-graduation fee allocation
- graduation target
- the canonical market implementation and graduation adapter recorded by the registry

The registry constructor permanently locks one reviewed market implementation and one reviewed graduation adapter, both of which must already contain contract bytecode. Every policy registration must use those exact two addresses in addition to the canonical economics and treasury. Governance may register a new policy version and enable or disable it for future launches, but a policy ID cannot substitute execution code. Changing either component requires a separately reviewed future protocol deployment; governance must not alter the policy attached to an existing launch.

V6 enables only the reviewed Fair and Open variants. Future Community or Verified policies become additional policy IDs, not ad hoc branches in the website.

### 3. Governance and pause controller

- V6 deploys a new `RMTV6Governance`; the already-deployed V5 `ExpandableGovernance` remains only the immutable authority of the existing version registry
- initial V6 signer set: RMTMain only, threshold 1
- immutable proposal delay: 24 hours
- immutable execution window: 7 days after the delay; pending proposals expire afterward
- any current signer may cancel a live pending proposal
- the full generic target, value, calldata, confirmations, execution window, status, and configuration epoch are publicly inspectable
- a prospective added or replacement signer must prove control and give expiring consent bound to the current configuration epoch, exact add-or-replace action, affected signer, and next threshold before the governance change can execute; the candidate may revoke any unconsumed acceptance before execution, a successful change consumes it, expiration makes it unusable, and an epoch change makes it stale
- adding, removing, or replacing a signer applies the resulting threshold atomically; a multi-signer configuration can never be 1-of-N, so adding the first extra wallet creates 2-of-2 governance rather than a backup wallet
- every signer/threshold change advances a monotonic configuration epoch and permanently invalidates every older pending proposal and confirmation
- execution is permissionless only for fully approved, uncancelled, unexpired proposals in the current epoch; the executor receives no role or reward
- emergency pause: immediate, authorized guardian action
- unpause: delayed governance action after health checks
- policy registration: delayed governance action
- version-registry activation: the existing V5 governance's delayed flow only
- all actions emit public events

`RMTV6Governance` is protocol-wide generic governance, not a creator-payout-only controller. A reviewed proposal may call the launch gate, policy registry, a fee splitter, or another explicit protocol target. Every call is subject to the same delay, approval, epoch, cancellation, expiry, and public-inspection rules. The creator-payout splitter independently limits its own governance-callable destination to the immutable original creator or immutable RMT treasury.

A compromised guardian may pause launches but may not withdraw funds, change economics, activate a factory, or unpause instantly.

A second signer is an active quorum member, not a recovery key. Once the initial 1-of-1 configuration becomes 2-of-2, both wallets must approve future proposals; loss or prolonged unavailability of either wallet can freeze governance.

### 4. Pre-graduation market

The market must:

- preserve fixed supply and Fair Start protections
- charge the disclosed curve fee on buys and sells
- route fees through the launch's immutable policy
- graduate only after the disclosed net reserve threshold
- clamp the final accepted buy to the exact net reserve threshold and refund any excess without letting a rejecting recipient block graduation
- keep curve-to-pool price continuity within the tested bound

V6 Simple policy should favor a clear creator/protocol split without optional user-selected destinations.

### 5. Graduation adapter and permanent liquidity

The adapter must:

- migrate the full tracked native reserve and remaining token inventory
- mint/record protocol-owned full-range liquidity
- permanently lock principal
- keep the adapter-owned full-range position as the pool's only liquidity position
- expose no owner or governance path to remove principal
- support permissionless collection of accrued fees
- route collected fees through deterministic policy destinations
- leave seed-settlement rounding dust permanently locked outside the collectible fee accounting

### 6. Post-graduation flywheel

Graduation must not end creator or protocol economics.

The V6 pool charges 0.5% on post-graduation swaps. The hook permits only the adapter-owned, permanently locked full-range liquidity position and rejects permissionless pool donations, so outside liquidity or donated assets cannot be presented as fees earned by the RMT position. Depending on swap direction, the position earns fees in native ETH, the launched token, or both. Token-denominated fees are swap fees—not extra token supply, creator inventory, or liquidity principal.

Anyone may call the permissionless collection function. Collection is not automatic: accrued position fees reach recipients only when a caller realizes them. The caller cannot redirect proceeds, retain either asset, or remove liquidity. The splitter applies the same allocation independently to each collected currency:

- 70% creator
- 30% protocol treasury

The same 70/30 split applies to the 1% bonding-curve fee before graduation. Each splitter accepts explicit fee accounting only from its permanently bound market or graduation adapter; its empty-calldata receive path rejects, and arbitrary or forced asset transfers never increase the published fee totals. The V6 policy registry rejects every policy that differs from the canonical 1% curve fee, 70/30 split, 0.5% post-graduation fee, 2 ETH target, immutable RMT treasury, canonical market implementation, or canonical graduation adapter. If the canonical PoolManager enables a separate protocol fee, Uniswap removes that amount before LP fee growth; the RMT 70/30 splitter applies to the remaining LP fees actually collected. The collector cannot redirect proceeds, and neither creator nor protocol can remove the locked liquidity principal.

The official V6 RMT launch is the single disclosed same-recipient case: its immutable original creator and protocol treasury are both the verified RMTMain wallet. That wallet receives the normal 70% creator payment plus the normal 30% protocol payment, totaling 100% of that launch's realized fees without creating an extra reward or counting any fee twice. All ordinary launches retain separate 70% creator and 30% RMT destinations.

The original launch creator remains part of the permanent historical launch record and can never be rewritten. Creators cannot change their fee wallet. The factory derives each splitter's payout authority from the same delayed governance shared by the launch gate and policy registry.

Only delayed RMT governance may move future creator-share payments from the original creator to the splitter's immutable RMT treasury, or restore them to the original creator. It cannot nominate an unrelated wallet. The creator cannot initiate, accept, or execute any payout change. Each governance action must include a nonzero public evidence hash and the current replay-protection nonce. The immutable RMT treasury may increment that nonce to invalidate a stale unexecuted action, but it cannot select a recipient or move funds. Already paid rewards and previously deferred ETH or token balances remain owned by the wallet that earned them.

The timing boundary is collection, not fee accrual: a collection completed before an accepted redirect uses the old recipient, while a collection completed afterward uses the new recipient even if some fees accrued earlier. The redirect cannot seize purchased tokens, modify token ownership or metadata, remove liquidity, or take holder funds. Governance compromise or misuse remains a material disclosed risk.

Graduation migrates only the market's tracked 2 ETH net reserve and tracked token inventory. A pending overpayment refund, forced ETH, an unsolicited token transfer, and adapter seed-settlement dust are never treated as liquidity or creator fees. Pending refunds remain claimant-owned; forced surplus and seed dust remain permanently locked because V6 intentionally exposes no recovery withdrawal that could become a principal-removal path.

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

Every `TokenLaunchedV6` event must include or resolve:

- protocol version
- policy ID and policy version
- market fee
- graduation target
- creator and protocol splits
- market, splitter, hook, adapter, and pool identifiers
- permanent original creator, current creator-fee recipient, payout authority, and protocol treasury

The indexer must preserve append-only payout-change, nonce-invalidation, and post-graduation collection history. It must never overwrite the original creator when the current fee recipient changes.

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
16. exact official RMT V6 migration and verification while ordinary launches remain paused
17. final production health verification before proposing and executing delayed unpause

## Non-negotiable security properties

- No hidden mint authority.
- No token blacklist or transfer tax.
- No owner withdrawal of graduation liquidity principal.
- No mutable economics for an existing launch.
- No V6 policy registration that substitutes a market implementation or graduation adapter.
- No creator-controlled payout change and no governance redirect to an unrelated wallet.
- No outside liquidity position that can dilute the published post-graduation fee split.
- No website-only pause as the final safety control.
- No ordinary public launch entry point that bypasses the pause, active-factory check, or policy registry.
- The one-time paused official migration is exact-identity, exact-wallet, Fair-policy, active-factory, and non-reopening only.
- No activation before independent review and verified deployment artifacts.
