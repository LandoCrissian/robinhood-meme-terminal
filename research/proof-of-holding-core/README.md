# Proof of Holding Protocol — Core + Rewards + Epoch Builder v0.1

Experimental, standalone reference implementation of wallet-native holding accounting, externally
funded Merkle rewards, and deterministic epoch construction. It is incubated separately from RMT's
live contracts and does not connect to the RMT V6 token, its liquidity, or its production deployment
path.

> **Your wallet is the position.** Tokens remain liquid and in the holder's custody.

## Current status

- Solidity sources compile with Solidity `0.8.36` under Foundry `v1.7.1`.
- Forty-six Solidity test functions pass, including 2,000-run fuzz tests, two stateful invariant
  suites configured for 512 runs at depth 128, and Python-to-Solidity Merkle vectors.
- Thirty Python tests pass across the holding model, reward model, and deterministic epoch builder.
- The holding and reward models each include a deterministic 50,000-operation state simulation.
- Builder tests include 10,000 randomized allocation datasets and 250 randomized Merkle datasets.
- Fixture roots, leaves, and proofs are cross-checked with `@openzeppelin/merkle-tree@1.0.8` and
  OpenZeppelin Contracts `MerkleProof`.
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

## Deterministic Epoch Builder included

- dependency-free Ethereum Keccak-256;
- strict fixed-width ABI encoding;
- exact PoHPolicyV1 integer multiplier and reward-weight math;
- duplicate-wallet normalization and conflict rejection;
- automatic system-address exclusions;
- deterministic largest-remainder allocation;
- exact allocation conservation down to the smallest reward-token unit;
- OpenZeppelin StandardMerkleTree v1 complete-tree layout;
- sorted leaves, sorted-pair nodes, roots, tree indices, and proofs;
- canonical normalized-input, calculation, dataset, claims, and manifest files;
- builder-source and artifact commitments;
- build and independent verify CLI commands;
- official OpenZeppelin JavaScript and Solidity cross-checks.

## Not included

- a production chain-event indexer or hosted data service;
- an independently operated root reproducer;
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
  EpochBuilderVector.t.sol
  mocks/

simulation/
  poh_model.py
  test_poh_model.py
  rewards_model.py
  test_rewards_model.py

tooling/
  epoch_builder.py
  test_epoch_builder.py
  verify_openzeppelin.mjs
  fixtures/

docs/
  POH-CORE-SPEC-v0.1.md
  THREAT-MODEL.md
  POH-EPOCH-REWARDS-SPEC-v0.1.md
  EPOCH-REWARDS-THREAT-MODEL.md
  POH-EPOCH-BUILDER-SPEC-v0.1.md
```

## Build and test

Install the pinned OpenZeppelin Contracts dependency:

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

Run the independent state models:

```bash
python -m unittest discover -s simulation -p 'test_*.py' -v
```

Run the epoch-builder checks:

```bash
cd tooling
python -m py_compile epoch_builder.py
python -m unittest -v test_epoch_builder.py
```

Build and verify the deterministic fixture:

```bash
python epoch_builder.py build \
  --input fixtures/epoch-input-v0.1.json \
  --output-directory ./out \
  --prefix epoch-7

python epoch_builder.py verify \
  --directory ./out \
  --prefix epoch-7
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

## Reward and allocation rules

- Every epoch is fully reserved before it can be finalized.
- The publisher can cancel only while an epoch is pending.
- Anyone can finalize after the review delay and submit a valid claim for a beneficiary.
- Finalized roots and allocations cannot be changed or cancelled.
- Claims remain valid at the exact deadline timestamp.
- Expiration is permissionless only after the deadline.
- Unclaimed expired value becomes rollover; it never becomes publisher revenue.
- The contract rejects reward-token behavior that underfunds the distributor or underpays a
  beneficiary relative to the recorded amount.
- The builder uses epoch-average balance, PoHPolicyV1 age at epoch close, and integer reward weight.
- Largest-remainder allocation distributes every funded base unit with deterministic address
  tie-breaking.
- Positive allocations receive contiguous address-ordered leaf indices before leaf hashes are
  sorted into the OpenZeppelin complete-tree layout.

## Trust boundary

The builder makes supplied epoch data reproducible; it cannot prove that the upstream chain-history
input was complete. The 48-hour delay is a public review window, not an on-chain proof that a root is
correct. Production requires independent event ingestion, finality policy, root reproduction,
monitored proposal events, and a timelocked multisig publisher.

## Safety boundary

Passing tests does not make a contract production-safe. Before value is attached, the project still
requires target-chain event-indexer validation, target-chain fork testing, exact WETH integration
testing, privilege hardening, an independent audit, public bug bounty, deployment rehearsal,
monitoring, incident response, and a documented migration strategy.
