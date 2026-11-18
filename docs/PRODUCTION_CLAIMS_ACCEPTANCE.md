# Production claim preparation and acceptance

Task 075 extends the existing **My Launches → Earnings** page. It implements unsigned wallet profiles, canonical receipt verification and durable claim evidence. **Production financial execution remains blocked.** The website, Railway deployment, database, Firebase, contracts and governance notice were not changed or activated by this task.

Base: Task 074 draft PR #668 at `641464490283736bc7ce0cbb40da9382d90120fa`. The final validation commit, checks and sanitized evidence belong to the Task 075 draft PR and [acceptance manifest](evidence/rmt-task075/acceptance.json). This document does not certify an independent audit or authorize a signature.

## Acceptance boundaries

| Boundary | Implemented or observed | Remaining limit |
| --- | --- | --- |
| Local synthetic execution | Real signed type-2 transactions, actual contracts, official v4 dependency runtime, actual Safe proxy, one PostgreSQL writer and restart/reorg proofs on chain 31337. | Synthetic assets and ephemeral test keys; not production or physical-phone acceptance. |
| Robinhood 4663 | Bounded public RPC observations and a mutation-denying local fork verify deployed pins, the personal wallet's delegation and both treasury Safes. | No eligible production project/fee claim was manufactured or executed. |
| Unsigned production adapters | Exact production manifest, wallet/runtime/nonce/entitlement preflight, transaction-specific simulation and verified Nitro fee components or refusal. | Internal server functions only; no public signing/broadcast endpoint. An unavailable fee component is not a zero-cost quote. |
| Canonical settlement | Two-provider L2 agreement, exact outer/inner transaction and receipt/trace proof, durable activity matching and reorg handling. | The accepted Ethereum L1 finality policy is **not implemented**. Chain 4663 cannot return `settled`. |
| Production storage | A versioned schema and bounded ingestion hook for the existing leased writer, plus isolated PostgreSQL tests. | New DDL is **uninstalled**; no production writer/scheduler or schema migration was enabled. |
| Browser and CI | Final Task 075 browser/CI results must be recorded in the acceptance manifest and draft PR. | Pending final recorded run at this documentation commit; do not infer a pass from the core script. |
| Physical wallet | Connection-only acceptance from earlier work remains separate evidence. | Physical iPhone **earnings**, Safe approvals and claims are unverified; no owner signature was requested here. |
| Security release | Existing source, economics, custody and scanner configuration preserved. | The same **22 high findings** and **both failed static-analysis release gates** remain. This task does not waive them. |

## Transaction profiles

`rmt-claim-execution-v1` is a bounded, versioned unsigned review. Its `executionEnabled` is always `false`, including local reviews. Only the explicit loopback execution-test controller can ask synthetic test wallets to submit.

| Profile | Beneficiary and inner caller | Outer signer and gas payer | Required checks and authorizations |
| --- | --- | --- | --- |
| Direct EOA | The EOA for beneficiary-only claims; the immutable ledger or Operations recipient for permissionless collection/payout. | That EOA; one type-2 transaction confirmation. | Empty account code, canonical/pending EVM nonce, chain, destination, zero call value, exact calldata, entitlement and runtime. |
| MetaMask EIP-7702 | The delegated account; its address remains the beneficiary and caller. | The same account; one ordinary type-2 confirmation. | Exact `0xef0100…` designator, pinned delegate runtime at review/pending/receipt, nonce and all direct checks. No authorization list or delegation change. |
| SafeL2 1.4.1 | The Safe, **not its owners**. A claim pays the Safe's credit. | Separately identified EOA or admitted delegated account pays the outer transaction gas. | Exact proxy/singleton/handler runtimes, three distinct EOA owners, 2-of-3, no modules or guard; current Safe nonce, gas-payer nonce and separate Safe EVM nonce. Two sorted canonical EIP-712 signatures are required before an outer `execTransaction` envelope exists. |

The only admitted delegated implementation is `0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B`, runtime hash `0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0`. The runtime archive, exact upstream provenance and **MIT AND Apache-2.0** notices are retained in the [fixture documentation](../packages/contracts/test/fixtures/metamask-delegation-1.3.0/README.md). Unknown/revoked/replaced delegation fails closed.

The Safe profile fixes operation to `CALL`, value to zero and every Safe gas/refund field to zero. It cannot delegatecall, add a refund recipient or divert ledger funds. Its signed inner proposal is not a direct EOA transaction. The outer call is prepared only after verifying two current owner signatures and successful Safe execution simulation. The owner need not be the external gas payer. Contract owners, EIP-1271/approved-hash signatures, modules, guards and other Safe versions are unsupported by this exact profile.

An application review expires, but most ledger claims have **no on-chain expiry**. A collected Safe approval for those calls remains executable until its Safe nonce is consumed or the Safe's own authority changes. Only `collectLpFees` has the inner contract deadline. The UI identifies `safe-nonce-only` versus `inner-contract-deadline`; refreshing an application review must not be presented as revoking a Safe signature. No new cancellation authority is added.

### Supported operations

| Operation | Exact contract method | Settlement recipient |
| --- | --- | --- |
| Curve claim | Original `RMTLaunchCurveRevenueLedgerV1.claim()` | The calling beneficiary; original credits survive V1→V2→V3. |
| LP collection | `RMTV4CurveGraduationV1.collectLpFees(token,deadline)` | The original position's fee ledger. Permissionless calling does not grant a withdrawal right. |
| LP combined/native/token claim | `RMTLaunchCurveLpFeeLedgerV1.claim()` / `claimAsset(bool)` | The calling beneficiary; ETH and token quantities remain separate. |
| Creation-fee release | `RMTLaunchCurveFactoryV2.claimCreationFees()` | Immutable Operations treasury; a caller cannot choose a different recipient. Factory-wide amount is not repeated for each project. |

Preflight binds chain, deployment block/hash, factory/registry/graduation/guard and target code, token/original ledger, complete PoolKey, position ownership/liquidity, beneficiary and caller, calldata/value, expected amounts, account/nonce(s) and any inner deadline. Policy, runtime, account, chain, pending nonce or entitlement changes require a new review. State is revalidated immediately before the synthetic wallet request. The journal preserves the original intent and returned hash; refresh, rejection or ambiguous submission cannot silently replace its nonce or resubmit it.

For chain 4663, the two existing configured readers must agree at one canonical checkpoint on the entire review, including simulation and fee fields. No average, majority override or silent fallback resolves a conflict. Estimates use the exact outer envelope and Nitro `gasEstimateComponents` at `0x00000000000000000000000000000000000000c8`; missing/zero L1 poster components, failed simulation or insufficient payer funds return unavailable. Local estimates are explicitly synthetic, have no L1-data component and are not current production prices.

## Receipt, indexing and recovery contract

`rmt-claim-settlement-v1` distinguishes the following states:

| State | Meaning |
| --- | --- |
| `submitted` | Original payer/nonce has no confirmed matching transaction yet. |
| `receipt-observed` | A receipt exists but required execution/native-transfer proof is incomplete. |
| `canonical-l2` | Both admitted providers agree on the exact transaction, receipt/header, event, amounts, execution proof and observed L2 checkpoint; canonical durable activity matches. |
| `indexing-pending` | On-chain L2 evidence is sufficient, but the exact durable row is missing or has not reconciled. |
| `settled` | Available only under the explicitly named synthetic-local checkpoint policy on chain 31337. No production L1 policy is admitted. |
| `reverted` | The outer transaction reverted, or the Safe's actual inner execution failed even if the outer receipt succeeded. |
| `unavailable` | Conflicting, malformed, unsupported, stale or inaccessible required evidence. Never an assumed zero or a successful payment. |

Production sources are the existing official Robinhood RPC and Pocket public endpoint. Distinct local facades of one Anvil process inject failures in tests; they are **not independent production providers**. A second L2 RPC is not independent Ethereum L1 evidence.

Verification binds the original gas payer/EVM nonce and exact type-2 gas fields as well as the Safe nonce when applicable. Safe execution additionally requires its indexed `ExecutionSuccess` digest, zero refund payment and the exact successful inner CALL. Token transfer events and balances, native transfer traces, ledger events and principal custody are reconciled; a fee event alone does not establish native settlement. A present receipt with a missing trace stays pending. A changed later delegation does not retroactively invalidate a correctly proven historical receipt, but cannot authorize a new transaction.

The proposed production store records chain, manager, factory, registry, deployment hash, token/ledger, actor, gas payer, beneficiary, transaction/log, block/hash, ETH/token quantities, both nonces, intent hash and full pool/position identity. It uses the existing writer lease and canonical registration/checkpoint scope. Duplicate exact activity is idempotent; a conflicting identity aborts the transaction. Registration/checkpoint rollback cascades orphaned claim rows. A crash rolls back the entire batch. Runtime initialization refuses absent tables rather than installing them.

Limits are explicit: 32 KiB/three-second test HTTP body, two concurrent and 30 per-minute fixture requests, 128 logs per receipt, 16 queued transaction hashes per writer batch, 128 rows per commit, 16 activities per transaction read, and 12 KiB per normalized activity. The read-only settlement facade caps each provider at 256 dispatches and 25 seconds, with a method allowlist; the ABI readers retain their own limits. These are layered limits, **not** a global aggregate RPC quota or a distributed visitor rate limit. Production load, archive retention and deployment approval remain separate operational gates.

## Actual isolated evidence

The core `--profiles-only` run passed with **34 unique synthetic transactions**: 32 captured by the signed-submit helper, including eight migration steps, plus two separately captured governance schedule transactions. Its nine reviewed fee operations are a subset, not nine additional transactions. It created three fixed-supply projects and an actual Safe proxy using ephemeral test owners.

- EOA and genuine synthetic-key signed delegated type-2 curve claims; revoked/replaced delegation rejected; two token reviews at the same payer nonce require a fresh review after the first consumes that nonce.
- Actual Safe 2-of-3 execution and one-owner rejection; old approvals cannot replay. Safe curve and mixed LP claims use the Safe beneficiary, with an independent relayer gas payer.
- Funded V1→V2→V3 transitions use two genuine fixture-governor signatures and the actual notice delay on the local chain. Token address/supply, holder balance, backing `99000000000000000` wei, inventory and original ledger/recipient credits are conserved. Premature execution reverts atomically. Only the original ephemeral fixture operator is temporarily unlocked for its existing scheduling closure, then relocked.
- Graduation deposits `1999999999999998463` native wei and `399999999999999999999987510` token wei; remaining dust is recorded. Official Router 2.1.2 buys/sells generate actual fees. The full PoolKey and original position liquidity/owner remain verified.
- Permissionless collection, delegated native-only/token-only LP claims, Safe combined claims and factory-wide payout are canonically indexed. The measured collection distributed `29999999999999` native wei and `299999999999999999` token wei; these amounts are synthetic fixture results, not revenue projections or production gas quotes.
- A missing returned hash recovers the original transaction without another send. Missing trace and cross-provider receipt conflict fail closed. App/indexer restart retains activity; a local reorg removes orphaned claim rows and restores credits while principal remains locked.

The local chain uses official v4 dependencies from the existing Base Sepolia anchor **57648300**, hash `0x5bb29976ce80ddede79f192c61eba8fe9d96f499f8bfa11e0820d11820e91d20`; it is **not a chain-4663 execution claim**. The MetaMask delegate designator/runtime is installed by Anvil state controls, then genuine ephemeral account keys sign ordinary type-2 transactions. This is an execution-state fixture, not a newly signed EIP-7702 delegation authorization. Existing isolated contract regressions supply the rejected-native-recipient/token-only-recovery boundary; do not confuse that separate test with a new public-wallet run.

Two real failures remain in the evidence history. The first stopped at a registration/checkpoint readiness race after a reverted outer Safe transaction still consumed its gas-payer nonce. The test now waits for actual confirmations/checkpoint reconciliation. The next run found an incorrect non-indexed Safe event ABI in the new verifier; the exact pinned Safe 1.4.1 source and genuine receipt use an **indexed** digest. The ABI and regression were corrected without changing a contract, detector or settlement requirement. Neither failed run is counted as passed.

Final browser screenshots, browser recovery counts and CI results: **pending the final Task 075 recorded run**. Fill from actual artifacts; Chromium/WebKit viewport emulation cannot establish physical iPhone acceptance.

## Read-only 4663 observations

The [provider observations](evidence/rmt-task075/provider-observations.json) record 50 read-only requests at fresh canonical block **117601397**, hash `0x31afb21d824e4cfbb437cf59a4f5a49448304631afc0538f2162fa441f6d5903`. Both providers matched the personal wallet's designator/delegate runtime and treasury bindings. At the separately tested historical boundary, the official endpoint lacked archive state and call tracing; Pocket served them. That does not guarantee future completeness or availability.

The [read-only fork report](evidence/rmt-task075/read-only-fork-4663.json) pins the actual factory-scheduling block **116966133**, hash `0xba98e1e82b736a50c46dfae095f1f3fd3cc4932921938c7b2aa8d30f23ec9106`. It verified ten protocol/v4 code pins, personal delegation, both SafeL2 1.4.1 treasuries, three approved owners, 2-of-3 and nonce zero. The loopback proxy denied write methods; the successful run made 78 upstream reads, no financial call, signature, deployment, fork time advance or state mutation. An earlier archive failure and a separate HTTP 429 are retained; paced retry stops immediately on a new 429 rather than cycling providers.

At that checkpoint, Directory `latestVersion` was zero, its existing pending notice remained intact and factory creation fees were zero. Historical factory reading succeeded, while unsigned preparation refused the old/freshness-ineligible context. No production claimant or new project was fabricated to produce a positive result. There is no observed production new-engine claim settlement, hosted Safe claim acceptance or independently verified L1 finality.

## Reproduction and operations

Use Node 22, pinned pnpm and frozen dependencies. Build the existing website/indexer first. The focused same-app run creates a disposable loopback PostgreSQL cluster and no cloud resources:

```sh
node scripts/visual-qa/rmt-creator-integration.mjs \
  --profiles-only --browser chromium \
  --anvil /path/to/anvil --solc /path/to/checksum-verified-solc-0.8.26 \
  --pg-bin /path/to/postgresql/bin \
  --mobile-plan docs/evidence/mobile-signing/review-plan-4663.json \
  --output /new/isolated/evidence-directory
```

Repeat with `--browser webkit` for the other browser engine. The focused profile run supplements the existing Task 074 normal/successor lifecycle; it does not replace those regression scopes. The contract fixture reuses checksum-verified solc 0.8.26 and unchanged `rmt-curve-fixed-supply-security-v2` compiler inputs; manifests and tool hashes are retained in the evidence. Do not point any smoke database variable at Railway or an existing data directory.

Read-only tools require fresh output paths and bound their public reads:

```sh
node scripts/claims/probe-read-only-4663.mjs --output /new/providers.json --runtime-archive /new/public-runtime.json.gz
node scripts/claims/fork-read-only-4663.mjs --anvil /path/to/anvil --output /new/fork.json
```

Do not rerun a rate-limited provider without honoring its cooldown. These probes cannot sign, deploy, claim, manufacture launch activity or establish L1 finality.

Before any production rollout, monitoring must distinguish canonical checkpoint age, RPC disagreement/429/timeouts, archive/trace gaps, pending claim age, incomplete index evidence, reorg depth/rollback success, writer lease health, database errors/restore generation and missing L1 policy. A provider outage preserves pending/unavailable status; recovery reconciles the original hash/nonce without automatic resubmission. Persisting new claims needs an approved schema installation following a verified backup/restore, one writer and bounded retention/replay operations. No new paid provider, service or Railway plan is required by the implementation or provisioned here; actual production resource acceptance remains unresolved.

## Separate future treasury work and owner gates

The optional **per-project treasury** is a separate next workstream. Its unique per-project address must enter a new launch through the creator's committed allocation, remain the actual ledger beneficiary and be independently controlled. Task 075 does not deploy a treasury, add owner permissions or mutate an existing project's payout address. A future treasury with different code/authorization needs its own reviewed execution profile; the current Safe profile does not admit arbitrary contract wallets.

External NFT royalty receipts, a per-project reserve and optional auto-buy (OFF by default) must remain separate from ledger earnings, protocol Operations/Reserve shares and permanently locked principal. Any future automation needs distinct spending authority, explicit accounting, failure handling and approval; it cannot reuse a claim review as trading permission. RMT Reclaim remains separate and unimplemented by this task. No royalty, buyback, automatic spending or new token policy is introduced.

Owner-only steps are staged: review the draft and evidence; separately approve any read-only website/indexer/schema rollout within existing plans; accept and verify production provider/trace, indexing, backup/restore, monitoring and independent L1-policy requirements; resolve the retained security-release gates; authorize a physical-wallet acceptance session and then each applicable financial activation/transaction. Existing governance notice/execution approvals remain separate. None is inferred from passing local tests, a saved Safe signature, a website publication or an environment flag.

[Creator earnings](CREATOR_EARNINGS.md) · [Treasury policy](CREATOR_TREASURIES.md) · [Security findings](SECURITY.md) · [Release stages](RELEASE_ACCEPTANCE.md) · [Deployment](DEPLOYMENT.md)
