# Private fee-action evidence — preparation only

Base: `aefc2a2fb4da7a38213e9fecd58914577b560858`. This branch reuses PR528's private adapter/verifier diagnostic plumbing and build-only mechanism, with bounded structural action output. PR528 remains separate and unmerged. Neither this document nor a passing test authorizes a production-context invocation, deployment or merge.

## Scope and security

This is a server-only one-shot command. It reuses the actual RMT price adapter, provider wrapper, firm verifier, executable-minimum decoder and registry/runtime authority. There is no new engine, public route, authorization issuance, signature, approval, broadcast or customer mutation. No dotenv, environment pull/export or credential transfer. Public routes omit the optional observers and retain their existing reads and acceptance rules. Candidate `a1a2…572f` remains unadmitted.

The firm verifier passes a frozen primitive envelope to a separate in-memory observer **after** its existing response/envelope parsing and **before** runtime rejection. The collector retains at most 262,143 calldata bytes, interprets them after the observed runtime hash arrives, and releases the reference. No raw calldata reaches the record writer. If a later RPC stalls until process termination, already-returned but un-emitted quote/action evidence may be lost; the timeout/missing end markers must be treated as incomplete, not a reason to rerun automatically.

The current synthetic wrong-treasury regression remains red in its separate isolated worktree. This collector does not fix that gap. Structural intent is not CALLDATA_FEE_VALIDATED or SETTLEMENT_VERIFIED.

## Bounded matrix and calls

Exactly three possible cases, in order: 0.001 native ETH → USDG; 5 USDG → native ETH; 5 USDG → WETH. The prior public read-only test identity remains the RMT treasury; this claims neither spendable funds nor permission to spend them. Identity, project-conflict and Stock Token checks remain; no invented indicative floor or state override.

At most three price requests and three firm requests, one of each per eligible case; no 0x retry. A failure advances to the next case only within this fixed matrix. Output budget exhaustion stops subsequent cases. Process watchdog: 180 seconds, no recurring invocation.

The current unadmitted/current-registry branch uses eight logical execution RPC reads per case: chain-clock latest block; verifier chain ID; authority chain ID/block number; pinned header; registry current; Settler code; matching header again. A previous-registry read is conditional. The existing clock helper allows two retries, so this branch can make ten physical execution-RPC attempts. These are not total run-wide counts. Existing bounded identity inventory/code/metadata, project-conflict and Stock Token reads are cache-dependent; admitted continuations also read balances, allowances, code and simulation/approval-gas estimates. No historical backfill is introduced.

No production cost is incurred during offline tests. A future build's total monetary cost is unknown until telemetry exists; the 180-second process bound does not include dependency installation or platform build overhead. Vercel Pro/$20 threshold/production pause and Railway $20 controls remain owner-locked; no claim they are an absolute billing ceiling.

## Output contract

Application output is JSONL, schema `RMT_FEE_ACTION_V1`. Each record has a monotonic `sequence`, `type`, `caseId` and SHA256 `recordHash` over the JSON payload before the hash field. SHA256 here detects log modification/loss; Ethereum runtime hashes remain keccak256 from the existing authority.

Order:

1. `PROOF_START` with configuration status and bounded-run metadata.
2. One `SOURCE_FINGERPRINT` per reviewed source file, before any network/case records. This attests listed source bytes only, not every transitive dependency or uploaded artifact.
3. For each attempted case: `CASE_START`; `QUOTE` if quote observation ran; ordered `ACTION` records; separate implicit `FINAL_MINIMUM`; `CASE_END`.
4. `PROOF_END` with counts/status/truncation. The watchdog closes an active case as PROCESS_TIMEOUT when possible. A platform kill may prevent terminal records.

Limits: **2048 UTF-8 bytes per complete record; 65,536 application JSONL bytes total; 8192 bytes reserved for control/end records; 64 action records per case**. No sliced JSON is emitted. An oversized record is omitted, truncation becomes explicit, emitted/expected/omitted action counts are retained, and another quote is not started after exhaustion. CLI/package/platform logs outside application JSONL are not included in that byte cap.

`CASE_END` separately reports `outputComplete` and `semanticsComplete`. Unknown action interpretation is not promoted to complete semantics. `PROOF_END=COMPLETE` means all three cases ended without application truncation; it does not mean routes verified, fee amounts proved or trades succeeded. `INCOMPLETE`, `BLOCKED`, `TIMEOUT`, `FAILED` and `NOT_RUN` are distinct. The offline `validateProofJsonl` checks extracted application JSONL sequence/hashes/unique cases/counts/end markers, not semantic compatibility. Missing first/middle/last records, malformed JSON and even JSON-valid platform redaction invalidate it. An explicitly incomplete but intact stream can be structurally valid.

## Structural action schema and semantics

Common fields: index, known action kind/selector (unknown selector hashed), semantic family, runtime-dependent sourceSemantics, semanticsComplete, token/recipient/target roles, amountMode, denominator, numerator, amountLiteral, rounding, balanceBasis, sell/buy balance effects and feeAttribution. Recognized actions add narrowly typed scalar fields such as patchOffset, literalOverwritten, nestedKind, deadline, minimum or source/destination balance. Arbitrary bytes, signatures, paths and fills are never emitted; opaque routes remain partial.

Old reviewed runtime uses denominator 10,000. Candidate runtime uses 1,000,000 **for diagnostic interpretation only**, not admission. Unknown runtime uses unknown arithmetic and incomplete semantics. Proportional values are never converted into asserted atomic fees. Native BASIC uses wrapping uint256 multiply then floor divide against current Settler balance. ERC20 BASIC rewrites a word at a raw nested-call byte offset; offset36 targets transfer amount, offset4 can overwrite recipient. Zero-token BASIC is a no-patch, zero-native-value call, distinct from native ETH. Known ERC20-shaped transfer literals are call intent, not independently verified token behavior.

TRANSFER_FROM is first-action-only input acquisition; high-uint sentinel amounts are proportions of current **user** balance, not enormous absolute amounts. Destination is explicit as a role. NATIVE_CHECK is a deadline and msg.value upper bound, not equality or a balance check. POSITIVE_SLIPPAGE is a conditional capped excess transfer. CHECK_SLIPPAGE is an early check/transfer that clears the final check; RMT's acceptance decoder still rejects it. Final minimum is recorded as a declared envelope minimum, with protectionVerified=false at the structural diagnostic layer.

Unknown/malformed actions and route paths remain unknown. BASIC/arbitrary calls are not assumed safe from ABI alone. Treasury-bound transfers are `RMT_FEE_CANDIDATE_NOT_PROVEN`; other transfers are `UNATTRIBUTED_TRANSFER_NOT_PROVIDER_PROVEN`. Provider JSON fee amount/token is quoted context only; recipient is unknown unless independently established. No transfer is attributed as provider revenue merely because it is not to RMT.

## Sanitization

No user wallet literal, raw calldata, complete arbitrary action payload, environment dump, cookie, session, commitment, credential, credential URL or raw exception is emitted. User roles take precedence, including `USER_RECIPIENT_AND_RMT_TREASURY` when the test wallet equals the treasury. Known treasury/token/holder addresses are represented by roles. Unknown addresses become stable `ACTION_TARGET_<sha256(lowercase address)>`. The quoted Settler may be explicit because address/runtime binding requires it, except a user-address collision becomes USER_RECIPIENT. User-shaped numeric ABI fields are redacted. Allowed runtime/block/calldata hashes are evidence fingerprints, not raw action bytes.

## Tests and review

`pnpm --filter web test:vnext-adapters` includes the private action and actual adapter/verifier mocked-integration tests. Cases cover missing/malformed configuration before traffic, provider failure/no-route/rate-limit, runtime rejection with retained action evidence, native/ERC20, bps/ppm, offset overlap, zero/native separation, numeric-wallet and treasury/user collisions, secrets in unknown payloads, action order, size limits, missing/redacted terminal records and timeout. These are not live compatibility evidence. Existing authorization/post-approval/wallet/recovery/hardening/readiness/typecheck suites remain required.

## Separately authorized production run

Stop after implementation, PR review and six required exact-head checks. Before any run, require explicit owner authorization naming that exact head and one invocation. Re-fetch exact main/head, verify required checks/review threads, Pro/$20/pause, unchanged aliases and clean exact Git source bytes. Do not use the consumed PR528 authorization.

The existing opt-in `private-zero-x-proof.vercel.json` executes the command in a production-context build and then intentionally exits 1. It is not normal application configuration or a lifecycle hook. The normal ignored-build guard and non-main Git deployment settings remain untouched. If separately authorized, use the reviewed existing unaliased `--target production --skip-domain --local-config apps/web/scripts/private-zero-x-proof.vercel.json` mechanism. Do not promote, merge, attach aliases, modify environment variables or rerun on missing logs. The build must publish no successful application.

Compare source fingerprints to reviewed Git bytes before interpreting quote evidence. Extract complete JSONL records and validate sequence/hashes/completeness before semantic analysis. Preserve the actual quote-to-runtime association. The next fee-binding implementation must use the recovered sequence and still prove exact canonical half-up amount, sell asset, treasury, count and ordering. Settlement remains separate.
