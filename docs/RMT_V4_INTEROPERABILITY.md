# Guarded Uniswap v4 interoperability

## Verified on the local fork

The initialization guard has only the `BEFORE_INITIALIZE` permission. It admits the bound launch factory through the pinned PoolManager. The pool uses the standard v4 interfaces for swaps, quotes and positions. Consumers must preserve `currency0`, `currency1`, `fee`, `tickSpacing` and `hooks` together, then derive the PoolId from the ABI-encoded key. Use chain ID and PoolManager alongside the PoolId. A hookless key for the same currencies identifies a different pool. [Guard analysis](RMT_V4_POOL_PREINITIALIZATION.md)

A loopback chain `31337` fork anchored at Base Sepolia block `57648300` passed the independent read-only verifier for direct official Universal Router **2.0** and **2.1.2** swaps in both directions on the same guarded pool.

| Check | Observed evidence |
| --- | --- |
| Pool identity | The official PoolManager `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` emitted `Initialize` at local block `57648306`. The log reconstructed PoolId `0x23a4b541194aa30c703806702428a11276ba6e2934681741f107831a82b93f75` with native ETH, token `0xc9158040Fd9F47a1C50A54dd2D371514F1F94DAE`, fee `3000`, tick spacing `60` and guard `0x9015E798328ff297fc6a2909640971dc50c92000`. |
| Funding | The same transaction emitted a positive liquidity change from the official PositionManager. The official StateView reported positive active liquidity at both observation blocks. |
| Router 2.0 | The buy settled at local block `57648307` and the sell at `57648310`. The verifier pinned the router runtime and PoolManager binding and checked the full key, positive minimum output and deadline in both receipts. The Quoter returned positive exact-input quotes in both directions at observation block `57648316`. [2.0 evidence](../evidence/rmt-launch-growth/independent-proof.json) |
| Router 2.1.2 | The buy settled at local block `57648317` and the sell at `57648320`. The verifier applied the same checks and confirmed that both swaps met their positive per-hop price bounds. The Quoter returned positive exact-input quotes in both directions at observation block `57648320`. [2.1.2 evidence](../evidence/rmt-launch-growth/independent-proof-212.json) |
| Independent discovery | The verifier read official PoolManager logs, receipts and StateView directly. Its reconstructed key matched all four router transactions. |

The table records the prior direct-settlement proof on the local fork. The release candidate adds explicit browser selection of 2.1.2 for the guarded direct loopback V2 runtime. Configuration verifies the exact Base Sepolia fork anchor, runtime bytecode at the anchor and current head, and the router's PoolManager binding. The pin is `0x8702463e73f74d0b6765aBceb314Ef07aCb92650` with runtime hash `0x2aa613cbe4bce524d53cb3ed1d6a8924d9ef1ccd00b250b64aa77c8eb376bf7e`. The checked runtime matched that hash at Base Sepolia block `57648300` and the public RPC head on November 12, 2026. V1 and private-preview execution continue to use 2.0. [Official v4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments#base-sepolia-84532), [2.1.2 release](https://github.com/Uniswap/universal-router/releases/tag/2.1.2)

For 2.1.2, the browser sets `minHopPriceX36` to the reviewed minimum output in base units multiplied by `10^36` and divided by exact input in base units, rounded down. The existing exact settlement and minimum-output checks also apply. Receipt recovery matches the original pinned router and calldata even after changing the active router and requires the reviewed block to remain canonical. If the reviewed block is orphaned, recovery cannot clear the pending request automatically. [Pinned periphery swap code](https://github.com/Uniswap/v4-periphery/blob/545a5d2a87228167edde48f3b9eda122d1e3c4d6/src/V4Router.sol#L78-L94)

## Reproduce

Follow the [guarded V2 local runbook](RMT_LAUNCH_V4_LOCAL.md#guarded-v2-and-longevity-v1) with the pinned Base Sepolia block and a fresh isolated Anvil fork with at least five unlocked test accounts. Set `RMT_LAUNCHPAD_ROUTER_VERSION=2.1.2` for the web server, indexer and browser test to exercise the candidate. Use `2.0` for the compatibility run. The [browser workflow](../.github/workflows/launchpad-browser-acceptance.yml) covers V1 with 2.0, ordinary guarded V2 with each router, and the test-only growth fixture with 2.1.2. Guarded runs independently match the public chain-qualified key and exact browser buy and sell hashes. The 2.1.2 runs also simulate an impossible hop bound and require the pinned router's per-hop error.

For standalone proof on the same pool, create a test launch and record its token, guard and launch block. Keep the fork running. The 2.1.2 helper uses the fifth test account and the independent official Quoter to set a 1% output tolerance and a positive per-hop price bound. It submits a test buy, exact-size and time-bounded sell approvals, and a test sell. [2.1.2 helper source](../scripts/visual-qa/exercise-guarded-router-local.mjs)

Run from the repository root and substitute the RPC, addresses and block numbers from your fork. Each verification range must include the launch and the respective router's buy and sell. `END_BLOCK` is optional and defaults to the head. The inclusive range is limited to 256 blocks.

```sh
node scripts/verify-guarded-v4-interoperability.mjs http://127.0.0.1:8545 TOKEN GUARD LAUNCH_BLOCK END_BLOCK --router=2.0
node scripts/visual-qa/exercise-guarded-router-local.mjs http://127.0.0.1:8545 TOKEN GUARD
node scripts/verify-guarded-v4-interoperability.mjs http://127.0.0.1:8545 TOKEN GUARD LAUNCH_BLOCK END_BLOCK --router=2.1.2
```

The read-only verifier checks the anchor hash, official contract runtime hashes and router binding, then reports the exact key, PoolId, block, funding, quotes and swap receipts as JSON. [Verifier source](../scripts/verify-guarded-v4-interoperability.mjs)

## Hosted support

| Service | Documented coverage and observed status |
| --- | --- |
| Uniswap Trading API | Lists Base Sepolia `84532` and Robinhood Chain `4663` with router 2.1.2. Local `31337` is outside its supported chains. The API sunset of 2.0 took effect on October 21, 2026. Both fork results are direct onchain settlement evidence. [Supported chains](https://developers.uniswap.org/docs/trading/swapping-api/supported-chains), [router sunset](https://developers.uniswap.org/docs/changelog/active-notifications/sunset-of-universal-router-2-0-and-2-1-1) |
| Uniswap web interface | Lists Ethereum Sepolia and Unichain Sepolia as its available testnets. Base Sepolia is API-only and local `31337` is unavailable. [Testnet availability](https://developers.uniswap.org/docs/trading/swapping-api/supported-chains) |
| Uniswap routing for hooks | Hooks with addresses beginning `0x91…`, swap or swap-delta permissions, or dynamic fees require manual allowlisting for automatic routing. The tested `0x90…` guard has only the initialization permission and the pool fee is static, so those documented allowlist conditions are absent. A future deployment needs its own address and live quote verified. The Guidestar beta lists Ethereum, Base mainnet and Robinhood Chain for same-chain exact-input routing. No hosted quote for the tested pool was observed. [Hook routing](https://support.uniswap.org/hc/en-us/articles/48291859140621-Routing-for-hooked-pools), [Guidestar beta](https://developers.uniswap.org/docs/changelog/active-notifications/guidestar-routing-beta) |
| 0x Swap API | Lists Base mainnet and Robinhood Chain. It omits Base Sepolia and local `31337`. 0x provides an intake process for custom v4 hook integrations. Guard acceptance and route availability are unknown. [Supported chains](https://docs.0x.org/docs/introduction/supported-chains), [hook integration intake](https://help.0x.org/articles/1372099017-how-to-apply-as-a-liquidity-source-in-the-0x-ecosystem) |
| Uniswap v4 Community Indexer | Its schema exposes hooks and its supported-network list includes Base mainnet. It does not list Base Sepolia, Robinhood Chain or local `31337`. No hosted indexing for the tested pool was observed. [Community Indexer coverage](https://developers.uniswap.org/docs/community/tooling/v4-community-indexer) |

Keep hosted indexing and routing status unknown until observed for the exact chain, PoolManager and full key. Release still requires independent security review and approved production parameters.
