# Deployment and operations

## Environments

| Environment | Purpose |
| --- | --- |
| Netlify production | Read-only launchpad and historical discovery. The existing website and domain remain in service. |
| Railway and PostgreSQL | Existing historical ingestion and authenticated read integration. Keep one authorized writer and the stale-labeled snapshot fallback. |
| Local Anvil 31337 | Synthetic wallet, website and PostgreSQL integration, with separate fixture configuration. |
| Local Robinhood 4663 fork | Synthetic review of the named compiler profile against official on-fork Uniswap dependencies, governance and Safe behavior. Upstream traffic is read-only. |

The frozen 4663 candidate `d4d81d1153a11728d98e694c1f3976ceb3408915` remains **BLOCKED_NO_BROADCAST**. It supplies review evidence for an earlier engine. Task 049 must rebuild the one-billion-token engine as a separately identified candidate with updated manifests, reproducible tests and independent review. [Frozen compiler profile](evidence/rmt-task043/4663-rotation-profile.json) · [Release manifest](evidence/rmt-task041-closeout/release-manifest.json) · [Task 049](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/626)

## Review locally

Use Node 22, pnpm 10.12.1, Anvil 1.7.1 and PostgreSQL 18. Use the checksum-pinned native solc 0.8.26 binary recorded in the manifest. The historical fixture build inputs come from [#594 at `8dca5773cbd4dc98f52a45616f420bce96b000f0`](https://github.com/LandoCrissian/robinhood-meme-terminal/tree/8dca5773cbd4dc98f52a45616f420bce96b000f0). Install the pinned dependencies there for the replay tools. Use separate scratch directories for app and index state.

~~~powershell
pnpm install --frozen-lockfile
pnpm --filter @rmt/launch-website test:history
pnpm --filter @rmt/launch-website build
pnpm --filter indexer build
node docs/evidence/rmt-task041-closeout/verify-release.mjs
node docs/evidence/rmt-task047/probe-hosted-launchpad.mjs
~~~

The browser uses a local synthetic wallet and the same creator interface as the production-style build. Set `$anvil`, `$solc` and `$postgresBin` to local tool paths, `$pinnedCheckout` to the pinned #594 worktree and `$newOutputDirectory` to a new evidence directory.

~~~powershell
node scripts/visual-qa/rmt-creator-integration.mjs --candidate $pinnedCheckout --anvil $anvil --solc $solc --pg-bin $postgresBin --output $newOutputDirectory
node docs/evidence/rmt-task046/run-shared-owner-safe-fork.mjs --checkout $pinnedCheckout --anvil $anvil --solc $solc --lib "$pinnedCheckout/packages/contracts/lib" --archive pinax
~~~

[Browser, restart and rollback evidence](evidence/rmt-task047/31337-browser-indexer-rehearsal.json) · [4663 fork evidence](evidence/rmt-task046/4663-shared-owner-safe-rehearsal.json) · [Historical browser replay guide](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK038_V4_SETTLEMENT.md)

## Production release

1. **Resolve the release gate for the exact candidate.** Bind the compiler inputs, immutable constructor values, bytecode, runtime identities, official Uniswap contracts and canonical deployment plan. Rehearse locally and check size, gas, notice windows and dependency behavior. [Security](SECURITY.md)
2. **Verify the named inputs.** Reuse the existing proposed governance signers. Separately verify Operations and Reserve Safe addresses and their claims. Identify the protocol deployer, current and pending nonce, responsible operators and approved economics. Assign only verified beneficiary addresses. [Frozen input schema and closeout](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK041_RELEASE_CLOSEOUT.md)
3. **Qualify production observations.** Require dependable archive receipts and native settlement traces, independent Ethereum L1 finality, durable new-engine indexer checkpoints with backup and restore, read authentication, exact full-PoolKey routing and physical-wallet recovery. Keep credentials server-side. When evidence is absent, retain explicit pending or stale states.
4. **Keep separate approvals.** Deployment, first funded acceptance and public transaction activation each require their own owner decision. The existing website, DNS and Railway service stay within their current hosting configuration.

The provisional review economics include a 0.0004 ETH creation fee, 2 ETH graduation backing, a 1% curve trading fee, 90/5/5 earned-fee allocation and permanent original LP custody. Task 049 binds the 1B rule and 600M/400M candidate allocation to the new implementation. Production rates, addresses and funding remain unapproved.

## Historical operating evidence

Historical records retain their original source and checkpoint. The live [read-only discovery](https://www.rmtlaunch.fun) can serve verified historical records or a stale-labeled snapshot. Source history holds the [initial website verification](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_ROBINHOOD_CHAIN_DISCOVERY_REVIEW.md), [Railway recovery record](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_RAILWAY_RECOVERY.md) and [prior release handoff](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK047_RELEASE_HANDOFF.md).

[Repository cleanup and Task 049 handoff](evidence/repository-cleanup-048a.md)
