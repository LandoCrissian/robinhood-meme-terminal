# Proof of Holding Protocol — Core V0.1

Experimental, standalone reference implementation of wallet-native holding-age accounting.
It is staged inside the RMT repository only as an incubator branch; it does not modify or connect
to the live RMT contracts.

> Your wallet is the position. Tokens stay liquid and remain in the holder's custody.

## Included

- fixed-supply ERC-20 reference token;
- no post-construction mint authority;
- no transfer tax, pause, confiscation, or ordinary blacklist;
- immutable transfer-aware accounting module;
- weighted acquisition timestamp;
- active and lifetime balance-seconds;
- partial exits that preserve the remaining balance's age;
- full exits that reset the active position;
- recipient age reset on wallet transfers;
- explicit system-address exclusions;
- square-root loyalty policy capped at 1.75x;
- unit, fuzz, and stateful invariant tests.

## Not included yet

Rewards, Merkle epochs, buybacks, liquidity management, cross-chain age, stock-token treasury
logic, production deployment scripts, or an external audit.

This code is **not approved for mainnet deployment**.

## Build

```bash
forge install OpenZeppelin/openzeppelin-contracts@v5.6.1 --no-commit
forge fmt --check
forge build --sizes
forge test -vvv
```

## Core rules

- Incoming tokens use a weighted acquisition timestamp.
- A partial exit preserves the age of the remaining balance.
- A full exit closes and resets the active position.
- A recipient acquires transferred tokens at the current timestamp; age is not portable in V0.1.
- Pools, routers, bridges, vaults, and other system contracts may be excluded.
- The token, accounting contract, and zero address are permanently excluded.
