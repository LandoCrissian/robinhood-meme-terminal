# RMT v4 launchpad local fork

The draft factory runs on chain `31337`. The isolated Anvil node uses official Base Sepolia v4 contracts at block `57648300`. The node submits to its local state and reads upstream state as needed. Use test wallets with Anvil funds.

From `packages/contracts`, install the repository's pinned Solidity dependencies and start the fork in a separate terminal. Use Foundry `1.7.1` and Node.js `22`.

```sh
bash scripts/install-v4-deps.sh
anvil --host 127.0.0.1 --port 8545 --fork-url https://sepolia.base.org --fork-block-number 57648300 --chain-id 31337 --silent
```

On Windows, Git can require `core.longpaths=true` for nested dependency checkout.

```sh
node scripts/deploy-launchpad-local.mjs
```

The script checks the local node and exact runtime hashes before deploying through an unlocked test account. It advances the fork clock with a local empty block when the upstream anchor predates the browser clock. Its JSON output contains the factory address, runtime hash, starting block and receipt hash for web configuration. Recreate those settings if you reset the node. A pinned local block can become unavailable through the public RPC. An existing archival endpoint for Base Sepolia can supply the same upstream block.

For the private HTTPS preview, start a fresh fork with `--accounts 0` and run `node scripts/deploy-launchpad-local.mjs http://127.0.0.1:8545 --sealed`. The temporary deployment signer is held only inside this local bootstrap process. Keep the same fork running so historical state at the deployment block can be verified. [Private preview runbook](../../../docs/RMT_LAUNCH_PRIVATE_PREVIEW.md).

Set the web and indexer processes to the same loopback RPC, factory address, runtime hash and deployment block. Use a fresh SQLite file after resetting the fork. See [indexer operations](../../../docs/INDEXER_OPERATIONS.md) for the environment variables and worker command.

## Launch terms

- Three fixed supply presets of 1 million, 100 million and 1 billion tokens with 18 decimals. The creator selects 10% to 100% maximum pool allocation and contributes 0.001 to 100 ETH in this draft.
- Native ETH is `currency0`. The launch ERC-20 is `currency1`. The v4 fee is 0.30%, tick spacing is 60, hooks are zero, and the tick range is `[-887220, 887220]`. RMT charges zero creation or trading fees in this draft.
- The initial price derives from requested token and native inventory. `preview` computes the exact funded amounts and liquidity with v4 rounding. The creator receives all tokens outside the actual deposit and any native dust. A creator contract needs to accept the native refund when the deposit rounds down.
- The factory retains the position NFT permanently. Its creator-only claim calls the standard v4 zero-liquidity decrease action, verifies the position's custody and unchanged liquidity, and sends accrued fees to the creator. There is no principal withdrawal or mutable policy.
- Deployment, initialization, liquidity funding and custody must all succeed before `LaunchCreated` is emitted. A preinitialized canonical PoolKey reverts. The [pre-initialization analysis and test evidence](../../../docs/RMT_V4_POOL_PREINITIALIZATION.md) describes preview recovery and a proposed production mitigation.

## Verification

```sh
forge test --match-path 'test/RMTV4LaunchFactoryV1.t.sol' -vv
RMT_V4_BASE_SEPOLIA_RPC=https://sepolia.base.org forge test --match-path 'test/RMTV4LaunchFactoryV1Fork.t.sol' -vv
```

If Foundry on Windows resolves `solmate/src/` twice in a dependency path, pass `--remappings 'solmate/=lib/v4-core/lib/solmate/'` to the test command.

The local tests use the pinned PoolManager and PositionManager source and an allowance harness. The opt-in fork test uses the deployed Permit2, Universal Router and Quoter, then checks settlement and permanent position custody. All swaps and fee claims are confined to local fork state.

Official dependency addresses and read-only RPC bytecode hashes for Base Sepolia and Robinhood Chain are in the [deployment fixture](../test/fixtures/rmt-v4-deployment-identities.json). The runtime checks also match the PositionManager, Universal Router, Quoter and StateView `poolManager()` bindings and the PositionManager `permit2()` binding. The pinned Router is the official table's Universal Router entry. [Uniswap v4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments).

The factory imports MIT-licensed interfaces and libraries from the [pinned v4 core source](https://github.com/Uniswap/v4-core/tree/59d3ecf53afa9264a16bba0e38f4c5d2231f80bc), [pinned v4 periphery source](https://github.com/Uniswap/v4-periphery/tree/ad04c9f24a170accf5ea1b2836bbafd514537ca6), and the OpenZeppelin Contracts revision selected by v4 core. Keep the upstream notices with redistribution. Local contract tests instantiate the pinned PoolManager under its separate source license. The fork and launch path call the official deployed PoolManager.
