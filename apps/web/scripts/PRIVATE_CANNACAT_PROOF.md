# One-shot CANNACAT route evidence — preparation only

Base: `41b8e24f276f12fa739376488b192fc55912bbd0`.
No production execution is authorized by this document or PR. Obtain separate
owner authorization for the exact reviewed head before invoking the collector.
Do not merge this diagnostic preparation into production to collect evidence.

## Scope and source reuse

This adapts the existing PR528/PR530 private collector, JSONL writer and structural
inspector. It calls the actual current adapter, provider wrapper, firm verifier,
deployment authority and executable-minimum decoder. PR533's bounded decoder
failure carrier is included without its public route/client/logging changes.
No route is newly admitted; no fee, runtime, simulation or authorization gate is
weakened. No second quote engine or verifier is introduced.

The exact historical owner envelope/amount was not retained. The proposed new
observation is **1 USDG (1000000 atomic) → CANNACAT**, chain 4663, with the previous
public proof identity (RMT treasury) as taker/recipient. It does not reproduce the
owner's wallet state or claim to reconstruct their historical route. The output
uses `USER_RECIPIENT_AND_RMT_TREASURY` for that role collision, never a literal
user wallet. USDG is `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`; CANNACAT is
`0x1139d423C1706BDeaD91f03507F521635591eD92`.

## Hard bounds and execution boundary

- One indicative request is necessary to supply the existing verifier's actual
  protected output floor. Maximum **one price + one firm quote**; transport
  failure consumes the attempt. No reprice/retry or changed asset/amount.
- Existing identity/project/Stock Token preflight remains enforced.
- At most 64 fetch-transport JSON-RPC reads, single or bounded batches:
  `eth_chainId`, `eth_blockNumber`, `eth_getBlockByNumber`, `eth_getCode`,
  `eth_call`, `eth_getBalance`, `eth_gasPrice`, `eth_estimateGas`.
  An approval simulation, if reached, is read-only and cannot submit approval.
- At most 16 other fetch GET/HEAD reads for existing admission authorities.
  Non-RPC POSTs, other methods and write RPC methods are rejected.
- CLI process deadline: 180 seconds. Dependency installation/build setup is
  outside that process deadline. No recurring work, transaction, wallet request,
  authorization commitment, customer write or credential transfer is implemented.
- Run only inside the existing authorized production environment with credentials
  in place. Never use `env pull`, print environment values or export credentials.

The dedicated `private-zero-x-proof.vercel.json` is opt-in: its build command runs
`pnpm exec tsx scripts/private-zero-x-proof.ts --execute-read-only; exit 1`.
The deliberate failing build prevents publishing an application even if the
observation succeeds. Use the existing project and production environment with
`--skip-domain` and this per-deployment `--local-config`, only after exact-head
owner authorization. Do not promote, alias, change normal saved Ignore Build Step,
environment or budgets. Verify the execution host's actual CLI options before
the authorized operation. Never rerun automatically. Existing Pro/$20/pause and
Railway $20 controls remain unchanged; metered cost is not estimated in dollars.

## Output and limits

Independently parseable JSONL schema `RMT_CANNACAT_ROUTE_V1`:

1. `PROOF_START`, then **all 12 source fingerprints before network/case records**.
2. `CASE_START` (`USDG_TO_CANNACAT`).
3. `QUOTE`: HTTP result, target/allowance roles, value, calldata hash, decoded
   Settler, runtime/block/registry evidence if reached, verifier classification,
   `envelopeReason`, `envelopeFunction`, `actionIndex`, `actionKind`.
4. Ordered `ACTION` records: index, kind/unknown four-byte selector, semantic
   family, token/recipient/target roles, amount mode/numerator/denominator,
   balance basis, rounding, hook/manager classification, sell/buy balance effects,
   and semantic completeness. Selected packed-route summaries expose no payload.
5. `FINAL_MINIMUM` when structurally decoded; `CASE_END`; `PROOF_END`.

Maximum record **2048 UTF-8 bytes**, total collector output **65536 bytes**,
maximum **64 actions**, with 8192 bytes reserved for end records. A record that
does not fit is omitted whole, not sliced; end markers explicitly report counts,
omissions and truncation. Platform logs have separate limits: validate extracted
JSONL with `validateProofJsonl`. Missing/mutated/redacted records invalidate stream
integrity. Never reconstruct missing records. Output completeness does not imply
semantic completeness or successful execution verification.

The in-memory capture occurs before parser rejection and freezes copied primitive
fields; it cannot mutate provider data. Early rejection can therefore retain the
action sequence while runtime/minimum verification remains `null`/not reached.
It never retries or bypasses a rejection to obtain later evidence. HTTP 200 is not
verification. Structural interpretation is not runtime admission or settlement.

Unknown addresses are stable SHA-256 `ROLE_HASH_...` identifiers. Raw calldata,
arbitrary action arguments, paths/fills/hook payloads, cookies, provider response
bodies, credential-bearing URLs and user-wallet literals are never emitted.
Only explicitly selected numeric ABI slots/roles are retained. The exact quoted
Settler is allowed, unless it collides with the redacted user role.

Fingerprints hash the executing file bytes, not the entire deployment or all
dependencies. Compare against the authorized Git tree using the same line
endings: prepare the future source upload from `git archive` (LF Git bytes), not
an unrelated Windows worktree with automatic CRLF conversion. Preserve the normal
project root and locked dependency/configuration files. No fingerprint claims
full uploaded-artifact attestation.

## Structural source references and limits

Inspector arithmetic/packing refers to official source commit
`1df908742d38cf407f667df6518dae6e04a01ac3`:
[ISettlerActions](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/ISettlerActions.sol),
[V2](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/core/UniswapV2.sol),
[V3](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/core/UniswapV3Fork.sol),
[V4](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/core/UniswapV4.sol),
[Infinity](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/core/PancakeInfinity.sol).
Unknown route targets, output assets omitted from calldata, hooks and unresolved
action semantics remain unknown. These summaries do not independently prove a
route safe. No assumed route has been added to production acceptance logic.

## Validation and next decision

`pnpm --filter web test:private-cannacat-proof` exercises synthetic action shapes,
actual adapter/verifier mocked transport, immutable pre-parser capture, rejected
runtime/route capture, sanitization, request caps, failed-attempt consumption,
write-RPC prohibition, record loss/redaction/bounds and process deadline handling.
The suite runs inside required web CI via `test:vnext-adapters`. These are UNIT /
MOCKED_INTEGRATION tests, not live quote evidence.

After the separately authorized single observation, preserve sanitized records
and classify the actual rejection. Only then propose/implement explicit safe
route support, combining useful PR533 diagnostics in one final repair PR. Keep
PR520/528/529/530/533 untouched and unmerged during preparation. No owner phone
retry until an actual safe fix is ready.
