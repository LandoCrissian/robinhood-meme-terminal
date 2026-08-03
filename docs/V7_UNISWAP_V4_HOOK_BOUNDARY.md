# V7 Uniswap v4 hook boundary

Status: architecture boundary; no new hook deployment

Last verified against official Uniswap sources: August 2, 2026

## Decision

The V7 creator foundation does not require a Uniswap v4 hook.

Creator identity, media evidence, rights revisions, NFT manifests, edition limits, collaborator consent and revenue-split ownership remain independent contracts. They must continue to work even when an asset has no fungible token, no liquidity pool, uses Sushi, or uses a future venue.

An RMT hook is appropriate only for behavior that must execute inside a specific Uniswap v4 pool lifecycle, such as:

- controlled pool initialization;
- fair-launch or auction transition rules;
- narrowly bounded dynamic fees;
- pool-level protocol-fee forwarding; or
- liquidity policy that cannot be enforced outside the pool.

It is not appropriate for NFT ownership, creator review, music rights, media availability, marketplace listings, social profiles, collaborator splits, treasury proposals or general terminal analytics.

## Why the boundary is strict

Uniswap v4 hook permissions are encoded in the least-significant bits of the deployed hook address. A hook must therefore be salt-mined and deployed at an address whose permission bits exactly match its callbacks. The hook address is also fixed when a pool is initialized.

Hooks run inside pool execution. Incorrect delta accounting, callback permissions, external calls or state transitions can affect the pool rather than only the application UI. The Uniswap Foundation's security framework therefore treats hook accounting and external integrations as high-risk surfaces requiring explicit invariants and review.

## RMT admission requirements for any future hook

No V7 hook should enter deployment review unless all of the following are complete:

1. one narrow pool-level problem is defined and cannot be solved safely outside a hook;
2. the exact official Robinhood Chain PoolManager and periphery addresses and runtime hashes are independently verified;
3. callback permissions are minimal and the mined address flags are tested;
4. every balance delta is proven across swaps, liquidity changes, donations, reverts and callback reentrancy;
5. fee ceilings, recipients and governance controls are immutable or time-delayed and publicly disclosed;
6. fee-on-transfer and rebasing tokens are rejected unless explicitly supported and proven;
7. a mainnet-fork suite exercises official routers and settlement paths;
8. the hook is independently audited under a hook-specific security scope;
9. the exact module policy, code hash and metadata hash are admitted through delayed governance; and
10. activation is separated from deployment so a verified but inactive canary can be observed first.

## Existing RMT precedent

RMT already has v4 graduation-hook code with mined permissions and tests for atomic pool reservation, blocked public liquidity before opening, one-time opening, restricted donations and permanent adapter bindings. That code is part of the V6 token-launch path; it is not automatically suitable for creator releases or marketplace settlement.

Any V7 hook must be a new, independently versioned module. It must not silently reuse V6 launch assumptions or make creator assets dependent on a single DEX.

## Official references

- [Uniswap v4 core](https://github.com/Uniswap/v4-core)
- [Uniswap v4 hook permission library](https://github.com/Uniswap/v4-core/blob/main/src/libraries/Hooks.sol)
- [Official public hook examples](https://github.com/Uniswap/v4-hooks-public)
- [Uniswap Foundation Hooks Security Framework](https://github.com/uniswapfoundation/security-framework)
- [Uniswap Liquidity Launcher](https://github.com/Uniswap/liquidity-launcher)
- [Liquidity Launcher technical reference](https://github.com/Uniswap/liquidity-launcher/blob/main/docs/TechnicalReference.md)
