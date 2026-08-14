# RMT paper order submission boundary

**Status: PAPER ONLY — durable `PENDING` order mutation, no quote/fill/wallet authority**
**Admitted:** 2026-08-14

`PaperOrderSubmissionService` is the first layer in the agent path that is allowed to mutate the durable paper engine, and its capability is intentionally narrow.

It accepts only a complete, validated `PaperOrderAdmissionRecord`. It does not accept free-form token addresses, amount, slippage, account, agent or strategy fields.

## Submission flow

```text
validated PaperRiskCapacityPlan
        ↓
immutable PaperOrderAdmissionRecord
        ↓
PaperOrderSubmissionService
        ↓
DurableAgentEngine.submitPaperOrder
        ↓
PENDING paper order
```

The service derives its idempotency key deterministically:

```text
paper-order-admission:<admissionId>
```

The caller cannot choose that key.

A retry of the same admission therefore reaches the durable engine under the same mutation identity and must resolve to the same canonical paper order.

## Exact writer contract

The paper writer is supplied only the intent already contained in the validated admission.

The returned order is accepted only when:

- status is exactly `PENDING`;
- agent ID matches the admitted intent;
- strategy version matches;
- account ID matches;
- input/output asset IDs match;
- atomic input amount matches exactly;
- maximum slippage matches;
- creation timestamp matches.

A writer that alters any admitted field is rejected.

## Self-contained evidence

`PaperOrderSubmissionRecord` retains:

- the complete immutable admission record;
- the deterministic idempotency key;
- the canonical returned `PENDING` paper order;
- a canonical SHA-256 `submissionHash`.

Validation rechecks the full admission evidence and the exact admission-to-order mapping before accepting the submission record.

## Explicitly absent

This service has no:

- market quote request;
- paper fill method;
- balance mutation beyond the existing engine's pending-order record;
- signer/private key;
- wallet authorization;
- arbitrary calldata;
- RPC write;
- live transaction path;
- production fee activation.

The next paper-only step is a fill-orchestration boundary that waits for the configured paper-fill delay, obtains fresh strictly verified quote evidence, proves that evidence matches the pending admitted order, and refuses to fill until fee/gas cost accounting is explicit. It must remain separate from all wallet submission paths.