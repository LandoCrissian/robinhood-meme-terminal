# Deployment and operations

Operations Safe creation is complete on L2: transaction `0x7306d15f2ffcab498bd2063615ddaa862b6ff956415e39e4d278f75de84cdad6` created `0xAF9F10258b091719618c19D057F9cDAB72eFFd8b`. Official Robinhood and Pocket RPCs corroborated the canonical receipt, exact initializer, SafeL2 1.4.1 runtime, three approved owners, threshold 2, handler, empty modules and guard. Current configuration was rechecked at block `116767733`. Actual network cost was 0.00000620902221 ETH. Independent Ethereum L1 finality remains unverified. [Recorded verification](evidence/mobile-signing/operations-safe-mainnet.json)

Reserve creation is also complete on L2: transaction `0x3daa6a602b7b2f556c03e9ddf5c142b96111b4bbfd38345c8e1769d7b0611091`, block `116797634`, created `0x8D44078642ce938Fd799b23087BcdD6114A302e5`. Its exact initializer, SafeL2 1.4.1 runtime and configuration passed. Both treasuries' canonical and pending state matched on official/Pocket providers at block `116800797`: the approved three owners, threshold 2, nonce 0, correct singleton/handler, no modules or guard. Reserve's actual network cost was 0.00000613063629 ETH. [Both verified treasuries](evidence/mobile-signing/treasuries-mainnet.json)

All five protocol constructors are complete on L2. Official/Pocket canonical receipts, the original CREATE inputs, archive/current runtime hashes, Directory/Registry bindings and all three bootstrap child contracts passed verification. The unchanged compiler input SHA-256 is `66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10`. Total observed constructor network cost was **0.0004537192624 ETH**. No transaction created a project token. [Exact receipts, block identities, runtime hashes and costs](evidence/mobile-signing/protocol-mainnet.json)

| Contract | Verified deployed address |
| --- | --- |
| Directory V2 | `0xE677A69A8124714DD0d88b73BDf1B89cc791ca9C` |
| Registry V3 | `0xf1113714Dda31f31532995D2525e034271425398` |
| Successor V2 deployer | `0xcB25a3DF74729F7104C4f924Cb04F687F69391C6` |
| Successor V3 deployer | `0x622D2f878B328406861DA18F4BBdD27E4730Cb65` |
| Bootstrap | `0xb65380aE9A452813c4e6b0fF391cfE34faE676A5` |
| Initialization guard | `0x998F3C0CE20cFF92655D495a159B1Ca37c162000` |
| Graduation engine | `0x10e540536F10ed36E5fC6638638f1d862e552D32` |
| Factory V2 | `0x7281e1F9D8764Ae6533b374DFd08AB2ECbC273c3` |

Blockscout full source correspondence was observed for Directory, Registry and the V2-successor deployer. Publication of the V3 successor, bootstrap and its three children remains pending after verification POSTs returned HTTP 429. Requests stopped rather than bypassing that limit. Independently reproduced compiler/runtime correspondence covers all eight addresses; it does not replace explorer publication or an audit. Preserve the explorer's legacy job failures separately from canonical full-verification metadata. Independent Ethereum L1 finality remains unverified.

The original [Directory deployment page](https://owner-protocol-066--rmt-wallet-check-056-f911548d.netlify.app/protocol-deployment.html) and the four dependent constructor pages remain recovery artifacts. **Do not deploy them again or regenerate the initial packet against a new starting nonce.** Keep the immutable [original queue and exact hashes](evidence/mobile-signing/protocol-owner-plan.json), which record predictions before their receipts, and reconcile each actual hash against that same packet.

The [governance authorization page](https://owner-governance-066--rmt-wallet-check-056-f911548d.netlify.app/governance-factory.html) collects two explicit EIP-712 signatures from the approved Rabby governance EOAs. It requests no gas payment or transaction. Signatures bind chain 4663, this Directory, epoch 1, governance nonce 0, the exact factory/runtime and a bounded deadline. They stay encrypted on the device until the owner downloads the authorization for cryptographic operator verification. These signatures authorize a later schedule call; the **two-day clock starts only at its canonical transaction block**. The owner then separately approves that MetaMask transaction and its current costs. Execution cannot occur before the real notice. The Directory has one pending-action slot, so V3-template scheduling follows factory execution and has its own two-day notice. [Hosted checks and exact action digest](evidence/mobile-signing/governance-signing-host.json)

The earlier [Operations page](https://owner-deployment-064--rmt-wallet-check-056-f911548d.netlify.app/owner-deployment.html) and [Reserve page](https://owner-reserve-065--rmt-wallet-check-056-f911548d.netlify.app/reserve-deployment.html) remain available for their original recovery journals; occupied destinations prevent repeat creation. Access credentials stay outside Git. Sessions persist through reload without a short login expiry. Each signature, broadcast and approval of current network costs belongs to the owner. Requests are stored before the wallet prompt, with no automatic resubmission.

`pnpm probe:directory-constructor --packet <private-packet> --output <fresh-private-observation> --runtime-output <fresh-runtime-file>` checks the exact first CREATE through bounded public reads. `pnpm export:owner-protocol --url <exact-HTTPS-path> --packet <private-packet> --runtimes <runtime-pins> --directory-runtime <materialized-runtime> --output <private-html> --key-file <separate-private-file>` prepares its encrypted page. The committed browser fixture is explicitly test-only and rejected by the signing exporter.

After the owner confirms, use `pnpm verify:protocol-receipt --packet <private-packet> --id directory --hash <owner-hash> --output <fresh-private-proof>`. It binds both providers' exact transaction/receipt, the expected CREATE address, original constructor bytes, archive and current runtimes, initial governance state and canonical headers. Missing evidence stays pending; disagreement fails closed. Each later constructor retains its own dependent receipt, current simulation, fee review and signature. Blockscout submission uses the same Standard JSON input SHA-256 `66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10` only after canonical deployment verification; no verification is claimed from an undeployed prediction. The automated explorer configuration GET returned HTTP 403 during this preparation, separately from successful chain RPC checks.

`pnpm watch:reserve-receipt --from-block <recent-decimal-block> --seconds 300 --output <fresh-private-file>` observes the exact factory and Reserve event through bounded reads on two providers, then invokes the canonical Safe receipt verifier. Missing or conflicting evidence never advances the stage. This explicitly started observer is bounded, not a hosted background service. The owner can also supply the original hash directly for recovery.

Receipt-block Safe state is read through Pocket's archive access and independently corroborated against the official provider's canonical receipt and header. The official provider returned `historical state ... is not available` for the Operations receipt after initial verification; fresh archive verification succeeded through Pocket. Current treasury configuration is still checked on both providers. Preserved reports never replace a failed required archive read.

`pnpm prepare:protocol-continuation --solc <pinned-solc> --lib <pinned-lib> --reserve-hash <confirmed-hash> --output <fresh-private-file>` was the initial preparation command after both Safe receipts. It checks the then-current nonce and five vacant CREATE destinations. **It is not a continuation command after any constructor has been submitted.** Later pages and verifiers consume the original packet and predecessor receipts, preserving its exact nonce/address sequence. Governance preparation consumes all five verified receipts and observes the deployed Directory's current epoch, action nonce and deadlines; both real two-day notices remain enforced. The package contains no token issuance.

After each owner transaction, verify the exact canonical receipt with the existing `verifySafeCreation` or deployment verifier before preparing the next dependent transaction. Use the checksum-pinned transformed 4663 compiler input for protocol constructors. The Directory enforces its real two-day factory-publication notice. The separate migration-template admission has its own notice. No deployment transaction creates the RMT token.

The production registration adapter is now active in the existing Railway process, sharing its writer lease and read authentication. Deployment `b48f0e6e-a34b-4a26-b95f-d4b978562282` runs the exact committed worker source `1ba67b6fdb1ebfe927876893e0fc086d7fab939a`; 36 hosted source/configuration/lock files matched. The factory/registry binding uses the actual canonical bootstrap receipt and materialized runtime identities. A PostgreSQL 18.6 custom backup was encrypted outside Railway and successfully restored into an isolated local instance before the three namespaced tables were installed. Original records and the volume were preserved. Runtime performs no schema DDL. The backup is owner-local; an off-device recovery copy is not yet verified.

The first startup preserved a checkpoint but exceeded its health window during catch-up. The same built image resumed that durable checkpoint and became ready; exactly one writer held the lease. Authenticated new-engine reads returned an empty verified feed, with checkpoint `116857179` at the recorded observation. Missing/invalid credentials returned 401, POST returned 405, malformed queries returned 400, and the existing bounded concurrency/rate control returned 429 with Retry-After. Historical ingestion and the website's separate four-record feed resumed. During the controlled worker interruption the unchanged website served its stale-labeled snapshot. [Backup, recovery, exact deployment, API and billing evidence](evidence/production-readiness/task066-backend-activation.json)

Railway remains on Free, with approximately **$0.33125** usage credit and 51% volume use at the observation. No plans, services, top-ups or spending settings were changed. Continuous operation within the remaining Free allowance is not guaranteed; retain snapshot fallback. Removed-image rollback was available for the original deployment at observation, subject to Railway Free's 24-hour retention. Recheck availability before rollback. Temporary operator SSH access was revoked after verification. The existing GitHub `main` integration remains configured, so a later qualifying push can replace this manual archive deployment; coordinate any future source change explicitly.

The adapter exposes L2 observations with explicitly unverified L1 finality and separate payment/refund evidence. Source correspondence, explorer publication, live finality, full lifecycle ingestion and frontend execution approval remain separate acceptance boundaries. Never interpret an empty or unavailable new-engine feed as a historical token migration, and never substitute historical registrations for new factory creations.

## Environments

| Environment | Purpose |
| --- | --- |
| Netlify production | Read-only launchpad and historical discovery. The existing website and domain remain in service. |
| Railway and PostgreSQL | Active historical and separately scoped new-engine registration ingestion, authenticated read API, original persistent volume and one writer. Keep stale-labeled snapshot fallback and Free-allowance limitations. |
| Local Anvil 31337 | Synthetic wallet, website and PostgreSQL integration, with separate fixture configuration. |
| Local Robinhood 4663 fork | Synthetic review of the named compiler profile against official on-fork Uniswap dependencies, governance and Safe behavior. Upstream traffic is read-only. |

The original `rmt-curve-fixed-supply-security-v2` compiler manifest retains its preparation-time **BLOCKED_NO_BROADCAST** field and unresolved scanner gate. It pins compiler inputs, source transformations, external contract runtimes and bytecode templates; it is not a mutable record of completed owner-approved transactions. Actual production state is recorded in the receipt evidence above. Public website execution remains disabled. Foundry and the synthetic browser fixture retain their chain-31337 gate. The [current compiler manifest](evidence/fixed-supply-security/4663-profile.json) is separate from the [frozen 4663 evidence](evidence/rmt-task043/4663-rotation-profile.json). No security result is cleared by deployment or source verification.

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
4. **Keep separate approvals.** Both Safes are verified on L2. Each protocol transaction, owner website token creation, controlled acceptance and public trading retain their own scope and owner authorization. Tasks 064–066 authorize live wallet cost review; the earlier fixed Operations quote is historical evidence. No background code signs or broadcasts. [Scoped historical Safe policy](evidence/mobile-signing/OPERATIONS_SAFE_RELEASE.md)
5. **Finish infrastructure before token creation.** The active unsigned package contains only treasury setup, five protocol constructors and four governance actions. Verify canonical deployments, Blockscout source and runtime matches, live new-engine indexing, L1 finality, routing capability and wallet recovery before proposing website creation approval. The owner then connects the existing MetaMask wallet and uses `/create-token` through the same factory and review flow as other projects. No project issuance belongs to the infrastructure deployment queue. [Final launch sequence](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/657#issuecomment-6951267519)

If a receipt, identity, nonce, cost or authorization differs, stop the affected step and recover the original transaction before refreshing dependent inputs. On a confirmed security or provider incident, keep the website read-only, preserve evidence and checkpoints, and use only the existing scoped governance suspension mechanism with its current authority. Existing claims and locked principal retain their protections. Contract deployment is irreversible. Website rollback and suspension cannot reverse a mined deployment or recover spent gas.

The owner approved candidate economics of 0.0004 ETH for creation, 2 ETH graduation backing, a 1% curve trading fee, a 0.30% v4 pool fee and a 90/5/5 eligible earned-fee allocation. Factory V2 fixes the 1B supply and the candidate preserves the 600M/400M allocation and permanent original LP custody. Live beneficiary addresses, funding and transaction approvals remain gated. [Owner-approved configuration and private review](evidence/mobile-signing/UNSIGNED_HANDOFF.md)

Run `pnpm test:release-policy` for the deterministic stage tests and `pnpm evaluate:release --evidence $stageEvidence` for bounded local decision support. Keep raw observations and approval records outside Git. Each decision binds the exact candidate and stage. Risk acceptance stays valid through quote refreshes while its candidate, findings, policy and cost limits match. Transaction approval binds the current nonce, calldata, fee fields and fresh evidence. The evaluator verifies source and evidence hashes, reports missing prerequisites, and always leaves execution disabled. Operator-supplied approval records require corroboration against their owner GitHub source before use.

[Mobile wallet review and rehearsal](evidence/mobile-signing/README.md) · [Current unsigned deployment and source-verification handoff](evidence/source-verification/launch-handoff.md) · [Production readiness probes](evidence/production-readiness/readiness.md)

## Historical operating evidence

Historical records retain their original source and checkpoint. The live [read-only discovery](https://www.rmtlaunch.fun) can serve verified historical records or a stale-labeled snapshot. Source history holds the [initial website verification](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_ROBINHOOD_CHAIN_DISCOVERY_REVIEW.md), [Railway recovery record](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_RAILWAY_RECOVERY.md) and [prior release handoff](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK047_RELEASE_HANDOFF.md).

[Repository cleanup and Task 049 handoff](evidence/repository-cleanup-048a.md)
