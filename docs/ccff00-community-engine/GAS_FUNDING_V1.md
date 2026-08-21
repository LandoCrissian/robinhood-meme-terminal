# CCFF00 Community Engine gas funding V1

**Status:** PLANNING ONLY — NO CONTRACT OR ECONOMICS APPROVED

This document separates the Community Engine's native Robinhood Chain gas funding from RMT Pay's future account-abstraction sponsorship and defines the minimum-safe shape of a future community-funded collector gas vault.

## 1. Economic invariant

Community Engine gas funding affects execution capacity only.

It never affects:

- community-seat count;
- allocation odds;
- service level;
- recipient order;
- Square selection;
- NFT/project selection;
- quality admission.

A wallet contributing 0 ETH and a wallet contributing 1 ETH have identical Community Engine entitlement if their CCFF00 ownership state is otherwise identical.

## 2. Initial canary funding

Do not deploy a gas vault merely to run the first canary.

For Package G, after explicit owner authorization, fund the isolated collector with only the tiny native ETH amount separately approved for the canary.

Measure actual:

```text
mint gas used
mint effective gas price
mint total gas cost
distribution gas used
distribution effective gas price
distribution total gas cost
TBA activation gas if applicable
reconciliation overhead that actually requires transactions
```

Use those measurements to propose production refill/cap values later.

## 3. Why the existing ProtocolPurposeVault is reference, not the final collector vault

The existing `ProtocolPurposeVault` is useful evidence for purpose-labelled ETH accounting, but its governance can release arbitrary amounts to arbitrary recipient addresses.

The Community Engine's desired blast radius is narrower:

```text
ETH may leave the future gas vault only toward the admitted collector/paymaster funding destination under bounded refill rules.
```

Therefore do not repurpose/deploy the generic purpose vault as the collector gas vault without a separate explicit decision.

## 4. Candidate `CCFF00CollectorGasVaultV1`

Only after canary measurements justify it, evaluate a purpose-built contract with these properties.

### Immutable identity

```text
CHAIN_ID = 4663
purpose domain = CCFF00_COLLECTOR_GAS_V1
```

The contract should reject deployment on the wrong chain.

### Deposits

Anyone may deposit native ETH:

```text
receive()
deposit()
```

Requirements:

- zero-value deposits rejected;
- emit sender + amount;
- maintain cumulative `totalReceived`;
- no NFT/RMT entitlement record is created.

### Outflow

No arbitrary recipient or arbitrary calldata.

Preferred first design to evaluate:

```text
fixed collector recipient
permissionless refill trigger
refill only when collector balance is below an admitted threshold
per-call maximum
per-epoch maximum
cumulative totalReleased
events
```

A permissionless caller should be able to trigger only the exact bounded transfer to the fixed collector; it cannot choose the recipient or amount beyond deterministic contract rules.

This reduces dependence on an operator being online without turning the vault into a treasury wallet.

## 5. Refill policy

Do not approve numeric values during planning.

Future constructor/policy inputs must be explicit nonzero measured values such as:

```text
collector
targetCollectorBalanceWei
maxRefillPerCallWei
epochLengthSeconds
maxRefillPerEpochWei
```

Potential deterministic refill amount:

```text
needed = max(0, targetCollectorBalance - collector.balance)
amount = min(needed, maxRefillPerCall, remainingEpochBudget, vault.balance)
```

If `amount == 0`, no transfer occurs.

A hostile caller cannot intentionally overfill the collector beyond the target/caps merely by repeatedly calling `refill()`.

## 6. Epoch accounting

Use deterministic epoch derivation from block timestamp and immutable/configured epoch length, for example:

```text
epoch = block.timestamp / epochLengthSeconds
```

Track:

```text
releasedInEpoch[epoch]
```

or an equivalent constant-storage rolling epoch structure.

No permissive fallback if cap configuration is missing/invalid.

## 7. Collector rotation problem

An immutable collector gives the smallest attack surface but becomes operationally awkward if the signer must be rotated.

Do not casually solve this with unrestricted `setCollector()`.

Package I must compare at least:

### Option A — immutable collector

- strongest simplicity;
- compromised/retired collector requires a new vault;
- residual vault ETH can become stranded unless another tightly constrained migration path exists.

### Option B — delayed governance rotation

- existing admitted RMT governance may nominate a new collector;
- mandatory delay/timelock;
- old and new collector identities publicly visible;
- rotation cannot change refill caps in the same action unless separately authorized;
- no arbitrary fund recipient;
- activation only after offchain/onchain collector preflight evidence.

### Option C — immutable vault points to a narrow collector registry

Only if an already-authoritative registry can be designed without recreating a general governance surface.

No option is approved yet. Canary/operational evidence should decide.

## 8. Pause semantics

A future vault may need an emergency pause for refills.

If added:

- pause can only stop outflow/refills;
- deposits may remain accepted or may be separately disabled by explicit design;
- pause cannot redirect funds;
- unpause/rotation authority must be current admitted RMT governance, not the collector signer;
- collector compromise must not grant vault administration.

## 9. No automatic refund promise

Community ETH is a voluntary contribution to the gas utility, not a purchase of NFT allocation rights.

Do not design a per-depositor withdrawal/refund balance unless the product explicitly changes later. That would add accounting/custody complexity and could blur the purpose of the fund.

Public UI must clearly explain the donation/use semantics before deposits are enabled.

## 10. Unexpected ETH sent directly to collector

The isolated collector may receive ETH outside the vault.

Runtime policy should still enforce its maximum operational balance. If the balance is unexpectedly above its admitted cap:

```text
PAUSE NEW SIGNING
```

Do not add a generic collector sweep/rescue path as a convenience. Resolve unexpected funding under an explicit incident policy.

## 11. Terminal revenue later

Current RMT terminal economics are not changed by this planning track.

Possible future funding methods, each requiring explicit economics authorization:

```text
RMT operations treasury voluntarily deposits ETH
or
new versioned revenue policy allocates an explicit share/amount
or
another separately admitted revenue source deposits ETH
```

No current 25-bps route or other revenue policy silently inherits a CCFF00 allocation.

Revenue-source accounting can be classified offchain/onchain by known sender/policy evidence, but source category has no allocation influence.

## 12. RMT Pay is a different native-gas rail

The Community Engine collector normally sends ordinary Robinhood transactions and therefore needs native ETH at the collector.

Future RMT Pay may instead use:

- third-party ERC-4337 sponsorship/provider billing;
- application credits/billing;
- or a future separately funded onchain paymaster.

Therefore:

```text
CCFF00CollectorGasVaultV1
!=
automatic source of every RMT Pay sponsored UserOperation
```

If later we self-fund a paymaster from community/terminal ETH, that is a new purpose/funding contract or explicitly compatible extension, not an assumption.

## 13. RMT never gets sold for collector gas

Hard rule:

```text
RMT utility burn
  ↓
0x000000000000000000000000000000000000dEaD

never
  ↓
DEX sale for ETH gas
```

If the ETH gas budget is exhausted, the Community Engine/RMT Pay capability pauses or asks for more admitted native-gas funding. It does not silently sell RMT or acquired NFTs.

## 14. Public accounting

Future Community Engine gas dashboard should distinguish:

```text
vault ETH balance
collector ETH balance
total community ETH received
total other admitted ETH received
total ETH released to collector
actual confirmed collector gas spent
current epoch release/cap
engine gas-budget state
```

Do not present vault releases as exact gas spent; actual gas cost comes from confirmed transaction receipts.

## 15. Package I contract test requirements

Before any deployment, Foundry/adversarial tests should cover at least:

- wrong chain deployment;
- zero deposit;
- exact cumulative deposit accounting;
- repeated permissionless refill attempts;
- target collector already funded;
- vault insufficient balance;
- per-call cap;
- per-epoch cap;
- epoch rollover;
- reentrancy/recipient fallback behavior;
- collector cannot redirect funds;
- arbitrary address cannot receive vault funds;
- pause/unpause boundaries if included;
- collector rotation delay/boundaries if selected;
- donation does not create any allocation state;
- no ERC-20/NFT arbitrary-call/custody surface.

## 16. Deployment/release boundary

Even a perfectly tested gas vault is not automatically needed.

Deploy only after:

1. isolated collector canary is successful;
2. actual gas measurements exist;
3. limited runtime demonstrates repeated funding need;
4. exact vault design/collector-rotation choice is approved;
5. numeric caps are derived from evidence and separately approved;
6. standard contract security/deployment gates pass;
7. owner explicitly authorizes deployment and gas funding.
