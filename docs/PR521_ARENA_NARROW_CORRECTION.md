# PR521 final narrow correction

Reviewed predecessor: `285c406a3952aa12ac2ddea91d4b070be68ea853`.
Base: `b88d8e5886bad08c04166e86640e48e10100d242`.

## Async test completion

The existing synchronous assertions remain unchanged. The entry point now awaits
the actual negative-route smoke in `main`, reports success only afterward, and
catches any rejection with explicit exit code 1. The smoke counts and asserts
32 completed cases (eight provider IDs by four configurations).

A bounded child-process regression injects an assertion failure inside the async
smoke after its 32 awaited cases. Node's automatic unhandled-rejection failure is
deliberately disabled in that child. The test requires explicit exit 1, the
injected failure marker, no success marker and no unhandled-rejection output.
The normal run executes 32 cases; the isolated failure-proof run executes another
32 before its expected failure. Neither run permits external requests.

## Fee presentation

The current wallet review did contain "Collected atomically in the 0x swap".
It now describes the fee as included in the verified execution plan and explicitly
states that treasury delivery is not independently reconciled. The displayed fee,
asset, treasury, 25-bps rate and nearest-integer-half-up calculation are unchanged.

RMT_FEE_SETTLEMENT_PROOF: BLOCKED.
AUTHORIZATION_TOCTOU_REVIEW: BOUNDED_PRE_DISPATCH_PASS.
Neither quoted fees nor bounded pre-dispatch checks prove state through mining.

## AllowanceHolder runtime-hash governance

ALLOWANCEHOLDER_RUNTIME_HASH_GOVERNANCE: INTENTIONAL_PRIVILEGED_CONFIGURATION.

The current source-boundary document
`RMT_ZEROX_ALLOWANCE_HOLDER_PUBLIC_EXECUTION_V1.md` explicitly requires verified
`RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH` configuration. The older foundation document
`VNEXT_ZEROX_SWAP_FIRM_QUOTE_VERIFICATION.md` also records independent runtime
verification before environment activation; its obsolete provider-release and
fee statements are historical, not current authority. No independently
source-pinned AllowanceHolder runtime hash was found in the inspected execution
authority or implementation. The source-pinned Settler hash is a different
contract and must not be substituted.

| Threat | Existing protection / limitation |
| --- | --- |
| Accidental environment misconfiguration | Missing/malformed hash disables configuration; a well-formed wrong hash fails actual bytecode comparison. The canonical address cannot be redirected. |
| Unauthorized environment mutation | Hash configuration is privileged release input, not evidence of an exploit by itself. Changing the hash alone cannot move the canonical address or make mismatching onchain code pass. A compromised configuration/RPC trust boundary remains a separate security concern; the source-pinned address is not claimed to protect all server compromise. |
| Legitimate reviewed runtime transition | Configuration does not perform independent human/source review. Any proposed runtime change still needs privileged reviewed release authority; matching a newly observed hash is not review. Inner Settler eligibility and reviewed runtime/decoder gates remain independent and unchanged. |

Adopting a new source-pinned AllowanceHolder runtime value would require a separate
owner-reviewed runtime-governance decision and provenance, not a speculative
value added in this narrow pass. No hash configuration, runtime allowlist,
environment, application execution policy or deployed contract was changed.

New Settler runtime admitted: NO. Production stabilized: NO.
No merge, deployment, real wallet request, signature, approval or transaction.
