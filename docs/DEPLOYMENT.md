# Deployment and operations

The Task 064 owner transaction page is published at [Operations Safe setup](https://owner-deployment-064--rmt-wallet-check-056-f911548d.netlify.app/owner-deployment.html) on the existing isolated Netlify project. Access credentials stay outside Git. Its tab session persists through reload. It reads current wallet fees and requires explicit approval of the displayed maximum before a MetaMask transaction request. A fresh check retains the exact approved fee fields while current requirements fit them. Each signature and broadcast belongs to the owner. The page saves the original request before calling the wallet and recovers receipts without resubmission. Reserve remains locked pending independent Operations verification.

After each owner transaction, verify the exact canonical receipt with the existing `verifySafeCreation` or deployment verifier before preparing the next dependent transaction. Use the checksum-pinned transformed 4663 compiler input for protocol constructors. The Directory enforces its real two-day factory-publication notice. The separate migration-template admission has its own notice. No deployment transaction creates the RMT token.

The new production registration adapter shares the existing Railway process, writer lease and read authentication. It requires actual canonical factory/registry deployment and runtime bindings through `RMT_CURVE_PRODUCTION_BINDING`. Its three namespaced tables are installed after verifying a current recoverable backup. Runtime performs no schema DDL. Missing configuration preserves historical discovery and reports the new engine as undeployed. This adapter publishes verified creations with L2 evidence and explicit unverified L1/payment/refund states. Full production lifecycle and frontend activation follow the actual deployed bindings and acceptance.

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
node scripts/visual-qa/rmt-creator-integration.mjs --anvil $anvil --solc $solc --pg-bin $postgresBin --mobile-plan docs/evidence/mobile-signing/review-plan-4663.json --output $browserEvidenceDirectory
pnpm test:fork-4663 --anvil $anvil --solc $solc --archive pocket --output $forkEvidenceFile
~~~

[Current review handoff and unsigned fixture bundle](evidence/fixed-supply-release/README.md) · [First RMT project and unassigned live inputs](evidence/fixed-supply-security/first-project.json) · [Prior 4663 treasury replay](evidence/rmt-task046/4663-shared-owner-safe-rehearsal.json) · [Historical browser replay guide](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK038_V4_SETTLEMENT.md)

## Production release

1. **Evaluate the exact candidate and stage.** Bind compiler inputs, immutable constructor values, bytecode, runtime identities, official Uniswap contracts and canonical deployment plan. The owner's Task 063 policy permits internal evidence with explicit scoped risk acceptance. An external audit is optional. Confirmed exploitable high-impact vulnerabilities and unresolved material loss paths stop the affected stage. Preserve both strict scanner failures. [Security](SECURITY.md) · [Machine policy](evidence/production-readiness/task063-release-policy.json)
2. **Verify the named inputs.** Reuse the existing proposed governance signers. Separately verify Operations and Reserve Safe addresses and their claims. Identify the protocol deployer, current and pending nonce, responsible operators and approved economics. Assign only verified beneficiary addresses. [Frozen input schema and closeout](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK041_RELEASE_CLOSEOUT.md)
3. **Qualify production observations.** Require dependable archive receipts and native settlement traces, independent Ethereum L1 finality, durable new-engine indexer checkpoints with backup and restore, read authentication, exact full-PoolKey routing and physical-wallet recovery. Keep credentials server-side. When evidence is absent, retain explicit pending or stale states.
4. **Keep separate approvals.** Operations Safe #1, Reserve Safe, protocol deployment, owner website token creation, controlled acceptance and public trading each require their own scope, cost cap and authorization. The Operations policy and 0.00001567739478 ETH fee ceiling are approved. Its transaction authorization remains unassigned. [Scoped Safe policy](evidence/mobile-signing/OPERATIONS_SAFE_RELEASE.md)
5. **Finish infrastructure before token creation.** The active unsigned package contains only treasury setup, five protocol constructors and four governance actions. Verify canonical deployments, Blockscout source and runtime matches, live new-engine indexing, L1 finality, routing capability and wallet recovery before proposing website creation approval. The owner then connects the existing MetaMask wallet and uses `/create-token` through the same factory and review flow as other projects. No project issuance belongs to the infrastructure deployment queue. [Final launch sequence](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/657#issuecomment-6951267519)

If a receipt, identity, nonce, cost or authorization differs, stop the affected step and recover the original transaction before refreshing dependent inputs. On a confirmed security or provider incident, keep the website read-only, preserve evidence and checkpoints, and use only the existing scoped governance suspension mechanism with its current authority. Existing claims and locked principal retain their protections. Contract deployment is irreversible. Website rollback and suspension cannot reverse a mined deployment or recover spent gas.

The owner approved candidate economics of 0.0004 ETH for creation, 2 ETH graduation backing, a 1% curve trading fee, a 0.30% v4 pool fee and a 90/5/5 eligible earned-fee allocation. Factory V2 fixes the 1B supply and the candidate preserves the 600M/400M allocation and permanent original LP custody. Live beneficiary addresses, funding and transaction approvals remain gated. [Owner-approved configuration and private review](evidence/mobile-signing/UNSIGNED_HANDOFF.md)

Run `pnpm test:release-policy` for the deterministic stage tests and `pnpm evaluate:release --evidence $stageEvidence` for bounded local decision support. Keep raw observations and approval records outside Git. Each decision binds the exact candidate and stage. Risk acceptance stays valid through quote refreshes while its candidate, findings, policy and cost limits match. Transaction approval binds the current nonce, calldata, fee fields and fresh evidence. The evaluator verifies source and evidence hashes, reports missing prerequisites, and always leaves execution disabled. Operator-supplied approval records require corroboration against their owner GitHub source before use.

[Mobile wallet review and rehearsal](evidence/mobile-signing/README.md) · [Current unsigned deployment and source-verification handoff](evidence/source-verification/launch-handoff.md) · [Production readiness probes](evidence/production-readiness/readiness.md)

## Historical operating evidence

Historical records retain their original source and checkpoint. The live [read-only discovery](https://www.rmtlaunch.fun) can serve verified historical records or a stale-labeled snapshot. Source history holds the [initial website verification](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_ROBINHOOD_CHAIN_DISCOVERY_REVIEW.md), [Railway recovery record](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_RAILWAY_RECOVERY.md) and [prior release handoff](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK047_RELEASE_HANDOFF.md).

[Repository cleanup and Task 049 handoff](evidence/repository-cleanup-048a.md)
