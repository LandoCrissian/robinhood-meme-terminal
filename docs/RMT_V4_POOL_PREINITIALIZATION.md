# RMT v4 pool pre-initialization

## Current factory

The draft V1 factory derives a CREATE2 token address from the factory address, creator, intent ID, and token constructor inputs. The canonical pool key uses native ETH, the predicted token address, the static fee, the tick spacing, and a zero hook address. Uniswap v4 identifies a pool by this key, so the opening price, funding terms, and transaction deadline do not distinguish a new pool. [RMT factory](../packages/contracts/src/RMTV4LaunchFactoryV1.sol) · [Pinned Uniswap PoolId](https://github.com/Uniswap/v4-core/blob/59d3ecf53afa9264a16bba0e38f4c5d2231f80bc/src/types/PoolId.sol)

An adversary who learns a creator's launch parameters and gets ordered first can initialize that exact key before any ERC-20 code exists at the predicted address. Initialization requires no liquidity deposit. The adversary can choose either the intended price or a different valid price. Both block the factory because a second initialization reverts. The revert rolls back the token deployment, intent and position records, and native value transfer. The creator can still pay gas for the reverted transaction. The adversary's earlier empty pool remains. [Pinned Uniswap PoolManager](https://github.com/Uniswap/v4-core/blob/59d3ecf53afa9264a16bba0e38f4c5d2231f80bc/src/PoolManager.sol#L117-L143) · [Pinned Uniswap pool initialization](https://github.com/Uniswap/v4-core/blob/59d3ecf53afa9264a16bba0e38f4c5d2231f80bc/src/libraries/Pool.sol#L100-L111)

An initialized zero-liquidity pool can also move its stored price through a swap with a zero balance delta. The factory must retain atomic initialization and funding and keep rejecting pre-initialized pools. A matching initialization event alone cannot establish an acceptable opening state. [Pinned Uniswap pool swap implementation](https://github.com/Uniswap/v4-core/blob/59d3ecf53afa9264a16bba0e38f4c5d2231f80bc/src/libraries/Pool.sol) · [OpenZeppelin Uniswap v4 core audit](https://www.openzeppelin.com/news/uniswap-v4-core-audit#front-running-pools-initialization-or-initial-deposit-can-lead-to-draining-initial-liquidity)

The creator can use a fresh, independently reviewed intent once the original transaction has been reconciled. Changing only the funding amount, allocation, or deadline leaves the poisoned address in place. A fresh intent that becomes observable before inclusion can be poisoned in turn. Preview simulation can detect existing interference before wallet confirmation. It cannot reserve a pool or guarantee transaction ordering.

## Recommended production mitigation

Use a separately reviewed factory version and an immutable Uniswap v4 hook with exactly the `BEFORE_INITIALIZE` permission. The hook authenticates the exact PoolManager as its caller and the versioned factory as the initializer supplied by the manager. It has no upgrade, delegatecall, arbitrary-call entry point, or route to initialize a pool itself. That last restriction preserves the guard because the pinned hooks library skips callbacks when the hook itself initiates the action. Keep the factory's atomic token creation, price computation, pool initialization, funding, permanent custody, and exact settlement checks. [Pinned Uniswap hook dispatch](https://github.com/Uniswap/v4-core/blob/59d3ecf53afa9264a16bba0e38f4c5d2231f80bc/src/libraries/Hooks.sol#L164-L193)

The hook address is part of the pool identity. An adversary can initialize a distinct hookless pool for the same token. Launch receipts, index records, and quotes must use the complete canonical key emitted by the new factory. The hook also creates a new routing compatibility requirement. The test prototype exercises a local swap router and PositionManager. Release requires evidence for each supported production router, quoter, and indexer.

Before signing off, review a repeatable deployment that binds the immutable hook and factory addresses without a mutable setup step. One approach uses a dedicated one-shot deployer that predicts the factory's upcoming CREATE address, deploys the permission-bit-matched hook, and deploys the factory in the same transaction. Mine the hook salt offchain before this deployment and verify the resulting address bits. Verify both runtime identities and their mutual address bindings. Test that public calls, spoofed callbacks, competing hookless keys, and untrusted currencies cannot affect the canonical launch. Verify exact position ownership, amount settlement, and successful buys, sells, and fee claims through the intended production dependencies.

Private transaction submission can reduce exposure where the target chain and wallet have a verified compatible route. It depends on the ordering provider. A publicly predictable list of fallback salts also remains poisonable. Neither measure supplies the deterministic protection of an authenticated initialization callback.

## Test evidence

The focused Foundry suite passed all 14 tests, including 512 funding fuzz cases and 2,048 custody invariant calls. It covers a permissionless same-price initialization, a different-price initialization, a pre-poisoned retry, a successful fresh unpoisoned intent, unchanged identity after economic or deadline edits, and an unfunded price move with a zero delta. The initialization-only prototype rejects direct callback spoofing and a hostile initialization through the real pinned PoolManager. It uses a distinct full key, accepts the authorized initialization after a competing hookless key is poisoned, and supports standard PositionManager funding and a local buy and sell.

```sh
forge test --match-contract RMTV4LaunchFactoryV1Test -vv
```

The prototype exists only in the [Foundry tests](../packages/contracts/test/RMTV4LaunchFactoryV1.t.sol). The shipping V1 factory bytecode, ABI, and deployment scope stay at the existing hookless test configuration. Mainnet activation remains gated on a production mitigation and independent review.
