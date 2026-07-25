# Proof of Holding Protocol — Core v0.1

Experimental, standalone reference implementation of wallet-native holding-age accounting.
It is incubated separately from RMT's live contracts and does not connect to the RMT V6 token,
its liquidity, or its production deployment path.

> **Your wallet is the position.** Tokens remain liquid and in the holder's custody.

## Current status

- Solidity sources compile with Solidity `0.8.36` under Foundry `v1.7.1`.
- Unit, 2,000-run fuzz, and stateful invariant suites pass in GitHub Actions.
- An independent Python state model passes seven tests, including 50,000 randomized operations.
- Secret scanning passes in the incubator pull request.
- The code is experimental and unaudited. It is **not approved for mainnet deployment**.

## Included

- fixed-supply ERC-20 reference token;
- no post-construction mint authority;
- no transfer tax, pause, confiscation, or token-level blacklist;
- immutable transfer-aware accounting module;
- weighted acquisition timestamp;
- active and lifetime balance-seconds;
- partial exits that preserve the remaining balance's age;
- full exits that reset the active position;
- recipient age reset on wallet transfers;
- explicit system-address exclusions;
- square-root loyalty policy capped at `1.75x`;
- ERC-165 interface detection;
- unit, fuzz, and stateful invariant tests;
- independent Python reference model;
- core specification and threat model.

## Not included

Rewards, Merkle epochs, buybacks, liquidity management, DEX adapters, cross-chain age,
stock-token treasury logic, production deployment scripts, or an external audit.

## Repository map

```text
src/
  ProofOfHoldingToken.sol
  LoyaltyAccounting.sol
  PoHPolicyV1.sol
  interfaces/
test/
  LoyaltyAccounting.t.sol
  LoyaltyAccountingInvariant.t.sol
  PoHPolicyV1.t.sol
simulation/
  poh_model.py
  test_poh_model.py
docs/
  POH-CORE-SPEC-v0.1.md
  THREAT-MODEL.md
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

Run the independent model:

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

## Safety boundary

Passing tests does not make a contract production-safe. Before value is attached, the project
still requires target-chain fork testing, privilege hardening, an independent audit, public bug
bounty, deployment rehearsal, and a documented migration strategy.
