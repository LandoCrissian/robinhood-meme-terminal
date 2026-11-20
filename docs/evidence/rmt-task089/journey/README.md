# Task 089 journey: observed results and recovery limits

**NO-GO / BLOCKED_NO_BROADCAST. Fresh final-head CI is pending.** This package records observations from the isolated Task 089 environment, recovered source identities and selected provider log excerpts. The original journey JSON reports, screenshots, database archive and complete failed-attempt logs were not exported before the provider paused the environment. They are not present in this PR and must not be treated as replayable committed evidence.

[Structured observations and exact source hashes](results-observed.json) distinguish those observations from [recovered control-plane log excerpts](recovered-log-excerpts.json). The latter preserve provider-returned text and its literal truncation marker; they are not copies of the original files. Six excerpts were recovered, including one truncated diagnostic prefix. Candidate CI must supply its own exact run, check, artifact and digest identities.

## Observed checks before the pause

The starting commit was `78a76feb592ac136dbf74d4823c21db64a6d0313` (#683), above website repair #682 `be44e7eaee34d2cdfad07cef736068ba008b9fd9`. Tests ran with changes in the working tree. The eight recovered final source files match the hashes in `results-observed.json`; this is not a claim that every earlier test executed those final bytes.

| Check | Directly observed result | Original journey-box raw output in this checkout |
| --- | --- | --- |
| Website `test:history` | 327 passed | Unavailable; fresh CI pending |
| App/indexer builds and typechecks | Passed | Unavailable; fresh CI pending |
| Pinned compiler helper | 6 tests passed; actual compiler smoke passed five checks | Unavailable; fresh CI pending |
| Final RSC quiescence helper | 9 tests passed; complete harness syntax check passed | Unavailable; fresh CI pending |
| Authenticated discovery adapter | 21 HTTP checks and 30 Chromium/WebKit cases passed; missing/wrong synthetic credentials returned 401; zero browser external/wallet requests | Unavailable; fresh CI pending |
| Isolated backup/restore | 15 checks passed on PostgreSQL 18.6; completed drill reported process/temporary-cluster cleanup | Unavailable; fresh CI pending |
| Actual wallet profiles | Chromium and WebKit passed; each had 32 core/35 total receipts, nine reviews, 11 core checks and three layouts | Unavailable; fresh CI pending |

The existing findings-register check also passed with 334 raw rows, 49 detailed records and 39 retained High findings. Its status remained `BLOCKED_NO_BROADCAST`; this check clears no security finding.

The table concerns the original journey environment. Separate retained primary logs and fresh recovered-source Windows website/typecheck/Knip/helper outputs are available in [validation](../validation/), and the discovery package retains its own 327-test output. Those files do not reconstruct the unavailable journey reports.

The final named harness/compiler hashes were recorded immediately before each fresh lifecycle invocation. Only this final result was observed before the pause:

| Browser | Layout | Final invocation result |
| --- | --- | --- |
| Chromium | Mobile | Pass observed, exit 0; 24 wallet broadcasts, 23 receipt observations plus creation, two successor migrations, empty browser-error/external-request arrays |
| Chromium | Desktop | Running or queued outcome unverified |
| WebKit | Mobile | Running or queued outcome unverified |
| WebKit | Desktop | Running or queued outcome unverified |

The mobile report was `/tmp/task089-quiescent-chromium-mobile/creation-journey-evidence.json`. It completed creation, canonical receipt, fresh fixture discovery, curve trading, actual 2 ETH graduation, locked v4 custody, swaps, fee collection/claims, successor migrations, recovery, restart and reorg checks. Printed report inspection and its exit-0 summary survive in the recovered log excerpts; the complete report does not. Earlier Chromium and WebKit passes, including an older WebKit desktop pass observed after the final helper change, do not establish a complete final four-layout matrix.

## Distinct data paths and wallet capabilities

The actual creator lifecycle was synthetic EOA creation on local chain 31337, through a real canonical local receipt, fixture worker/PostgreSQL namespace and the same Next app's fixture discovery. The authenticated production-adapter checks used separate synthetic 4663-shaped registrations, pinned configuration, the real production PostgreSQL adapter and synthetic authenticated HTTPS. There is **no asserted continuous actual-created-receipt-to-production-namespace witness**. No 31337 receipt was relabeled as 4663, and authentication was not weakened.

The actual wallet-profile runs exercised a genuine synthetic delegated EOA using the pinned MetaMask runtime `0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0` and type-2 local transactions, plus direct EOA creation/claims. Official Safe 1.4.1 coverage was two-of-three beneficiary claim execution and one-owner refusal. **Website Safe outer CREATE remains unsupported**; the factory ABI alone does not establish website support. The full creator flow's separate mobile-review subtest used a deliberately synthetic reverting delegate, not that MetaMask runtime. The later main-browser RSC branch is not used by `--profiles-only`; a separate complete per-run harness hash was not captured for those earlier profile runs.

Current production preparation remains restricted to first owner `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA`, its exact existing designator/runtime and separate release, owner, publication and discovery gates. Other accounts are refused before provider reads. Generic synthetic EOA creation and local delegated receipts do not approve generic production creation. Physical iPhone, actual MetaMask/Rabby/Safe connectivity and current independent-provider/finality acceptance remain unverified.

## Preserved terms and compiler

The executed local profile uses 0.0004 ETH creation, 1B tokens with 18 decimals, 600M curve/400M original LP, 90/5/5 eligible earned fees, 1% curve fee and **2 ETH graduation backing**. Original v4 LP principal remains locked. This is separate from the unchanged untransformed 1 ETH Foundry profile and from live chain execution.

The ARM64 host explicitly executed the existing pinned x64 solc 0.8.26 through pinned QEMU 7.2.22. Compiler SHA-256 was `d5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef`; QEMU was `ca7b4d72cb2a1a36dd63e31ae989ec909d4c4a711981bc318ae64ed191e96167`. Full generated 4663 Standard JSON matched the retained 66-source input byte for byte: `66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10`. The actually compiled/executed 31337 input was `437fb783d7dce558a05317e8b15877f6d08b9571bc12aefec360382469d53648`.

Native digests, source/input/profile assertions and native timeout remain. Emulation and the private current-user test cache require explicit selection. Cache identity includes complete input/compiler/executor/arguments; POSIX ownership/privacy, symlinks, output digest and compiler errors are checked. The helper does not assert Windows ACL privacy. It is not attestation against a malicious owner who replaces both private cached output and its manifest. Native release builds do not select it by default. The standalone `fixed-supply-profile.mjs` CLI does not accept emulator/cache flags; that ARM path is through the programmatic API or creator harness.

The harness used a private Anvil 31337 fork of public Base Sepolia block 57648300, hash `0x5bb29976ce80ddede79f192c61eba8fe9d96f499f8bfa11e0820d11820e91d20`, from `https://sepolia.base.org`. Upstream traffic was read-only; all synthetic signatures, transactions, balance/code installation and clock changes stayed on loopback. Reproduction depends on that exact archive state being available. Advanced local VM notice timestamps are not current production governance observations.

## Failed attempts and the final synchronization change

An initial orchestration attempt rebuilt `.next` concurrently and later lacked a production build at restart. An early WebKit attempt had a same-URL navigation interruption after graduation. A later WebKit mobile run failed the original, unchanged empty-page-errors assertion with `Load failed`. The recovered log retains that assertion. A bounded diagnostic prefix places React `reportError` at `10-reviewed-test-graduation`, `2026-11-20T14:37:37.288Z`; its full original JSON and screenshot are unavailable. Before the pause, inspection also observed a same-token RSC cancellation immediately before the harness's explicit navigation and subsequent successful v4 render. This supports a test-navigation race, not blanket product or network clearance, and not a proven public-upstream outage.

Experimental observers then imposed invalid prerequisites: all historical streams succeeding, a new refresh after each transaction, or a successful replacement for a request that had already terminated. Those could block valid full-document/missing-hash recovery and produced misleading confirmation timeouts despite a canonical approved receipt. An instrumentation duplicate binding also failed parsing before browser launch. These attempts are excluded from final browser acceptance; their complete logs and source archives stayed in the paused box and are not falsely represented as committed artifacts.

The final helper is **quiescence only**. Before existing controlled navigation/reload or repeated settlement actions, it snapshots already-pending same-token nonprefetch RSC requests and waits for each to terminate through either `requestfinished` or `requestfailed`. A failed row remains failed with its real HTTP/error diagnostics. There is no new-request, HTTP-success or successful-replacement prerequisite in this action barrier. All original authentication, data freshness, canonical receipt, accounting, URL, heading, lost-hash, restart, reorg and empty-page-error assertions remain independent and unchanged. No application TSX change, broad error filtering, retry or timeout increase was added for this diagnosis.

## Database recovery and current operational gaps

The backup drill generated its own loopback PostgreSQL cluster, synthetic credentials and two randomly named databases. Whole custom-format `pg_dump` preserved the source session, advisory lock and data; `pg_restore` targeted a new isolated destination. Fifteen checks covered a retained historical sentinel, logical row JSON equality, original creation/checkpoint continuity, separate writer exclusion, actual database-process restart, lock reacquisition, cursor advancement, restored reorg replay and unchanged source. **Logical row-byte equality is not physical database-page or WAL equality.** The observed 8,724-byte synthetic archive had SHA-256 `922b1d64f923a6f549c83494f4b027c91f48291e4a8c86a6ef2e519b07373362`; it is not exported in this checkout. No original Railway database, volume or backup was accessed.

The writer mechanism is a PostgreSQL **session advisory lock**, namespace 1380805961 / chain 4663, with no expiration or renewal timer. Session loss releases it. Relevant lock/startup/store spans were compared with deployed source `1ba67b6fdb1ebfe927876893e0fc086d7fab939a`; the candidate whole files differ. Git source is LF, whereas retained Task 066 hosted files are CRLF. Only an explicitly recorded LF-to-CRLF conversion reproduces their retained hosted digests; raw digest equality was not claimed.

Corresponding startup source and advancing checkpoints support an inference of successful initial acquisition/reuse. **Current production `pg_locks` ownership remains UNKNOWN.** Synthetic restore success does not establish a current readable encrypted production backup, usable off-device copy/key, operator, retention or RPO. The completed drill reported its own cleanup; cleanup of lifecycle processes still in flight when the sandbox paused is unconfirmed.

## Reproduction and quota boundary

Use Node 22, pnpm 10.12.1, pinned Foundry 1.7.1/solc 0.8.26, PostgreSQL 18.6 and Playwright 1.55.1; install frozen dependencies/pinned v4 sources and complete both builds before starting browser tests. On a native Linux CI runner:

```sh
node --test packages/contracts/scripts/pinned-solc.test.mjs
node --test scripts/visual-qa/lifecycle-rsc-observation.test.mjs
node packages/contracts/scripts/pinned-solc-smoke.mjs --solc "$SOLC"

pnpm --filter indexer exec tsx ../../scripts/discovery/backup-restore.mts \
  --pg-bin "$RMT_PG18_BIN" --output "$FRESH_OUTPUT"

node scripts/visual-qa/rmt-creator-integration.mjs \
  --anvil "$ANVIL" --solc "$SOLC" --pg-bin "$RMT_PG18_BIN" \
  --mobile-plan docs/evidence/mobile-signing/review-plan-4663.json \
  --browser chromium --viewport mobile --output "$FRESH_OUTPUT"
```

Repeat the lifecycle command for Chromium/WebKit and mobile/desktop with fresh output directories. Actual wallet-profile reproduction selects `--profiles-only`, both browsers and no mobile plan. The recorded ARM invocations additionally used `--solc-emulator /usr/bin/qemu-x86_64 --solc-cache /tmp/task089-solc-cache`. Native CI needs neither flag. The authenticated adapter command uses no live RPC:

```sh
DATABASE_URL="$FRESH_LOOPBACK_RMT_CURVE_PRODUCTION_SMOKE_DATABASE" \
RMT_DISCOVERY_REPORT_DIR="$FRESH_OUTPUT" \
pnpm --filter indexer exec tsx ../../scripts/discovery/continuity.ts
```

At `2026-11-20T15:20:11Z`, Upstash returned HTTP 403: `Monthly compute limit reached (5 CPU-hours). Please upgrade your plan by adding a payment method.` Its system record says the box auto-paused; metadata showed ephemeral expiry `2026-11-20T18:05:31Z`. No execution, resume, fork, new key, billing change, upgrade or alternate execution channel was attempted after that restriction. Read-only log/metadata recovery continued. The remaining final matrix and original raw exports remain unverified/unavailable; fresh authorized repository CI must supply independent evidence. No production change, deployment, governance execution, live signature, fund spending, RMT creation or financial activation occurred.
