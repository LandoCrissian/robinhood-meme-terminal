# RMT Launch v4 local preview

The launch engine runs on a loopback Anvil fork of Base Sepolia, chain ID **31337**. The app and indexer fail closed without a verified local factory and the exact dependencies from the [Uniswap deployment registry](https://developers.uniswap.org/docs/protocols/v4/deployments#base-sepolia-84532). The frontend keeps creation and direct trading separately gated. The read API and MCP tools also require the local deployment.

## Run it

1. Install the frozen workspace dependencies with Node 22.13 or newer.
2. Start and verify the fork and deploy the local-only factory using the [contract runbook](../packages/contracts/scripts/LAUNCHPAD_LOCAL.md).
3. Copy the evidence into the web environment using [the example](../apps/web/.env.example). Use a fresh absolute SQLite path for each factory runtime or fork.
4. Start the local indexer and web server as described in [indexer operations](INDEXER_OPERATIONS.md). With the environment loaded, the worker command is `pnpm --filter web launchpad:index:local` and the web command is `pnpm --filter web dev`.
5. Use an injected wallet in the local browser for an interactive run. The reproducible browser test uses the fork's unlocked test account behind a Playwright wallet fixture. Set `RMT_LAUNCHPAD_TEST_URL` to your loopback web URL and run `pnpm test:launchpad-browser`.

`pnpm --filter web test:local-launchpad` runs the journal, opening example, indexer, public data and MCP tests.

## Draft terms

The creator selects a fixed supply of 1 million, 100 million or 1 billion tokens, allocates 10–100% to full-range liquidity, and provides 0.001–100 test ETH. The contract calculates the exact two-sided deposit and refunds ETH rounding dust. The creator receives the remaining supply. The pool fee is 0.30%. RMT creation and swap fees are zero for this draft. The factory permanently owns the position and exposes creator-only collection of accrued position fees. Position principal has no withdrawal path. These parameters are for development.

Opening buy/sell examples use deterministic v4 math and the reviewed starting liquidity. Each example starts at the opening price, excludes gas, and does not supply a live quote. Actual swaps use the pinned Quoter and Universal Router. The public checks and tools expose deterministic chain and index evidence. See [public reads](RMT_LAUNCH_PUBLIC_READS.md).

## Guarded V2 and Longevity V1

On a fresh loopback Base Sepolia fork, use `node packages/contracts/scripts/deploy-launchpad-local.mjs http://127.0.0.1:8545 --guarded`. Configure `RMT_LAUNCHPAD_ENGINE_VERSION=2` and copy the returned guard address and runtime hash to `RMT_LAUNCHPAD_GUARD_ADDRESS` and `RMT_LAUNCHPAD_GUARD_RUNTIME_HASH`. Use the returned factory pins and a separate local SQLite path. The worker and web app must use the same settings. An omitted engine version keeps the existing V1 scope. Each worker configuration serves one factory.

The one-shot deployment pairs a factory with an immutable initialization-only hook. The hook checks the exact PoolManager and factory, with no swap or liquidity callbacks. Pool discovery and routing must preserve the full key including the hook address.

V2 launches default to 100% of earned LP fees for the creator. Longevity opt-in fixes three disclosed shares and recipient wallets at launch. Collection credits actual earned ETH and token amounts, then each recipient can withdraw its own credited balance. Cumulative fractional remainders stay in the ledger until subsequent collection credits them. The reserve recipient controls any reinvestment. Fee collection leaves the original position liquidity unchanged, and the factory exposes no principal withdrawal.

The existing token page and `get_launch_checks` tool report block-pinned custody, creator allocation and vesting status, permissions, and fee credits and payouts. Holder-address trends require a bounded reconstruction from the fixed-supply mint through two comparable blocks. The UI uses unknown when evidence is insufficient. Independent security review, production deployment provenance and economics, and external routing support remain release decisions.

The loopback browser suite selects Longevity when `RMT_LAUNCHPAD_TEST_LONGEVITY=true`. It verifies a fixture split of 60% creator, 25% treasury and 15% reserve, then checks collection, a creator payout and onchain accounting. [Phone setup](../evidence/rmt-launch-longevity/longevity-setup-phone.png), [review](../evidence/rmt-launch-longevity/create-review-phone.png), [launch health](../evidence/rmt-launch-longevity/launch-health-phone.png), [phone landscape](../evidence/rmt-launch-longevity/token-phone-landscape.png), [desktop](../evidence/rmt-launch-longevity/token-desktop.png)

## Runtime changes

The public root opens Launches and links to Create Token, My Launches and Wallet. It no longer mounts the old terminal directory, discovery/polling, or global onboarding, telemetry and profile providers. The old launches layout and its runtime imports were removed. Out-of-scope product routes and selected product APIs return HTTP 410. The exact shared authentication, quote, verification, authorization, native settlement and recovery paths remain available under their existing conditions. The existing RMT assets are documented under [Legacy RMT](RMT_LAUNCH_BASELINE_EVIDENCE.md).

The legacy database, services, admin routes and shared compatibility source remain. Pull requests run launchpad browser acceptance on a private loopback fork. The retired terminal UI workflows remain available as manual replays of the pinned legacy checkout. The production-readiness schedule keeps its directory and search probes while the live deployment serves the legacy terminal. Its launchpad checks require disabled execution and public reads. Review any worker retirement separately. PR #575 dependency files overlap with this branch and require a lockfile reconciliation and combined regression run if both changes are integrated.

## Visual evidence

The baseline captures show the existing production terminal after its terms screen. The new captures show the local fork with test ETH and a fixture-driven wallet. The screenshots include real local launch and settlement evidence.

- [Baseline phone](../evidence/rmt-launch-v4/before-phone-terminal.png) and [baseline desktop](../evidence/rmt-launch-v4/before-desktop-terminal.png)
- [Launches on phone](../evidence/rmt-launch-v4/launches-phone.png) and [desktop](../evidence/rmt-launch-v4/launches-desktop.png)
- [Launch review](../evidence/rmt-launch-v4/create-review-phone.png) and [wallet rejection](../evidence/rmt-launch-v4/create-rejection-phone.png)
- [Verified token on phone](../evidence/rmt-launch-v4/token-phone.png), [phone landscape](../evidence/rmt-launch-v4/token-phone-landscape.png) and [desktop](../evidence/rmt-launch-v4/token-desktop.png)

The Playwright test restores a launch draft, switches network, handles a rejected prompt, attaches an omitted transaction hash to the exact pending request, verifies the funded pool, buys, sells with two bounded approvals, claims fees, and finds the token in My Launches. The test checks layout widths and page errors. Anvil call traces verify the native sell payout. Public indexing and routing remain unknown. Real mobile wallet handoff, shared hosted storage and rate limits, independent security review, and mainnet release decisions remain open.
