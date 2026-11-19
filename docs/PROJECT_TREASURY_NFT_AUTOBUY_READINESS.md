# Project Treasury NFT Auto-Buy readiness

**BLOCKED_NO_BROADCAST. Automatic purchases remain OFF. No production purchase route, public listing feed or payment-token approval is established.**

[Task 084 owner scope](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/677#issuecomment-7019806025) starts from Task083 PR677 `663c057746e795f8cde60a4eca8d51d4d685b768`. Draft [PR678](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/678) is stacked on that branch. This task completes isolated administration, signed-order admission and an unsigned watcher candidate for the existing Seaport V2 vault. It adds no vault, token mode, hosted service, timer, production writer or financial activation.

## Security disposition

The exact four-source Seaport V2 compiler input remains SHA256 `3fbc55312a027e5f69b16fb927c8549efcc6674bab509c792efdc0104083c5f5`: solc0.8.26, Cancun, viaIR, optimizer200. No production Solidity or dependency pin changed. The original Task083 report and source remain intact. Slither0.11.5/all101 detectors still reports **48 observations, including23 Highs; strict exit1**. The generator adds no suppression and cannot turn this failed gate green.

The [individual disposition register](evidence/rmt-task084/security/README.md) binds every retained ID to source/AST, external call, baseline/postcondition, funds at risk, preconditions, tests and remaining assumptions. Twenty-two balance/custody baselines are internally assessed as guarded exact-delta warnings conditional on separately admitted asset semantics. One native-fulfillment observation is conditional on the exact pinned Seaport runtime and typed destination. No concrete asset-loss defect was confirmed under these assumptions; all23 remain unresolved in the release gate. A dishonest token can lie about its own balances, and a proxy can change semantics. Finite local testing is not independent security clearance.

Six new genuine-Seaport adversarial tests exercise guarded callbacks during funding, allowance grant/revocation, fulfillment, native payouts and NFT withdrawals. A pre-signed genuine Safe2-of3 disable attempted inside purchase must revert GS013 without consuming its Safe nonce, then work outside the lock. Exact payments, NFT ownership/balances, allowances, reservations and policy accounting remain asserted. The retained suites include fuzzing and invariants. Fresh run evidence and limitations are linked below.

Keep findings separate: old acquisitionV1 **22**, core/dependencies **22**, TreasuryV1 **6**, active permanent ReclaimV2 **7**, historical rejected ReclaimV1 **4**, and this SeaportV2 **23**. Observation counts are not a unique-vulnerability total. No detector, severity, compiler optimization, historical report or release control was weakened.

## Current orders and payment assets

The [read-only qualification](evidence/rmt-task084/marketplace/README.md) records actual public GET **HTTP401** on the documented OpenSea endpoint. No current public order was admitted. No credential, bypass, scraper fallback or purchase was used. This proves tested access is unavailable, not that no listing exists anywhere. A collection URL, bid or fulfilled historical receipt is not an open sell order.

The bounded owner-supplied signed-order parser and [schema](../scripts/seaport-acquisition/owner-supplied-order.schema.json) reject duplicate keys, invalid UTF8, oversized/deep/excess fields, arbitrary calldata/URLs, stale provenance and unsupported order shapes. Current verification corroborates chain/block/hash/time, EIP712 domain/signature, counter/unfilled status, owner/balance/approval, exact consideration, royalty and available reserve, then rechecks canonicality. Missing evidence, disagreement and reorgs stay unavailable. An admitted owner-supplied order is **not a verified public marketplace listing** and never grants execution approval.

Supported subset: a single ERC721 or ERC1155 offer; FULL_OPEN/static/full-fill; zero zone, zoneHash and conduits; no criteria, tips, dynamic prices or partial fills; exact bounded consideration and unique payees. Contract/delegated sellers are unavailable through the new owner-supplied path. Default chain4663 is read-only. Only the explicit chain31337 fixture profile accepts synthetic orders.

| Asset/profile | Admission and accounting | Status |
| --- | --- | --- |
| Native ETH | No token approval; separately funded vault pays exact all-in signed consideration; caller purchase value zero; exact trace and recipient/custody deltas | Asset semantics eligible for read-only qualification; production purchase route **NO_GO** |
| Robinhood aeWETH and other production ERC20 | Runtime/implementation/admin, upgrade powers and authority must be established; no fee-on-transfer/rebase assumption from ticker or interface | **NO_GO** |
| Explicit immutable synthetic ERC20, chain31337 only | Trusted source/runtime, zero initial allowance, exact scoped Seaport approval, zero final allowance, exact payer/payee/custody deltas | Isolated test profile only |

Two providers corroborated block118499505 and the recorded WETH proxy/implementation/admin bindings. Its ProxyAdmin owner is another TransparentUpgradeableProxy; a bounded further hop establishes code, not signer/quorum/timelock control. Delegated owner() reverted on both providers. Downstream authority and future upgrade constraints remain unestablished. These are explicit admission blockers, not proof of an exploit or approval of WETH. [Raw observations and integrity manifest](evidence/rmt-task084/marketplace/manifest.json)

## Safe administration and recovery

The existing dashboard now has isolated Safe2-of3 administration for policy configuration and ON/OFF, collection controls, fee caps, native funding, separate exact ERC20 approval/funding, and controller notices/acceptance. Only the exact pinned Safe1.4.1 profile with three plain EOA owners, threshold2, no modules/guard and verified proxy/singleton/handler is admitted. A Safe CREATE vault path remains explicitly **UNAVAILABLE**; a normal CALL is not deployment.

Before approval/submission, bind current owners, threshold, Safe nonce, runtime, exact target/selector/value, chain31337 and a distinct gas payer. The confirmed offchain missing-code defect is fixed: new Safe owner, payer, incoming-controller, historical receipt and watcher admission require bounded exact raw eth_getCode at the specified block/pending tag. Missing/null/malformed/timeouts never qualify an EOA. Known EIP-7702 requires the existing pinned designator and delegate runtime. Its incoming-controller receipt has a separate branch instead of being incorrectly treated as a Safe. The isolated V2 EOA preparation guard also requires actual raw empty code; generic legacy classifiers remain untouched. Owners sign the exact EIP712 SafeTx. Execution is CALL-only. SafeTx gas/refund fields are all zero, so failed inner calls revert GS013 and do not burn the Safe nonce. Native funding is Safe capital in the inner call; the outer gas payer sends zero value and pays only its own network cost. ERC20 approval and funding are distinct, exact transactions. Unknown owner/module/guard/delegation changes fail closed.

Standard SafeTx has **no onchain expiry**. UI freshness metadata does not revoke an already collected signature. Explicit canonical refresh preserves approvals only when the SafeTx hash and current authority/nonce remain identical. Refreshing gas is not authority to sign again automatically. A reverted outer hash remains in its original journal; the current retry UI requires an explicit new proposal/two approvals even when GS013 leaves the Safe nonce unchanged.

Admin receipts have their own chain/vault/block/log-qualified index table and canonical-block foreign key; reorg rollback removes invalidated evidence. Recovery binds the actual Safe exec trace, receipt-time owner/nonce state, exact inner call and asset flows. It does not reject a historical valid receipt merely because UI metadata expired or the current Safe nonce advanced. Ambiguous same-block authority/delta conditions, unsupported profiles or missing traces remain pending. No automatic re-signing/resubmission occurs. Physical iPhone acceptance is not claimed.

## Listing watcher / keeper candidate

The read-only watcher is invoked by the existing indexer's verified-cycle hook under its existing PostgreSQL writer lease. It has no scheduler, signing key, wallet function or broadcast method. The PG adapter permits only the named private chain31337 fixture database, PG18.6, exact manifest binding and one writer; it cannot migrate or write the production Railway database.

Each eligible cycle bounds polling (default60s), total work15s, eight discovery entries, 64 durable records and512KiB state. It stores compare-and-swap revisions and at most one outstanding unsigned proposal. The poll attempt is durably recorded before any provider read, marking retained proposals PENDING_EVIDENCE; outages or a crash cannot reset the interval and trigger retries on every block. Discovery must provide a currently admitted PUBLIC or OWNER_SUPPLIED order. A previous success is never reused as current proof.

Before preparing exact purchase calldata, it checks fresh canonical proof, signature/counter/status/ownership/approval, full consideration, collection/runtime, controller authority hash, policy/controller epochs, ON state, per-NFT/lifetime/day/cooldown limits, actual free reserve and gas-payer pending/latest nonce. It independently verifies the order again, simulates the exact unsigned request and rereads final state/canonicality. Chain4663 never emits an execution request. OFF, consumed orders, drift and reorgs invalidate old proposals. Read outages put retained proposals in PENDING_EVIDENCE. Recovery verifies their original order again and never emits a duplicate request.

Invalidated hashes are not silently re-admitted. The64-record capacity fails closed rather than deleting history; archival/re-admission and a production store are not activated by this fixture adapter.

This is an **unsigned preparation candidate**, not autonomous purchasing. A reliable feed and a separately authorized person/keeper to submit and pay gas remain necessary. There is no mandatory new paid service, promised profitability, automatic gas spending, gas subsidy from core revenue or liquidity principal, or automatic retry. Maximum network fee is the proposed gas limit times maxFeePerGas; actual L2/data costs and production submission policy remain unapproved.

## Custody and product boundaries

The vault holds only explicitly funded sidecar assets and acquired NFTs. Core creator/treasury fee entitlements, operating/reserve beneficiaries, fixed1B supply, 600M/400M allocation,90/5/5 and permanently locked original LP principal are unchanged. Existing noticed withdrawal and controller delays remain enforced; a dashboard switch cannot erase settled custody or already signed authorizations. Reclaim remains the frozen permanent-surrender trial. Own-token buybacks are a separate NO_GO without independent token-price evidence.

## Reproduce and acceptance evidence

Use the exact preparation/build steps in the [acceptance workflow](../.github/workflows/seaport-acquisition.yml), including checksum-verified solc/PG18.6, genuine upstream fixture artifacts and existing pinned v4 dependencies. No production credential or service is needed. Before Foundry, prepare its official artifacts with `node scripts/seaport-verification/fixture-compile.mjs --solc <verified-solc0.8.26> --output packages/contracts/seaport-acquisition/official-artifacts.json`.

```sh
node --test packages/launchpad-common/seaport-vault-*.test.mjs scripts/seaport-acquisition/*.test.mjs
node docs/evidence/rmt-task084/browser/replay-raw-proofs.mjs
node docs/evidence/rmt-task084/browser/source-73fc6d0/replay-raw-proofs.mjs
pnpm --filter indexer exec tsx --test src/seaport-acquisition*.test.ts src/seaport-listing-watch*.test.ts
forge test --root packages/contracts/seaport-acquisition --use <verified-solc0.8.26> -vvv
node scripts/seaport-acquisition/browser-run.mjs --anvil <anvil> --solc <verified-solc0.8.26> --pg-bin <pg18.6-bin> --browser chromium --fork-robinhood --output <isolated-output>
# Repeat with --browser webkit. Omit --fork-robinhood for the existing real-core fixture.
```

The named Robinhood mode forks genuine pinned Seaport and Safe runtime with read-only upstream connections; it signs synthetic chain31337 orders. The default connected fixture also retains the real fixed1B core lifecycle. These scopes are distinct from live4663 orders, a hosted listing feed, an independent audit or a physical phone. PostgreSQL server stop/start, Next restart, durable rows, replay, traces, reorgs and public404/zero-wallet negatives must be demonstrated by the connected jobs, not inferred from unit mocks.

The final functional source is **`73fc6d03d3160e19ac3d19af38138da3461bdb3f`**. Its29 CI checks completed: **22 success, seven unchanged strict security failures, zero pending**. No gate was waived. The [four connected jobs](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44624731535) pass Chromium/WebKit in both the default real fixed1B core fixture and the genuine Robinhood Seaport/Safe fork fixture. They include the raw-code correction, known EIP-7702 incoming Safe proposal/cancellation, actual PostgreSQL server and Next restarts, durable admin rows, missing hashes/traces and reorg downgrade.

| Verification at that source | Actual result |
| --- | --- |
| Seaport/common/order/watcher Node tests |68 pass,0 fail/skip |
| Seaport indexer/store/role tests |9 pass,0 fail/skip |
| Genuine Seaport/Safe Foundry |54 pass,0 fail/skip |
|23-ID disposition integrity |6 pass |
| Repository core Foundry |112 pass,0 fail/skip |
| Chromium/WebKit connected modes |4 jobs pass |
| Production-style web, Linux Netlify artifact, Railway container, Firebase emulator, repository/dependency and secret checks |Pass; no deployment |
| Strict security jobs |7 failed; retained findings remain |

The seven failed check names are slither, fixed-supply-4663, project-treasury-v1, reclaim-v1, reclaim-permanent-v2, nft-acquisition-strict-security and seaport-vault-strict-security. Their underlying contract tests and failed analysis stages remain separate evidence. Seaport V2 still reports all101/48observations/23Highs/strict1. The source98 [CI snapshot](evidence/rmt-task084/ci-source-98eb1be7.json) and its original browser files remain historical proof, not evidence of later account-code changes.

[Fresh raw browser receipts, traces, screenshots and replay](evidence/rmt-task084/browser/source-73fc6d0/README.md) retain60 observed executions,120 verified signature uses,120 tamper rejections and56 final canonical admin rows across the four modes. The source73 raw scan records448 findings,448 explicitly classified and zero unknown; it is not a zero-finding raw scan. The [historical source98 archive](evidence/rmt-task084/browser/README.md) remains intact. Both archives retain exact source/job/artifact identities and original-byte hashes. Test-owner signatures and Anvil state-installed EIP-7702 code are synthetic evidence, not real wallet authorization or a delegation change. Original plaintext is scanned before compression; raw findings, classifications and unknown counts are disclosed separately, with no rule/ignore/gate change. Engine/device emulation is not physical-iPhone acceptance.

One original RH Chromium EOA prepare at source d9e483e returned fail-closed pending before Safe administration. The [failed observation](evidence/rmt-task084/browser/failures/d9-rh-chromium/README.md) is preserved. Its exception/input were not originally retained; timing does not establish cooldown as the cause. Current source adds authenticated loopback-only bounded stage/error-name/revert-selector diagnostics and captures requests/responses before unchanged assertions. Fresh journeys pass with no retry or readiness relaxation. Neither the diagnostic nor the independent raw-code correction is claimed as the causal fix for that unexplained observation.

Offchain fixes also reject additional Safe-origin mutable calls, anchor review freshness to canonical headers and persist poll attempts before provider reads. Intermediate harness/type failures and superseded-run cancellations remain in CI history. Cancelling obsolete runs did not waive any current check.

## Separate production prerequisites and owner actions

1. Review this exact branch/evidence; no merge, deployment or activation is authorized.
2. Resolve or explicitly assess applicable strict findings for the exact production-chain artifact. The existing vault enforces chain31337. A separately authorized production-chain build/delta requires fresh verification; this task does not generate or approve changed deployable bytecode.
3. Establish a legitimate current-order source, independently current order proof and the admitted payment/collection source-authority policy. Unavailable feed/WETH stay NO_GO.
4. Separately approve the exact production vault/controller, Safe profile, separately funded budget/caps/withdrawal policy and a submission/gas-payer operating policy. Safe-creator deployment remains unavailable.
5. Verify production receipts/traces, multi-transaction block attribution, persistence/reorg/backup/provider/L1-finality operations and physical-wallet acceptance before any financial release. Current Safe admin attribution deliberately requires one transaction per block.

No new owner wallet, key, funding or signature is requested by this development task. Recommended next work is the narrow remaining current-order/payment admission and exact-stage security disposition, rather than activating a keeper without its prerequisites.
