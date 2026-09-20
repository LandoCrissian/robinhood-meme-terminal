# Private BASIC index-3 observation — preparation only

Base: `b51985182cdfc5b4192afaf3cbeb3e881993da83`. This reuses PR534's adapter/verifier observers, structural inspector, JSONL writer and build-only runner. It does not admit BASIC routes, change runtime/fee authority, or create a public endpoint. PR528/530/533/534 remain unmerged.

## Why another observation needs explicit authorization

The retained production window contains the owner's exact `/api/vnext/quotes` server request ending `wmqv7-1789881142571-2e6864e0ba11`, with HTTP 200 and ROUTE_READY. The subsequent HTTP 422 verification logged `UNSUPPORTED_ROUTE`, `verifyZeroXEncodedFee`, index 3, BASIC. Its logged quote ID is `c37aca41-a3ff-40e4-9e73-a715bef298a9`, not the supplied `cf68b3bc-049a-4221-83da-0b1d396755cf`; correlation is partial. The bounded log schema retained no target, selector or action arguments. It cannot identify a safe integration.

The current decoder rejects this BASIC form before wrap/unwrap admission. The generic [official Basic.sol at the reviewed commit](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/core/Basic.sol) describes caller-side amount patching, native value and Settler-token approvals; it does not establish the semantics of an unknown callee.

## One-shot contract

Only `private-zero-x-proof.ts --execute-read-only` executes. Exactly one fixed case: chain 4663, 1 USDG (`1000000` atomic) to CANNACAT, using the same public read-only treasury test identity as PR534; this asserts neither wallet ownership nor spendable balance. Identity, project conflict and Stock Token gates remain active. The actual adapter supplies the indicative floor, then the actual firm verifier executes. No authorization is issued.

Transport ceilings: 1 indicative request, 1 firm request, 64 fetch JSON-RPC reads, 16 other fetch GET/HEAD reads. Failed calls consume budget. No retry, mutation, signature, approval or broadcast method is permitted. Hard process deadline: 180 seconds. Missing/malformed configuration fails closed. Existing credentials must remain in their production environment; never export them.

The dedicated `private-zero-x-proof.vercel.json` is used only after separate exact-head owner authorization for one unaliased production-context build. Its build command intentionally exits unsuccessfully after the proof, preventing application promotion. Use the existing project's production environment in place and skip domain assignment; do not change its saved build-ignore rule or configuration. Upload an exact Git archive (LF source bytes), not the Windows working tree. Do not execute this package under preparation authority.

## Narrow output

Schema `RMT_BASIC_ROUTE_V1`, independently parseable JSONL; max 2048 bytes per record, 32768 bytes total, with 4096 reserved for completion records. Thirteen source fingerprints precede case/network output; these attest selected source bytes, not the entire deployed artifact. Order:

`PROOF_START`, `SOURCE_FINGERPRINT` records, `CASE_START`, `QUOTE`, ordered `ACTION` records, `FINAL_MINIMUM`, `CASE_END`, `PROOF_END`.

Every action emits only index, kind/selector and a conservative completeness flag. Only BASIC at index 3 additionally emits a closed field set: target/token/recipient roles, nested call selector and length, amount patch offset/bounds, whether patching preserves the selector, amount mode/ppm denominator/current-balance basis/rounding, native value behavior, Settler approval behavior, and safely decoded transfer destination where available. Other route changes do not silently retarget the collector.

`callSelector` describes bytes before amount patching; it is not the executed selector if patching overlaps those bytes. Unknown targets are stable SHA-256 `ROLE_HASH_` identifiers, suitable for comparing independently sourced candidate addresses. Their exact output asset, recipient behavior and extra authority remain UNKNOWN until independently proven. Target hashes alone may leave a further provenance gap. No arbitrary nested arguments or payload are emitted. Amounts are not presented as exact proportional fees without a known balance basis.

User addresses are role-only, including the user/treasury collision. Unknown addresses are hashed; raw calldata, provider bodies, URLs, credentials and session material are never output. The frozen in-memory capture is cleared after inspection. Optional observers have no HTTP/log output on the normal application path.

Each case/run has record counts and completeness/truncation markers. Oversized records/output stop emission with bounded loss markers; missing CASE_END or PROOF_END invalidates completeness. Never reconstruct lost evidence or rerun for prettier output. Structural completeness is distinct from semantic understanding and from verification success.

## Validation and next boundary

`pnpm --dir apps/web test:private-basic-proof` exercises synthetic privacy, roles, amount semantics, patch bounds, record/total bounds, loss detection, timeout, transport budgets, missing configuration and actual adapter/verifier mocked integration. In particular an unknown BASIC at index 3 still rejects with UNSUPPORTED_ROUTE while its sanitized evidence survives. These tests are not current-route evidence.

Before execution: independently review the exact PR/head, require unchanged main and required CI, verify cost controls and unaliased configuration, then obtain authorization for one private run. Afterward classify the observed integration from official provenance before any admission change. Do not ask the owner for another phone retry until a real repair is reviewed and released.
