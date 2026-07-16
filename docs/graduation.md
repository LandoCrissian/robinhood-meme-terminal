# Graduation architecture

> **V6 release note:** This document preserves the dependency research and architectural history. The binding V6 behavior is defined in [V6_PROTOCOL_FOUNDATION.md](V6_PROTOCOL_FOUNDATION.md) and [V6_MAINNET_RELEASE.md](V6_MAINNET_RELEASE.md). Where older prototype language conflicts with those documents, the V6 specification controls.

## Verified Robinhood Chain mainnet dependencies

The following values were verified on 2026-07-10 against Robinhood Chain's official documentation and the official `Uniswap/contracts` deployment registry for chain ID `4663`:

| Dependency | Address |
| --- | --- |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| Uniswap V2 factory | `0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f` |
| Uniswap V2 router | `0x89e5db8b5aa49aa85ac63f691524311aeb649eba` |
| Uniswap V3 factory | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` |
| Uniswap V4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |

Source records:

- <https://docs.robinhood.com/chain/contracts/>
- <https://github.com/Uniswap/contracts/blob/main/deployments/json/4663.json>

Uniswap's official repositories do not currently publish deployments for Robinhood Chain testnet (`46630`). Testnet deployments must therefore use a clearly identified test adapter. Mainnet addresses must never be copied into testnet configuration.

## Migration boundary

1. During token creation, the factory calls the immutable adapter's `prepare` function in the same transaction.
2. The adapter must return a nonzero, token-specific pool ID; otherwise the entire launch reverts.
3. The market permanently stores that pool ID and adapter before receiving public inventory.
4. The curve reaches its immutable ETH graduation target and permanently stops trading.
5. Anyone may call `migrateLiquidity`; the caller cannot select the destination.
6. The market approves only its immutable graduation adapter.
7. The V6 market sends only its tracked remaining token inventory and exact accounted ETH reserve. Pending refunds, forced assets, and other surplus are excluded.
8. The adapter must consume the exact supplied amounts, keep unavoidable seed dust separately locked, and return a nonzero pool and liquidity result.
9. The market rejects incomplete migrations and records the result onchain.

The adapter address is immutable per factory deployment. A factory intended for production must be deployed with an adapter configured from verified mainnet addresses; a testnet factory must use a separately labeled test adapter.

## Production decision: V2 rejected

An earlier prototype targeted Uniswap V2. That approach is not acceptable for production: anyone can create or seed the deterministic token/WETH pair before graduation. Accepting that pool risks a manipulated opening price, while rejecting it creates a pool-squatting denial of service.

The V2 production adapter has therefore been removed. The ERC-20 remains unrestricted.

## Selected production direction: Uniswap V4

Uniswap V4 supports pool lifecycle hooks for initialization, adding liquidity, and swaps. Its singleton `PoolManager` is deployed on Robinhood Chain. A V4 pool can be atomically initialized at launch with a hook that rejects pre-graduation liquidity and swaps, then opened during the one-time migration. This reserves the pool before an attacker can initialize it while keeping restrictions out of the token contract.

The factory, market, hook, and `V4GraduationAdapter` now implement this lifecycle. `prepare` reserves the exact native/token V4 pool ID atomically during launch. Initialization intentionally waits until graduation so the actual terminal ETH and remaining-token amounts determine the opening square-root price instead of relying on a guessed price.

Uniswap's Liquidity Launcher is a useful reference implementation because it coordinates price discovery and V4 liquidity migration. RMT uses its own deployed V6 hook and adapter rather than an external Robinhood-specific Liquidity Launcher strategy factory. The integration remains in scope for exact source publication and independent review during the live mainnet beta.

Sources:

- <https://github.com/Uniswap/v4-core>
- <https://github.com/Uniswap/liquidity-launcher>
- <https://github.com/Uniswap/liquidity-launcher/blob/main/docs/TechnicalReference.md>

The V6 adapter initializes the reserved pool, mints one permanently locked full-range position, settles the exact V4 currency deltas, records unavoidable seed remainders as non-collectible locked dust, verifies conservation, and only then opens public swaps. Tests execute this flow against Uniswap's actual V4 `PoolManager`, including the complete bonding-curve migration path.

The position has no removal path. V6 realizes earned LP fees permissionlessly with a zero-liquidity-delta poke and routes ETH and/or launched-token swap fees through the immutable 70% current creator-share recipient / 30% RMT splitter. Collection cannot remove principal and the collector receives nothing. V6 is live; exact source publication and independent review remain outstanding mainnet-beta work.

## V4 reservation hook prototype

`V4GraduationHook` implements the first three required V4 lifecycle controls:

- `beforeInitialize`: only the immutable adapter may initialize a pool that it already reserved.
- `beforeAddLiquidity`: only the immutable adapter may create the single full-range position; outside liquidity additions remain rejected after opening.
- `beforeSwap`: all swaps revert until the adapter permanently opens the pool.

Reservations and openings are one-time transitions keyed by the official V4 `PoolId`. The hook never restricts ERC-20 transfers.

V4 derives enabled callbacks from the low bits of the deployed hook address. This permission set requires the `beforeInitialize`, `beforeAddLiquidity`, `beforeSwap`, and `beforeDonate` flags (`0x28a0`). The hook rejects permissionless donations so outside assets cannot be presented as fees earned by the locked RMT position. A production hook must therefore be deployed with a mined CREATE2 salt whose resulting address has those bits, then verified against the expected bytecode and immutable PoolManager/adapter addresses. The local test subclass bypasses address-bit validation only to test callback behavior; it is not deployable production code.

The hook uses a one-time deployment handshake to avoid circular CREATE2 address dependencies: its explicitly configured deployer binds the adapter exactly once after both contracts exist. The shared CREATE2 proxy never receives this authority. The adapter can never be replaced afterward. Separately, the factory binds each prepared token to the exact market it created before transferring public inventory. A graduation call from any other address must revert. The guarded testnet script deploys the upstream V4 manager, mines and checks the hook address, performs every binding, and verifies the final graph before completing.

The official dependencies are pinned to the same revisions recorded by Uniswap Liquidity Launcher:

- `v4-core`: `59d3ecf53afa9264a16bba0e38f4c5d2231f80bc`
- `v4-periphery`: `ad04c9f24a170accf5ea1b2836bbafd514537ca6`

## Standardized launch inventory

The production curve is calibrated for exactly `1,000,000,000` tokens with 18 decimals. The factory now enforces that supply onchain and the launch form exposes it as read-only. Arbitrary creator-selected supplies are rejected because they can make public inventory, curve pricing, and graduation settlement inconsistent.

Market fee, virtual reserves, and graduation target are immutable launch-policy configuration. The reviewed V6 mainnet policies use a 1% curve fee, 0.3 virtual ETH, 1,017,500,000 virtual tokens, and a 2 ETH net graduation target. Every launch permanently records its policy version and economics; deployment remains blocked until the V6 release gates pass.
