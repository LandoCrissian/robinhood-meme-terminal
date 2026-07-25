# Proof of Holding Protocol — Core + Epoch Rewards v0.1

Experimental, standalone reference implementation of wallet-native holding accounting and
externally funded Merkle reward epochs. It is incubated separately from RMT's live contracts and
does not connect to the RMT V6 token, its liquidity, or its production deployment path.

> **Your wallet is the position.** Tokens remain liquid and in the holder's custody.

## Current status

- Solidity sources compile with Solidity `0.8.36` under Foundry `v1.7.1`.
- Forty-two Solidity test functions pass, including 2,000-run fuzz tests and two stateful invariant
  suites configured for 512 runs at depth 128.
- Thirteen independent Python model tests pass. The holding and reward models each include a
  deterministic 50,000-operation randomized simulation.
- Repository secret scanning passes on the incubator branches.
- The code is experimental and unaudited. It is **not approved for mainnet deployment**.

## PoH Core included

- fixed-supply ERC-20 reference token;
- no post-construction mint authority;
- no transfer tax, pause, confiscation, or token-level blacklist;
- immutable transfer-aware accounting module;
- balance-weighted acquisition timestamp;
- active and lifetime balance-seconds;
- partial exits that preserve the remaining balance's age;
- full exits that reset the active position;
- recipient age reset on wallet transfers;
- explicit system-address exclusions;
- square-root loyalty policy capped at `1.75x`;
- ERC-165 interface detection.

## Epoch Rewards included

- immutable ERC-20 reward asset intended for WETH or another exact-transfer token;
- exact inbound funding and exact outbound beneficiary-credit verification;
- monotonically increasing reward epochs;
- immutable 48-hour root-review delay;
- permissionless finalization after the review delay;
- immutable 180-day claim period;
- chain-, distributor-, epoch-, index-, account-, and amount-domain-separated leaves;
- OpenZeppelin-compatible double-hashed Merkle leaves and sorted-pair nodes;
- epoch-specific bitmap replay protection;
- third-party proof submission with payment locked to the leaf beneficiary;
- bounded batches of at most 20 claims;
- cumulative claims capped by the funded epoch allocation;
- pending cancellation that refunds external funding and restores rollover funding;
- expired unclaimed rewards that become non-withdrawable future rollover;
- two-step publisher transfer;
- no publisher withdrawal or immutable reward-token rescue path;
- public reserve and solvency accounting.

## Not included

- a production root-generation CLI or hosted indexer;
- an on-chain holder enumeration mechanism;
- bonded competing roots or an on-chain fraud-proof adjudicator;
- production WETH and target-chain fork tests;
- a production timelock or multisig publisher;
- native-ETH push payments;
- buybacks, liquidity management, or DEX adapters;
- cross-chain holding age or cross-chain claims;
- stock-token treasury logic;
- production deployment scripts or an external audit.

## Repository map

```text
src/
  ProofOfHoldingToken.sol
  LoyaltyAccounting.sol
  PoHPolicyV1.sol
  interfaces/
    IProofOfHoldingCore.sol
    IPoHPolicy.sol
    IPoHEpochRewards.sol
  rewards/
    EpochRewardsDistributor.sol

test/
  LoyaltyAccounting.t.sol
  LoyaltyAccountingInvariant.t.sol
  PoHPolicyV1.t.sol
  EpochRewardsDistributor.t.sol
  EpochRewardsInvariant.t.sol
  mocks/

simulation/
  poh_model.py
  test_poh_model.py
  rewards_model.py
  test_rewards_model.py

docs/
  POH-CORE-SPEC-v0.1.md
  THREAT-MODEL.md
  POH-EPOCH-REWARDS-SPEC-v0.1.md
  EPOCH-REWARDS-THREAT-MODEL.md
```

## Build and test

Install the pinned OpenZeppelin dependency:

```bash
mkdir -p lib
git clone --depth 1 --branch v5.6.1 \
  https://github.com/OpenZeppelin/openzeppelin-contracts.git \
  lib/openzeppelin-contracts
```

Run the Solidity checks:

```bash
forge fmt --check
forge build --sizes
forge test -vvv
```

Run the independent models:

```bash
python -m unittest discover -s simulation -p 'test_*.py' -v
```

## Core rules

- Incoming tokens use a balance-weighted acquisition timestamp.
- A partial exit preserves the age of the remaining balance.
- A full exit closes and resets the active position.
- A recipient acquires transferred tokens at the current timestamp; age is not portable in v0.1.
- Self-transfers and zero transfers do not change position state.
- Pools, routers, bridges, vaults, and other system contracts may be excluded.
- The token, accounting contract, and zero address are permanently excluded.
- Holding metrics are objective state; reward policy and reward funding are separate modules.

## Reward rules

- Every epoch is fully reserved before it can be finalized.
- The publisher can cancel only while an epoch is pending.
- Anyone can finalize after the review delay and submit a valid claim for a beneficiary.
- Finalized roots and allocations cannot be changed or cancelled.
- Claims remain valid at the exact deadline timestamp.
- Expiration is permissionless only after the deadline.
- Unclaimed expired value becomes rollover; it never becomes publisher revenue.
- The contract rejects reward-token behavior that underfunds the distributor or underpays a
  beneficiary relative to the recorded amount.

## Trust boundary

The 48-hour delay is a public review window, not an on-chain proof that a root is correct. A
production deployment still requires deterministic public root generation, independent dataset
reproduction, monitored proposal events, and a timelocked multisig publisher.

## Safety boundary

Passing tests does not make a contract production-safe. Before value is attached, the project still
requires target-chain fork testing, exact WETH integration testing, privilege hardening, an
independent audit, public bug bounty, deployment rehearsal, monitoring, incident response, and a
documented migration strategy.
