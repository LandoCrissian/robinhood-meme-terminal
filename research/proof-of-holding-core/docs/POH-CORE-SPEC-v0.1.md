# Proof of Holding Core Specification v0.1

**Status:** Experimental draft  
**Reference implementation:** Solidity 0.8.36  
**Scope:** Single-token, single-chain holding-state accounting  
**Security status:** Compiled and tested in CI; not externally audited; not approved for mainnet value

## 1. Purpose

Proof of Holding Core converts an ERC-20 wallet's verifiable balance history into objective, queryable holding metrics without requiring the wallet to deposit, stake, lock, delegate, or surrender custody of its tokens.

The core does not create yield. It records position state that a separate policy, rewards system, governance system, access-control module, or analytics application may interpret.

The design separates:

1. **Objective state:** balance, acquisition time, uninterrupted position duration, and balance-seconds.
2. **Policy:** loyalty multiplier, display tier, and application-specific reward weight.
3. **Funding and distribution:** intentionally absent from Core v0.1.

## 2. Goals

Core v0.1 is designed to provide:

- non-custodial wallet-native accounting;
- deterministic transfer-aware holding age;
- resistance to the “one old token ages a large new purchase” attack;
- partial exits that preserve the age of the remaining economic position;
- full exits that reset the active position;
- recipient age reset on ordinary wallet transfers;
- bounded arithmetic and constant-cost transfer updates;
- standardized events for independent indexers;
- immutable token and policy references;
- no post-deployment token mint authority;
- no transfer fee, pause, confiscation, or token blacklist capability.

## 3. Non-goals

Core v0.1 does not provide:

- rewards or revenue distributions;
- Merkle epochs;
- staking or locking;
- buybacks, burns funded by revenue, or liquidity management;
- transferable holding age;
- cross-chain age preservation;
- global wallet reputation;
- Sybil-resistant personhood;
- FIFO or LIFO token-lot accounting;
- support for arbitrary pre-existing ERC-20 tokens;
- rebase-token or ERC-777 compatibility guarantees;
- stock-token treasury logic.

## 4. Components

### 4.1 `ProofOfHoldingToken`

A fixed-supply reference ERC-20. It deploys one immutable `LoyaltyAccounting` instance and notifies it after every successful mint, burn, or transfer through the OpenZeppelin `_update` hook.

The reference token has no owner, post-construction mint function, pause, confiscation, ordinary blacklist, transfer tax, or fee-routing function.

### 4.2 `LoyaltyAccounting`

Stores and derives holding state for one immutable token. Only that token may invoke the transfer hook.

### 4.3 `PoHPolicyV1`

A stateless reference policy that converts holding age into a capped loyalty multiplier and display tier.

## 5. Position state

Each eligible account has the following state:

```solidity
struct Position {
    uint192 eligibleBalance;
    uint64 weightedAcquisitionTime;
    uint256 activeBalanceSeconds;
    uint256 lifetimeBalanceSeconds;
    uint64 activeSince;
    uint64 lastUpdated;
    uint64 lastPositionReset;
    uint64 positionId;
}
```

### 5.1 `eligibleBalance`

The token balance represented by the active PoH position. For an eligible wallet, this must equal the reference token's `balanceOf(account)` after every successful state-changing operation.

### 5.2 `weightedAcquisitionTime`

The balance-weighted acquisition timestamp of the current position. It is not the first-purchase timestamp and is not a token-lot ledger.

The policy-facing holding age is:

```text
holdingAge = currentTimestamp - weightedAcquisitionTime
```

when `eligibleBalance > 0`; otherwise it is zero.

### 5.3 `activeSince`

The timestamp at which the current uninterrupted nonzero position began.

```text
continuousHoldingDuration = currentTimestamp - activeSince
```

A partial exit does not change `activeSince`. A full exit resets it.

### 5.4 `activeBalanceSeconds`

The integral of eligible balance over time for the current uninterrupted position:

```text
activeBalanceSeconds = integral(eligibleBalance(t) dt)
```

It resets when the wallet fully exits or is excluded.

### 5.5 `lifetimeBalanceSeconds`

The cumulative balance-seconds recorded across all of the address's positions. It does not provide age or reward rights to a new position by itself.

### 5.6 `positionId`

A monotonically increasing identifier for each new nonzero active position at an address. A repurchase after a full exit begins a new position ID.

## 6. Time model

Core v0.1 uses `block.timestamp` and stores timestamps as `uint64`.

The implementation rejects timestamps beyond the `uint64` range. EVM block producers or sequencers can influence timestamps only within the bounds permitted by the host chain; applications must not treat second-level precision as a security guarantee.

## 7. Accrual

Before changing an eligible position, the accounting contract materializes elapsed balance-seconds:

```text
elapsed = checkpointTime - lastUpdated
accrued = eligibleBalance * elapsed
activeBalanceSeconds += accrued
lifetimeBalanceSeconds += accrued
lastUpdated = checkpointTime
```

`positionOf(account)` projects the same accrual in memory for a current view without mutating storage. Anyone may call `sync(account)` to materialize it on-chain.

## 8. Incoming-token rule

When an eligible account with an existing balance receives tokens at time `T`:

```text
newWeightedTimestamp =
    floor(
        (oldBalance * oldWeightedTimestamp + amountReceived * T)
        / (oldBalance + amountReceived)
    )
```

The implementation uses the algebraically equivalent overflow-reduced form:

```text
newWeightedTimestamp = oldWeightedTimestamp
    + floor(
        amountReceived * (T - oldWeightedTimestamp)
        / (oldBalance + amountReceived)
      )
```

This prevents a small aged balance from transferring its full age to a large new purchase.

If the prior eligible balance is zero, the transfer starts a new position with:

```text
weightedAcquisitionTime = T
activeSince = T
activeBalanceSeconds = 0
positionId += 1
```

## 9. Outgoing-token rules

### 9.1 Partial exit

When an eligible account sends or burns fewer tokens than its full eligible balance:

- elapsed balance-seconds are first accrued;
- `eligibleBalance` decreases;
- `weightedAcquisitionTime` remains unchanged;
- `activeSince` remains unchanged;
- future balance-seconds accrue only against the remaining balance.

No explicit loyalty penalty or cooldown is applied.

### 9.2 Full exit

When an eligible account sends or burns its full eligible balance:

- the position is accrued through the exit timestamp;
- a `PositionClosed` event is emitted;
- `eligibleBalance`, `weightedAcquisitionTime`, `activeBalanceSeconds`, and `activeSince` reset to zero;
- `lifetimeBalanceSeconds` remains historical;
- `lastPositionReset` is set to the exit timestamp.

A later receipt starts a new position and receives no age from the closed position.

## 10. Transfer behavior

| Operation | Sender | Recipient |
|---|---|---|
| Initial mint | Not applicable | New position begins at mint timestamp |
| Additional receipt | Not applicable | Weighted timestamp moves toward receipt time |
| Partial transfer | Remaining balance preserves age | Received amount is acquired at transfer time |
| Full transfer | Active position closes | Received amount is acquired at transfer time |
| Burn | Same rules as outgoing transfer | Not applicable |
| Self-transfer | No position change | No position change |
| Zero transfer | No position change | No position change |

Holding age is address-specific and is not transferable in v0.1.

## 11. Excluded addresses

Pools, routers, bridge escrows, reward vaults, treasury contracts, and other system accounts may need to be excluded so they do not receive holder loyalty or rewards.

The zero address, reference token, and accounting contract are permanently excluded. Additional exclusions are explicit and evented.

When an account is excluded:

- its active position is accrued and closed;
- its active holding state resets;
- future transfers to or from the excluded address do not create an active position for it.

When an account is later unexcluded, its current token balance starts a new position at the unexclusion timestamp. Historical age is not restored.

**Trust note:** exclusion governance is a privileged surface. A production deployment must place governance behind a disclosed timelock and multisig, constrain exclusion policy to genuine system contracts, and disclose every excluded address. Core v0.1 is not a substitute for those operational controls.

## 12. Reference loyalty policy

`PoHPolicyV1` uses a continuous square-root curve capped after 365 days:

```text
cappedAge = min(ageSeconds, 365 days)
multiplier = 1.0 + 0.75 * sqrt(cappedAge / 365 days)
```

The Solidity return value is 18-decimal fixed point. The maximum multiplier is `1.75e18`.

Approximate values:

| Weighted holding age | Multiplier |
|---:|---:|
| 0 days | 1.00x |
| 7 days | 1.10x |
| 30 days | 1.22x |
| 90 days | 1.37x |
| 180 days | 1.53x |
| 365+ days | 1.75x |

Display tiers are:

| Tier ID | Label | Age |
|---:|---|---:|
| 0 | Base | 0–6 days |
| 1 | Bronze | 7–29 days |
| 2 | Silver | 30–89 days |
| 3 | Gold | 90–179 days |
| 4 | Platinum | 180–364 days |
| 5 | Diamond | 365+ days |

A policy may calculate an application-specific weight as:

```text
rewardWeight = averageEligibleBalance * multiplier / 1e18
```

Core v0.1 does not calculate epoch average balance or distribute rewards.

## 13. Arithmetic bounds

The reference token's total supply cannot exceed `type(uint192).max`. Therefore every eligible balance fits into `uint192`.

The product of a `uint192` balance and a `uint64` elapsed interval fits within `uint256`, so a single balance-seconds accrual cannot overflow `uint256`.

Long-term cumulative additions remain subject to Solidity's checked arithmetic. The configured bounds leave a very large operational margin, but formal proofs and multi-year adversarial simulation remain launch requirements.

## 14. Events

The standard emits:

- `PositionCheckpoint` after relevant position changes or explicit synchronization;
- `PositionClosed` after a full exit or exclusion;
- `EligibilityUpdated` after an exclusion state change.

Indexers must treat events and token transfers together. Events are intended to make derived history reproducible; they are not a replacement for checking contract state.

## 15. Required invariants

A conforming reference implementation must maintain:

1. For every eligible account after a completed operation:
   ```text
   position.eligibleBalance == token.balanceOf(account)
   ```
2. An account with zero eligible balance has zero active holding age.
3. Incoming tokens cannot make a recipient's weighted acquisition timestamp older.
4. A partial exit cannot make the remaining position younger or older by itself.
5. A full exit cannot preserve active age.
6. Ordinary transfers cannot transfer age to the recipient.
7. Excluded accounts cannot accumulate active PoH balance.
8. No external caller other than the immutable token can invoke the transfer hook.
9. The reference token cannot mint after construction.
10. A failed accounting update reverts the underlying token operation atomically.

## 16. Interface detection

`LoyaltyAccounting` supports ERC-165 detection for `IProofOfHoldingCore` and `IERC165`.

The implementation version is encoded as integer `1000`, representing semantic version `0.1.0` for this prototype.

## 17. Trust assumptions

Core v0.1 assumes:

- the reference token faithfully invokes the accounting hook for every balance change;
- the immutable policy contract returns a stable policy hash;
- governance uses exclusion powers only for disclosed system addresses;
- the host chain's timestamp and finality behavior are acceptable for loyalty accounting;
- integrators distinguish objective metrics from promised financial returns.

## 18. Known limitations

- The accounting module only works with the bundled reference token; it cannot observe arbitrary ERC-20 transfers retroactively.
- Address ownership is not human identity. Splitting assets among wallets is not prevented.
- Smart-account migration and social recovery do not preserve age.
- A transfer to a lending market, vault, bridge, centralized exchange, or escrow normally ends the wallet's direct position.
- The weighted timestamp is an aggregate approximation, not tax-lot accounting.
- Exclusion governance remains a privileged surface.
- No on-chain epoch average-balance function is included.
- No reward solvency or distribution logic is included.
- No cross-chain state is included.

## 19. Versioning

Core logic, policy, and reward distribution should be versioned independently.

A production registry should identify a deployment by at least:

```text
chainId
referenceToken
accountingContract
policyContract
policyHash
coreVersion
```

Historical positions must never be silently reinterpreted under a different policy hash.

## 20. Conformance status

The included Foundry suite covers deterministic unit cases, 2,000-run fuzz cases, and stateful invariants. Passing tests establish implementation consistency for tested behavior; they do not establish absence of vulnerabilities.

Mainnet use requires independent review, a formal privilege inventory, adversarial fork testing, and an external audit.
