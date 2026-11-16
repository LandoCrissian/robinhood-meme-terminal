# Deployment and operations

## Environments

| Environment | Purpose |
| --- | --- |
| Netlify production | Read-only launchpad and historical discovery. The existing website and domain remain in service. |
| Railway and PostgreSQL | Existing historical ingestion and authenticated read integration. Keep one authorized writer and the stale-labeled snapshot fallback. |
| Local Anvil 31337 | Synthetic wallet, website and PostgreSQL integration, with separate fixture configuration. |
| Local Robinhood 4663 fork | Synthetic review of the named compiler profile against official on-fork Uniswap dependencies, governance and Safe behavior. Upstream traffic is read-only. |

The `rmt-curve-fixed-supply-security-v2` profile remains **BLOCKED_NO_BROADCAST**. The profile pins compiler inputs, source transformations, external contract runtimes and bytecode templates. Its chain-4663 output is for isolated review. Foundry and the browser fixture retain the chain-31337 execution gate. The [current compiler manifest](evidence/fixed-supply-security/4663-profile.json) is separate from the [frozen 4663 evidence](evidence/rmt-task043/4663-rotation-profile.json).

## Review locally

Use Node 22, pnpm 10.12.1, Anvil 1.7.1 and a dedicated local PostgreSQL instance. Use the checksum-pinned native solc 0.8.26 binary recorded in the manifest. Run `bash scripts/install-v4-deps.sh` from `packages/contracts`. The harness reads existing fork pins and read-only helpers from the immutable #594 Git object. Both fixtures compile the current candidate. Use separate scratch outputs for each run.

~~~powershell
pnpm install --frozen-lockfile
pnpm --filter @rmt/launch-website test:history
pnpm --filter @rmt/launch-website build
pnpm --filter indexer build
node docs/evidence/rmt-task041-closeout/verify-release.mjs
node docs/evidence/rmt-task047/probe-hosted-launchpad.mjs
~~~

The browser uses a local synthetic wallet and the same creator interface as the read-only website build. Set `$anvil`, `$solc` and `$postgresBin` to local tool paths. Choose a fresh output directory for browser evidence and a fresh output file for the 4663 rehearsal.

~~~powershell
node packages/contracts/scripts/fixed-supply-profile.mjs --solc $solc --chain 4663 --verify docs/evidence/fixed-supply-security/4663-profile.json
node scripts/visual-qa/rmt-creator-integration.mjs --anvil $anvil --solc $solc --pg-bin $postgresBin --output $browserEvidenceDirectory
pnpm test:fork-4663 --anvil $anvil --solc $solc --archive pocket --output $forkEvidenceFile
~~~

[Current verification and unsigned fork calldata](evidence/fixed-supply-security/release-manifest.json) · [First RMT project and unassigned live inputs](evidence/fixed-supply-security/first-project.json) · [Prior 4663 treasury replay](evidence/rmt-task046/4663-shared-owner-safe-rehearsal.json) · [Historical browser replay guide](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK038_V4_SETTLEMENT.md)

## Production release

1. **Resolve the release gate for the exact candidate.** Bind the compiler inputs, immutable constructor values, bytecode, runtime identities, official Uniswap contracts and canonical deployment plan. Rehearse locally and check size, gas, notice windows and dependency behavior. [Security](SECURITY.md)
2. **Verify the named inputs.** Reuse the existing proposed governance signers. Separately verify Operations and Reserve Safe addresses and their claims. Identify the protocol deployer, current and pending nonce, responsible operators and approved economics. Assign only verified beneficiary addresses. [Frozen input schema and closeout](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK041_RELEASE_CLOSEOUT.md)
3. **Qualify production observations.** Require dependable archive receipts and native settlement traces, independent Ethereum L1 finality, durable new-engine indexer checkpoints with backup and restore, read authentication, exact full-PoolKey routing and physical-wallet recovery. Keep credentials server-side. When evidence is absent, retain explicit pending or stale states.
4. **Keep separate approvals.** Deployment, first funded acceptance and public transaction activation each require their own owner decision. The existing website, DNS and Railway service stay within their current hosting configuration.

The provisional review economics include a 0.0004 ETH creation fee, 2 ETH graduation backing, a 1% curve trading fee, 90/5/5 earned-fee allocation and permanent original LP custody. Factory V2 fixes the 1B supply and the candidate preserves the 600M/400M allocation. Production rates, addresses and funding remain unapproved.

[Read-only production observations and open checks](evidence/fixed-supply-security/production.md)

## Historical operating evidence

Historical records retain their original source and checkpoint. The live [read-only discovery](https://www.rmtlaunch.fun) can serve verified historical records or a stale-labeled snapshot. Source history holds the [initial website verification](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_ROBINHOOD_CHAIN_DISCOVERY_REVIEW.md), [Railway recovery record](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_RAILWAY_RECOVERY.md) and [prior release handoff](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK047_RELEASE_HANDOFF.md).

[Repository cleanup and Task 049 handoff](evidence/repository-cleanup-048a.md)
