# RMT v4 growth vault

Growth Vault V1 is a test-only reserve recipient for a new guarded V2 launch on the loopback Base Sepolia fork, chain `31337`. The creator registers a vault for an unused launch intent, explicitly opts in during creation and commits a positive reserve share to that address. The vault cannot be attached to a completed launch. The factory's fee split and original position custody remain fixed.

## Run locally

Use the [local fork setup](../packages/contracts/scripts/LAUNCHPAD_LOCAL.md) with Node 22.13+, pnpm 10.12.1, Foundry 1.7.1 and the pinned Base Sepolia block `57648300`. Keep Anvil on `127.0.0.1`. This fixture uses disposable unlocked Anvil accounts and requires the direct loopback runtime. Use a fresh fork, a fresh SQLite file and no preview gateway settings.

From the repository root, after installing frozen workspace and pinned contract dependencies, run the following in Bash.

```bash
rmt_rpc=http://127.0.0.1:8545
rmt_scratch="$(node -p 'require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "rmt-growth-")).split(require("node:path").sep).join("/")')"
node packages/contracts/scripts/deploy-launchpad-local.mjs "$rmt_rpc" --guarded > "$rmt_scratch/deployment.json"
node packages/contracts/scripts/deploy-growth-vault-local.mjs "$rmt_rpc" "$rmt_scratch/deployment.json" > "$rmt_scratch/growth.json"

export RMT_LAUNCHPAD_ENABLED=true RMT_LAUNCHPAD_TRADING_ENABLED=true
export RMT_LAUNCHPAD_CHAIN_ID=31337 RMT_LAUNCHPAD_ENGINE_VERSION=2
export RMT_LAUNCHPAD_RPC_URL="$rmt_rpc" RMT_LAUNCHPAD_DATABASE_PATH="$rmt_scratch/launchpad.sqlite"
export RMT_LAUNCHPAD_FACTORY_ADDRESS="$(node -p 'require(process.argv[1]).factory' "$rmt_scratch/deployment.json")"
export RMT_LAUNCHPAD_FACTORY_RUNTIME_HASH="$(node -p 'require(process.argv[1]).factoryRuntimeHash' "$rmt_scratch/deployment.json")"
export RMT_LAUNCHPAD_FACTORY_START_BLOCK="$(node -p 'require(process.argv[1]).deployBlock' "$rmt_scratch/deployment.json")"
export RMT_LAUNCHPAD_GUARD_ADDRESS="$(node -p 'require(process.argv[1]).initializationGuard' "$rmt_scratch/deployment.json")"
export RMT_LAUNCHPAD_GUARD_RUNTIME_HASH="$(node -p 'require(process.argv[1]).initializationGuardRuntimeHash' "$rmt_scratch/deployment.json")"
export RMT_LAUNCHPAD_GROWTH_VAULT_TEST_FIXTURE=true
export RMT_LAUNCHPAD_GROWTH_VAULT_DEPLOYER_ADDRESS="$(node -p 'require(process.argv[1]).deployer' "$rmt_scratch/growth.json")"
export RMT_LAUNCHPAD_GROWTH_VAULT_DEPLOYER_RUNTIME_HASH="$(node -p 'require(process.argv[1]).deployerRuntimeHash' "$rmt_scratch/growth.json")"
```

Build with `pnpm --filter web exec next build`. Start the indexer with `pnpm --filter web launchpad:index:local` and the web app with `pnpm --filter web exec next start --hostname 127.0.0.1 --port 3196`. Give both processes the same settings above. For a manual launch, connect the fixture creator, select Longevity, set a positive reserve share, select the growth vault and enter the `intentId` in `growth.json`. Confirm the exact vault recipient in the launch review.

To run the browser fixture on a fresh unused intent, install Playwright Chromium with `pnpm exec playwright install chromium`, wait until `/api/launchpad/config` returns `ready` and run the following with the same scratch directory. This exercises creation, buy, sell, fee claims, an attempted add that defers, a successful add and the resulting launch-health UI. The wallet and both reviewers are disposable local fixtures.

```bash
RMT_LAUNCHPAD_TEST_URL=http://127.0.0.1:3196 \
RMT_LAUNCHPAD_TEST_RPC_URL="$rmt_rpc" \
RMT_LAUNCHPAD_TEST_LONGEVITY=true \
RMT_LAUNCHPAD_TEST_GROWTH_FIXTURE="$rmt_scratch/growth.json" \
RMT_LAUNCHPAD_TEST_OUTPUT="$rmt_scratch/screenshots" pnpm test:launchpad-browser
```

The [browser workflow](../.github/workflows/launchpad-browser-acceptance.yml) also runs the growth journey against a production build on a private loopback fork. Each mode uses its own deployment and database.

## Accounting and recovery

- Anyone may trigger collection. `collectReserve` credits only this vault's immutable factory reserve bucket using the actual ETH and token balance changes. `harvestGrowthFees` collects earned fees from the vault's own position without reducing liquidity. Those fees stay in the same tracked reserve. Direct or forced transfers create no spendable reserve and have no sweep path.
- An add uses both tracked assets and the standard PositionManager for the original guarded PoolKey. The vault permanently owns its full-range position and keeps subsequent additions in that position. It exposes no principal withdrawal, asset redirection, arbitrary call or automatic execution.
- Each add needs an EIP-712 plan signed by both immutable reviewer addresses. The signatures bind chain, vault, token, PoolId, nonce, both input caps, minimum liquidity, a reference square-root price, deviation and timestamps. The maximum reference age is five minutes and the maximum deviation is 50 basis points of the square-root price. This bound permits roughly 1% movement in the price itself. Both input caps and the minimum output must be positive. The temporary ERC-20 and Permit2 approvals are cleared on success and rolled back on a settlement revert.
- Insufficient balances, a price outside the signed bounds, liquidity below the minimum or failed settlement leave the reserves held. Check the receipt and the vault's latest attempt outcome together. A successful transaction can record a deferral. A reverted transaction leaves the prior outcome in place. A valid plan can retry at the same nonce while fresh. Once one plan adds liquidity, the nonce advances. Obtain a new signed plan for an expired review or a new nonce.
- The token page and `get_launch_checks` REST/MCP response distinguish original reserve fees credited by the ledger, fees transferred into the vault, growth-position fees collected, reserve held, actual liquidity added, custody and the last reviewed attempt. Fees still unharvested in the pool are outside the credited total. Inconsistent or unavailable accounting is reported as unknown.

The vault checks the two signing addresses and the onchain execution bounds. The local fixture uses a synthetic opening reference, bound to the canonical launch block and its timestamp for at most 120 seconds. Both fixture reviewers sign from one isolated Anvil node. The browser offers this opt-in only when the exact fork anchor, registry code and factory binding, and both disposable reviewer accounts verify. A registry pin can support historical health reads independently of new opt-in.

A production candidate still needs verified venue adapters, genuinely independent signing operations, a policy for conflicting plans and key loss, approved economics and independent security review. A second still-valid plan for the same nonce can win the race to execution. The vault lacks onchain cancellation, reviewer rotation and reserve withdrawal. Assets may remain held indefinitely if the other asset, an acceptable price or either review stays unavailable. [Release review and price requirements](RMT_LAUNCH_RELEASE_CANDIDATE.md)

## Focused tests

From `packages/contracts`, run the unit suite and opt-in official-contract fork suite. The upstream endpoint is used for reads. Without the environment variable, the fork test skips.

```bash
forge test --match-contract '^RMTV4GrowthVaultV1Test$' -vv
RMT_V4_BASE_SEPOLIA_RPC=https://sepolia.base.org forge test --match-contract '^RMTV4GrowthVaultV1ForkTest$' -vv
```

From the repository root, run the block-pinned public accounting checks.

```bash
pnpm --filter web exec tsx --test lib/server/new-launchpad-growth-health.test.ts
```
