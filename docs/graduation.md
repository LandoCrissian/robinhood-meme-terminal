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

## Migration sequence

1. The curve reaches its immutable ETH graduation target and permanently stops trading.
2. Anyone may call `migrateLiquidity`; the caller cannot select the destination.
3. The market approves only its immutable graduation adapter.
4. The market sends its complete remaining token inventory and accounted ETH reserve.
5. The adapter rejects a pre-existing V2 pool, creates the initial token/WETH pool, and requires the router to consume the exact supplied amounts.
6. V2 LP tokens are minted directly to `0x000000000000000000000000000000000000dEaD`.
7. The market rejects incomplete migrations and records the pool and liquidity result onchain.

The adapter address is immutable per factory deployment. A factory intended for production must be deployed with an adapter configured from verified mainnet addresses; a testnet factory must use a separately labeled test adapter.

## Open production blocker: pool squatting

The V2 adapter intentionally rejects a token/WETH pair that already exists. This prevents migration into a pool whose opening price or reserves may have been manipulated, but it also means an attacker could create or seed the deterministic pair before graduation and block migration.

The V2 adapter must not be used on mainnet until this denial-of-service risk is resolved and independently reviewed. Candidate mitigations include launch-time pool reservation plus narrowly scoped pre-graduation transfer controls, or a migration venue that does not expose a deterministic public pool before graduation. The clean fixed-supply token requirement and post-graduation permissionlessness remain non-negotiable.
