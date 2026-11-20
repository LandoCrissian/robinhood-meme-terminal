# RMT core launch go/no-go — Task 089

**Decision: NO-GO for production financial activation. The read-only website candidate is ready for owner review, not approved for deployment. BLOCKED_NO_BROADCAST.**

This review starts at [Task 088 defensive commit `78a76feb592ac136dbf74d4823c21db64a6d0313`](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/683), above website repair #682 `be44e7eaee34d2cdfad07cef736068ba008b9fd9` and #681 `62548d68cbdba8b206965fbbd238261a0b1d2af7`. [Task 089 owner instructions](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/683#issuecomment-7041515812) govern this separate draft stack. [Verified starting heads and historical CI](evidence/rmt-task089/source-baseline.json) are retained; they do not substitute for candidate CI.

No merge, deployment, production configuration/credential/schema change, live signing, gas payment, production governance execution/cancellation, production RMT creation or financial activation occurred. All chain writes and signatures in the acceptance tests use isolated synthetic accounts on loopback chain 31337. Optional NFT, Reclaim, buyback and treasury feature development was not reopened.

## Owner decision by stage

| Stage | Decision now | Required next evidence or approval |
| --- | --- | --- |
| Read-only website code and diagnostic candidate | **READY FOR REVIEW; deployment NOT APPROVED** | Exact Linux artifact/source identity, private server credential continuity, explicit owner website-only deployment approval and correlated hosted acceptance. |
| Current deployed discovery | **NO-GO as proof of fresh discovery** | Production still serves the old snapshot; its initiating fallback trigger is unknown. Do not describe #682 or this candidate as deployed. |
| Factory publication | **NO-GO for action in this task** | Explicit owner decision on the already-pending permissionless action, current authority/runtime/notice and applicable release policy. Publication admits direct creation; website OFF flags do not contain that exposure. |
| First-owner website creation | **NO-GO** | Separate owner authorization, accepted live infrastructure/security/operational prerequisites, exact account/delegation and transaction evidence. Synthetic success is not permission to create RMT. |
| General EOA / Safe / delegated creation release | **NO-GO; capabilities differ** | The existing production first-owner path is narrowly account/runtime bound. Safe website CREATE is unsupported; Safe beneficiary claims are a separate tested capability. |
| Curve trading | **NO-GO for production enablement** | Whole-stage acceptance and owner approval. The narrow arithmetic disproof is not whole-protocol clearance; active curves expose subsequent permissionless paths. |
| Graduation / atomic buyAndGraduate | **HOLD — 11 unresolved stateful findings** | Complete exact dependency/callback/settlement and original-position conservation/custody proof. |
| LP harvest / new earned-fee credits | **HOLD — one unresolved stateful finding** | Exact original-position fee collection/accounting proof. Existing beneficiary entitlements are preserved. |
| Funded migration | **HOLD — six unresolved stateful findings** | Exact adjacent successor/callback/accounting proof, current governance/creator consent and separate registry Medium/future-template review. |
| Public v4 routing and financial release | **NO-GO** | Current manager/router/quoter/source-runtime/provider/finality evidence, wallet recovery and separate owner authorization. |

An external audit remains optional under the existing owner policy. This review invents no audit requirement and grants no exception for an unresolved plausible material loss path. The raw 22-High scanner gate and seven separate governance Medium observations remain visible.

## Discovery: established mechanism, unknown initiating failure

At **2026-11-20 14:08 UTC**, Netlify still returned `verified-snapshot / stale` at historical block **113899119**, while Railway health reported historical checkpoint **119107514**, latest **119107534** and ready/caught-up new-engine checkpoint **119107193**. They are independent read models: advancing the worker does not refresh a checked-in snapshot or enable a gated website reader.

The published Netlify deployment remains `6afd4265956a469adeb55747`; its server ZIP digest matches the retained reviewed Task071 artifact. Railway remains on `b48f0e6e-a34b-4a26-b95f-d4b978562282`. The ordinary website request actually invoked the server function, then returned the old snapshot with stale/store durable-cache metadata. Therefore cache reuse is a contributor, not a demonstrated sole cause. The old reviewed reader silently selects historical fallback after unsuccessful live reads, and its API allows that snapshot into durable caching.

**The exact initiating live cause is UNKNOWN.** Frozen function configuration, missing/wrong credential, endpoint/transport, authentication, schema or merge rejection are not distinguished by available logs. Current empty site-variable lists and absent targeted team keys do not prove the environment frozen into the published Lambda. The normal new-engine route returns 404 before the authenticated read in the reviewed implementation when profile/fixture/request-authority gates reject; that does not establish an upstream 401. The bounded Railway log window showed only the normal health request; absence of a protected path does not prove why.

No credential was retrieved, manually replayed, exposed or replaced. No internal route, access restriction or rate limit was bypassed. The exact remaining investigation boundary is a separately approved diagnostic-code/configuration deployment. [Sanitized requests, provider identity, hypotheses and limits](evidence/rmt-task089/discovery/README.md) retain each observation.

Task 088 already repairs reproduced stale caching, post-await freshness/skew, strict checkpoint/schema identity and historical receipt continuity. This candidate adds only missing **server-only fixed gate categories** `profile_disabled`, `fixture_active`, `authority_rejected` and forwards the existing diagnostic callback. It preserves the same profile/fixture/authority predicate, bearer authentication, HTTPS origin admission, redirect/body limits and public 404/503/no-store responses. Categories include no values, URLs, bodies, credentials or exception text and share the existing one-per-minute log budget. Three failing tests were retained before correction; all **47 focused tests and 327 website tests** pass afterward, with zero failures/skips.

## Minimum production rollout proposal — approval still required

The smallest permitted next owner decision is: **approve only the reviewed read-only diagnostic website rollout, or keep production unchanged.** Financial approval is a separate decision.

1. Bind the exact final PR head and Linux server/static/edge artifact digests from its CI evidence. Preserve the current deploy, source and private configuration record. Do not publish a dirty tree or assume the existing manual artifact includes this code.
2. If approved, a diagnostic-only publication preserves currently intended OFF financial/profile/fixture settings and adds no Railway or database change. If legitimate private operator review already establishes correct server configuration, one atomic reviewed code/configuration publication may suffice; otherwise diagnose first and seek approval for the particular configuration correction afterward.
3. Fresh **read discovery only** needs these three keys bound to **Netlify Functions scope / production deploy context**: `RMT_LAUNCH_HISTORY_INDEXER_URL` (existing approved HTTPS worker origin), `RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN` (private continuity with existing worker `RMT_INDEXER_READ_TOKEN`) and `RMT_CURVE_PRODUCTION_DISCOVERY=rmt-curve-fixed-supply-security-v2-4663-task066`. The shorter `rmt-curve-fixed-supply-security-v2` identifies the worker response format, not website activation. Values freeze per deployment. Do not invent/rotate a credential, put it in Git/client output/NEXT_PUBLIC/logs or remove authentication. Stop if private continuity cannot be established.
4. Keep `RMT_CURVE_PRODUCTION_EXECUTION`, `RMT_CURVE_PRODUCTION_PREPARATION`, financial release attestations, Firebase profile activation and fixture/emulator flags OFF/unset. Preserve the normal automatic-production-build guard; a separately approved verified prebuilt publication does not require removing it. No new worker, database, paid service, DNS change, schema installation or original-volume access is needed.
5. After that separate approval, correlate ordinary canonical-origin historical/new-engine GETs and public health, Netlify request IDs, a tight UTC window and the corresponding Railway path/status. Allow for the shared one-minute diagnostic budget and concurrent traffic. Missing log output proves nothing; do not flood requests or inject auth/outage failures into production.
6. Accept read-only cutover only after authenticated/schema/pin-valid fresh data, checkpoint age below 120 seconds, correct exact creation identity and separate historical/new-engine provenance are observed. A genuinely current empty feed may be empty; stale or unavailable absence cannot be advertised as current. Historical snapshots remain no-store; stale new-engine data returns 503. All transaction routes remain closed.
7. A gate mismatch, 401/403, schema/pin conflict, stale checkpoint, credential leak or unexplained continuity failure is NO-GO. Preserve the failed evidence. For an approved website regression, prepare a **fix-forward source revert/rebuild** of the preserved approved read-only source/configuration, retest and obtain separate publication approval. Do not restore/publish an older deployment automatically, alter DNS/data, restore the original volume, replay transactions or treat a website flag as reversal of a mined action.

[Detailed rollout and acceptance plan](evidence/rmt-task089/discovery/README.md) includes the exact categories, negative tests and failure boundaries. No phase of this proposal is owner-approved or executed merely because it appears in this document.

## All 22 core findings

**Disposition: zero confirmed exploits established by this bounded review; four reported expressions independently disproven at exact immutable source pins; 18 stateful findings unresolved.** “Unresolved” identifies an evidence limit, not a demonstrated exploit. Passing 112 tests, a runtime pin or earlier internal false-positive metadata is not clearance.

The unchanged retained 66-source 4663 input is `66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10`. All **101 detectors / 233 observations / 22 raw Highs / raw strict exit 1** remain. [Full per-ID matrix](evidence/rmt-task089/security/stage-dispositions.json) binds every complete ID, detector, exact source/function/line, guard, counterfactual, stage, proof/limitation and required closure. Unique ID prefixes below resolve to that matrix.

| ID | Reported function / call | First affected stage | Disposition |
| --- | --- | --- | --- |
| `090ec24d83d9` | `_fundPosition`: PositionManager.modifyLiquidities | graduation | Unresolved |
| `096666f0be36` | `_fundPosition`: asset.approve(Permit2) | graduation | Unresolved |
| `1dd97f6a638a` | `_fundPosition`: PositionManager.modifyLiquidities | graduation | Unresolved |
| `1e179df9a2b6` | `_fundPosition`: asset.safeTransferFrom | graduation | Unresolved |
| `6e56005d266c` | `_fundPosition`: asset.safeTransferFrom | graduation | Unresolved |
| `aed981db86d8` | `_fundPosition`: Permit2.approve | graduation | Unresolved |
| `cbb7601e1d47` | `_fundPosition`: asset.approve(Permit2) | graduation | Unresolved |
| `f02be6651ef2` | `_fundPosition`: Permit2.approve | graduation | Unresolved |
| `c161ac1c6b54` | `_graduate`: _approveGraduation(0) | graduation | Unresolved |
| `fae53a948b42` | `_graduate`: _approveGraduation(inventory) | graduation | Unresolved |
| `fe593a6c4b17` | `_graduate`: graduationEngine.graduate{value:backing} | graduation | Unresolved |
| `c7bf2ac4fa4f` | `collectLpFees`: PositionManager.modifyLiquidities | lp_harvest | Unresolved |
| `04dd86035f4e` | `migrateAssets`: revenueLedger.moveAccrual(nextCurve) | asset_bearing_migration | Unresolved |
| `1fdf2b7ea9c9` | `migrateAssets`: token.safeTransfer(nextCurve,inventory) | asset_bearing_migration | Unresolved |
| `7f0d82532758` | `migrateAssets`: next.acceptMigration{value:backing} | asset_bearing_migration | Unresolved |
| `be7b3e4ab448` | `migrateAssets`: next.acceptMigration{value:backing} | asset_bearing_migration | Unresolved |
| `c87c792deb6a` | `migrateAssets`: token.safeTransfer(nextCurve,inventory) | asset_bearing_migration | Unresolved |
| `d7b62a52dbdc` | `migrateAssets`: revenueLedger.moveAccrual(nextCurve) | asset_bearing_migration | Unresolved |
| `a6cd96c3ca39` | `mulDiv`: No external call: deliberate XOR inverse seed | graduation | Reported expression independently disproven |
| `ae18440210b5` | `mulDiv`: No external call: deliberate XOR inverse seed | curve_trading_and_curve_fee_accrual | Reported expression independently disproven |
| `51cdba984170` | `mostSignificantBit`: No external call: Yul packed shift lookup | external_v4_pool_initialization_or_trading | Reported expression independently disproven |
| `f8a4b705f57b` | `leastSignificantBit`: No external call: Yul packed shift lookup | external_v4_trading | Reported expression independently disproven |

The four new disproofs concern the reported mistakes only: exact parsed BitMath MSB partitions cover every nonzero uint256, LSB isolation has a complete 256-bit SMT proof plus all 256 exact source tails, and each deliberate XOR inverse seed has an all-residue seed proof plus six exact Newton refinements. They do not prove all dependency behavior, compiler correctness, current deployed correspondence, complete trading or finality. **27 proof/provenance/tamper tests pass**. [Proofs, pinned solver and commands](evidence/rmt-task089/security/README.md)

No necessary versioned Solidity correction was established, so no deployed or candidate Solidity/economic patch is proposed to silence warnings. Existing finite-approval, guarded-settlement, custody, migration-route and ledger protections remain. The original Task 088 evidence verifier is preserved and passes on its immutable starting checkout; it intentionally rejects a changed compiler-helper hash at Task 089. The new stage verifier binds unchanged Solidity, exact input and fresh proofs without rewriting that historical assertion.

## Creator journey, economics and recovery

Before the isolated provider paused, directly observed results were **327 website tests; six compiler-helper tests; nine final quiescence-helper tests; 21 authenticated HTTP checks and 30 discovery browser cases; 15 PostgreSQL backup/restore checks; and actual wallet-profile runs in both browsers** (each 32 core/35 total receipts, nine reviews and three layouts). The final named-source full lifecycle completed **Chromium mobile only** before the pause: creation/receipt/fresh fixture discovery, curve/v4, claims, two successor migrations, recovery/restart/reorg and zero page errors. Final Chromium desktop and fresh WebKit mobile/desktop outcomes remain unverified. Earlier passes and failed instrumentation attempts do not establish the final four-layout matrix.

**Original journey reports, screenshots, backup archive and complete failure logs were not exported before the quota restriction.** These counts are recorded observations, with selected recovered provider log excerpts, rather than a committed replayable original evidence set. Fresh final-head CI and immutable artifacts are pending. [Exact source hashes, observed counts, failed-attempt provenance and unavailable artifacts](evidence/rmt-task089/journey/README.md)

Actual chain-31337 receipts were indexed through the same app's fixture namespace. The authenticated production adapter used separate synthetic 4663-shaped registrations; no actual-receipt-to-production-namespace continuity witness is claimed. Actual delegated-EOA type-2 creation/claims and official Safe 2-of-3 beneficiary claims are distinct from the deliberately reverting synthetic mobile-review delegate. Website Safe outer CREATE remains unsupported. Production preparation still requires the exact first owner, existing designator/runtime and independent release gates; generic synthetic EOA tests grant no broader production account support.

The unchanged WebKit empty-page-error assertion exposed a `Load failed` during a test navigation/RSC race. Final harness synchronization waits only for already-pending same-token requests to terminate; failed requests retain their failed diagnostics. Authentication, freshness, original receipt, accounting, URL/heading, lost-hash/restart/reorg and page-error assertions remain unchanged. The provider auto-paused at **2026-11-20 15:20:11 UTC** after its five CPU-hour limit; remaining lifecycle cleanup is unconfirmed. No quota bypass, upgrade or production action was attempted.

The fixed terms remain **0.0004 ETH creation fee, 1 billion tokens with 18 decimals, 600M curve / 400M original LP, 90/5/5 eligible earned fees, 1% curve fee and 2 ETH graduation backing**. Original v4 LP principal remains locked. The 31337 rehearsal executes the production-economic profile; it is separate from the unchanged untransformed 1 ETH Foundry test profile and from production chain execution.

Compiler portability is explicit, not a different compiler: native digests/assertions remain, ARM tests execute the exact pinned x64 solc through a separately pinned QEMU binary, and the 4663 input is byte-identical to the retained input. The cache is opt-in private local test output with complete input/compiler/executor binding, POSIX ownership/privacy and symlink checks and failure/tamper rejection; it is not an attestation against a malicious writer of that same private directory. No production cache/flag is enabled.

The recovery proof uses a fresh synthetic database and fresh restore destination; it does not restore or query the original Railway database. A writer “lease” here is a **PostgreSQL session advisory lock, without TTL/renewal**, namespace 1380805961 / chain ID. Startup acquires it on the dedicated writer connection. Source correspondence and advancing health support an inference of normal startup; current production `pg_locks` ownership is not directly established. Session locks are reacquired after a process restart rather than restored from a dump.

Retained Task066 evidence describes an owner-local encrypted backup and isolated restore from November 17. Current backup age/readability, an accessible off-device copy and recovery key, operator/RPO/retention, and direct current production writer ownership remain unverified. The connector does not expose the necessary backup inventory or current lock owner. No production SQL session, volume fork, backup operation, worker restart or credential access was used to fill this gap.

## Current governance and permissionless publication risk

The fresh bounded official/Pocket observation at **2026-11-20T15:29:56Z**, canonical block **119156285**, hash `0x662f93ed2b0d8b6d8ed63ba52ccd37f916564494031a2fd3ef292d73cb3c9f8a`, found the original action **PENDING_TIME_ELIGIBLE**. Both witnesses corroborated the original Schedule receipt and event, pending digest, nonce 0, signer epoch 1 and unchanged signer identities. Directory/factory runtime pins matched; latestVersion remained 0 with no published/current factory. The original action was still pending rather than executed or canceled at that anchor.

The real notice completed **November 19 at 23:32:28 UTC**. The inclusive expiry remains **November 26 at 19:50:06 UTC / 12:50:06 PM MST**; **534010 seconds** remained at this observation. Permissionless publication risk persisted. This is a dated observation, not a guarantee of subsequent state.

Exactly **42 public RPC reads** were made, 21 per witness: chain/block/code reads, the exact original Schedule receipt and enumerated view getters. No execution/cancellation selector, simulation, gas estimate, transaction input, transaction preparation, signing or broadcast was used. **Five offline tests passed**, binding raw responses, source/runtime pins, Schedule canonicality, state/window and recovery provenance. The initial 14:08 capture is preserved separately; the fresh capture ran locally with Node 22.23.2 and pinned viem after four path-only producer adaptations, with no Upstash execution or Python.

Directory Publish changes the factory pin/version and clears pending/increments action nonce. It creates no token and transfers no launch funds, but it admits that factory through registry registration and thus access to active curve operations. **Website OFF flags cannot prevent third-party execution or direct contract use.** The Publish branch does not require a new signature or privileged caller. Suspension is not its execution predicate; registration separately rejects a suspended directory.

All observations are dated and bounded. L2 provider agreement does not establish Ethereum L1 finality, and no execute/cancel simulation, gas estimation, transaction input retrieval, transaction construction, signing or broadcast occurred. [Raw public reads, exact Schedule receipt, source bindings and offline tests](evidence/rmt-task089/governance/README.md)

## Validation and CI

The retained local observations below precede PR CI and are not exact-head hosted results. Gzipped primary logs are in [validation](evidence/rmt-task089/validation/); detailed discovery and security captures have their own manifests. Journey raw reports were not exported before the compute pause, so those observations require fresh CI corroboration.

| Check | Local observed result and evidence limit |
| --- | --- |
| Website history/regressions and focused authenticated reader | 327/327 website tests on Linux and recovered Windows source; 47 focused tests; three diagnostic tests failed before the correction. Retained logs. |
| Offline security expressions/provenance/tamper | 27 passing tests and complete 22-ID source-bound verifier; fresh CPython 3.12 execution pending CI. |
| Native/emulated compiler helper | Six tests and real pinned-compiler smoke passed on Linux before pause. Recovered Windows run: five pass, one fails at OS-denied symlink creation; assertion retained. |
| Lifecycle terminal-read draining | Nine passing tests and whole-harness syntax check on the recovered source; pending/failed requests remain distinct. This helper does not verify data freshness. |
| Isolated authenticated adapter | Observed 21 HTTP / 30 browser cases, two 401 negatives and 44 authorized reads; raw journey output unavailable after pause. Fresh CI required. |
| Isolated PostgreSQL backup/restore | Observed 15 checks, real restart, session-lock reacquisition and reorg replay; synthetic drill cleanup completed. Dump/raw report unavailable after pause; CI repeats the drill. |
| Same-app lifecycle / wallet profiles | Final Chromium mobile pass observed; other final layouts unverified at pause. Both genuine delegated/Safe wallet profiles passed before pause, raw output unavailable. CI replays all four creator layouts and existing profile jobs. |
| Stage policy / production readiness | 20 policy tests and 72 readiness tests pass; dated Linux logs and recovered-source Windows 92-test pass retained. |
| Both application typechecks / Knip | Pass; two unchanged historical Knip hints retained. |
| Current governance | Five fresh-capture offline evidence tests; initial four-test capture also preserved. Exact timestamps and limits above. |

At **2026-11-20T15:20:11Z**, Upstash paused the three isolated sandboxes at the account's monthly **5 CPU-hour** cap. Subsequent execution returned HTTP 403: `Monthly compute limit reached (5 CPU-hours). Please upgrade your plan by adding a payment method.` No upgrade, billing change, resume or alternative box execution was attempted. A pre-pause local source snapshot and final verified source packets recovered this candidate. In-flight lifecycle cleanup and unexported filesystem artifacts remain unconfirmed; completed backup-drill cleanup is a separate observation. Fresh tests use the public repository's ordinary existing GitHub-hosted Linux CI, with no paid/larger runner provisioned.

The focused `Core launch go-no-go evidence` workflow independently replays source-bound dispositions/proofs, offline governance/discovery evidence, pinned compiler execution/cache tests and the real isolated backup/restore procedure. Existing security workflows are unchanged: a failing raw scanner gate remains failed. Optional Seaport's earlier 8-second loopback Anvil timeout, original failure and one retry are retained in Task 088's PR/artifacts and local CI audit. A public-upstream cause was never proven; optional flakiness is not a core financial clearance or a reason to relax a check.

Use the exact final PR-head check results and immutable artifact links/digests in the PR body. They are recorded after CI finishes; historical starting-head CI and local worktree tests are identified separately. A green evidence job proves its bounded checks, not a financial release.

## Separate remaining blockers and next owner decision

- **Production handoff:** frozen reader configuration/initiating fallback cause and the corrected hosted authenticated path are unverified; a diagnostic/configuration publication needs separate owner approval.
- **Security:** 18 stateful High findings and seven governance Medium observations retain their exact stage/dependency limits; four expression disproofs do not clear the strict gate or entire contracts.
- **Operational recovery:** current production writer-owner proof, fresh encrypted backup availability/readability, off-device copy/key/operator and recovery objectives remain unverified. Historical Free-plan credit/volume figures are not a current capacity guarantee; no upgrade/top-up is authorized.
- **Physical iPhone/provider:** synthetic Chromium/WebKit does not establish actual Safari, MetaMask, Rabby or Safe phone recovery/approval behavior. Wallet capability restrictions and current provider/archive/router/quoter/runtime correspondence remain distinct.
- **Finality/source publication:** independent Ethereum L1 finality and any still-unverified current explorer/dependency correspondence remain separate; retained earlier receipts/source evidence is not a fresh observation.
- **Governance/financial authority:** the owner must separately decide how to handle the pending publication before its inclusive expiry, recognizing that inaction and website flags cannot prevent a third party. This PR prepares no transaction and grants no publication, RMT issuance or trading authority.

**Next owner decision:** approve only the narrow read-only diagnostic website rollout plan (exact candidate/artifact plus private configuration continuity), or retain production unchanged. Keep factory action handling, first RMT creation, controlled financial acceptance and public trading as separate explicit decisions. The agent's release decision remains **NO-GO / BLOCKED_NO_BROADCAST**.
