# Graduation architecture

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

1. The curve reaches its immutable ETH graduation target and permanently stops trading.
2. Anyone may call `migrateLiquidity`; the caller cannot select the destination.
3. The market approves only its immutable graduation adapter.
4. The market sends its complete remaining token inventory and accounted ETH reserve.
5. The adapter must consume the exact supplied amounts and return a nonzero pool and liquidity result.
6. The market rejects incomplete migrations and records the result onchain.

The adapter address is immutable per factory deployment. A factory intended for production must be deployed with an adapter configured from verified mainnet addresses; a testnet factory must use a separately labeled test adapter.

## Production decision: V2 rejected

An earlier prototype targeted Uniswap V2. That approach is not acceptable for production: anyone can create or seed the deterministic token/WETH pair before graduation. Accepting that pool risks a manipulated opening price, while rejecting it creates a pool-squatting denial of service.

The V2 production adapter has therefore been removed. The ERC-20 remains unrestricted.

## Selected production direction: Uniswap V4

Uniswap V4 supports pool lifecycle hooks for initialization, adding liquidity, and swaps. Its singleton `PoolManager` is deployed on Robinhood Chain. A V4 pool can be atomically initialized at launch with a hook that rejects pre-graduation liquidity and swaps, then opened during the one-time migration. This reserves the pool before an attacker can initialize it while keeping restrictions out of the token contract.

Uniswap's audited Liquidity Launcher is the preferred reference implementation because it already coordinates price discovery and V4 liquidity migration. Robinhood-specific Liquidity Launcher strategy factories are not currently listed as deployed, so this integration requires a separate deployment and review before mainnet.

Sources:

- <https://github.com/Uniswap/v4-core>
- <https://github.com/Uniswap/liquidity-launcher>
- <https://github.com/Uniswap/liquidity-launcher/blob/main/docs/TechnicalReference.md>

Until the V4 adapter and hook are implemented and independently reviewed, factories may use only clearly labeled test adapters. No production factory deployment is authorized.
