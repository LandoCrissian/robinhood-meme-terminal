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

The results apply to transactions and state inside the local fork. The RMT browser journey uses its existing pinned 2.0 path. The separate 2.1.2 test exercises the onchain contract independently of the app and any hosted routing. [Official v4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments#base-sepolia-84532), [official 2.1.2 addresses](https://developers.uniswap.org/docs/trading/swapping-api/supported-chains)

## Reproduce

Follow the [guarded V2 local runbook](RMT_LAUNCH_V4_LOCAL.md#guarded-v2-and-longevity-v1) with the pinned Base Sepolia block and a fresh isolated Anvil fork with at least five unlocked test accounts. Create a test launch and record its token, guard and launch block. Keep the fork running. The loopback browser suite can produce the 2.0 buy and sell. The 2.1.2 helper uses the fifth test account and the independent official Quoter to set a 1% output tolerance and a positive per-hop price bound. It submits a test buy, exact-size and time-bounded sell approvals, and a test sell. [2.1.2 helper source](../scripts/visual-qa/exercise-guarded-router-local.mjs)

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
