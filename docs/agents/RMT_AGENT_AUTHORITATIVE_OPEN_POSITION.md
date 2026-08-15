# RMT Agent Authoritative Open-Position Admission

Status: implemented paper-only foundation on `codex/agent-engine-foundation`. This document does not authorize deployment, live execution, wallet signing, or capital custody.

## Problem closed

The low-level `PaperOpenPositionAdmissionService` accepts a `PaperRiskSnapshot` and current Agent/account records from its caller. That is useful as a deterministic domain primitive, but it is not a sufficient trust boundary for an Arena or autonomous runner: a caller could attempt to supply stale or selectively constructed risk evidence before invoking the primitive.

The authoritative Agent path removes those values from the caller-facing input. A caller supplies only:

- the immutable Arena entry;
- the canonical `OPEN_POSITION` Agent run;
- request/admission timestamps.

RMT derives the account, Agent, strategy, risk snapshot, and valuation history from authoritative stores.

## Shared canonical risk source

`PaperCanonicalRiskSnapshotService` is participant-neutral and is now used by both:

- `HumanCanonicalRiskSnapshotService` with `participantType = HUMAN`;
- `AgentCanonicalRiskSnapshotService` with `participantType = AGENT`.

The output record shape and hash contract used by the existing Human service are preserved. Human and Agent risk therefore use the same implementation for:

- current engine revision and state-hash binding;
- canonical account identity and balance binding;
- canonical liquidation NAV;
- conservative position exposure as `max(cost basis, liquidation value)`;
- total portfolio exposure;
- open-position count;
- rolling trade count;
- rolling daily-loss basis points;
- peak-to-current drawdown basis points;
- canonical SHA-256 evidence hashing.

A valuation is rejected when it belongs to another stream, account, quote asset, participant, or season; moves backward in time/revision; or does not match the current persisted engine revision and state hash.

## Canonical admission layer

`AgentCanonicalOpenPositionAdmissionService` receives explicit valuation records and composes the existing deterministic primitives:

```text
canonical Agent run
        +
canonical Arena entry
        +
canonical valuation records
        ↓
shared PaperCanonicalRiskSnapshotService
        ↓
current Agent / strategy / account from engine snapshot
        ↓
PaperTradeRequest
        ↓
PaperRiskCapacityPlanner
        ↓
BLOCKED | immutable PaperOrderAdmission
```

The resulting `AgentCanonicalOpenPositionAdmissionRecord` retains both the canonical risk source and the full admission chain. Validation proves that:

- entry Agent/account identity equals the run identity;
- target asset equals the canonical `OPEN_POSITION` target;
- admission risk evidence exactly equals the derived risk source;
- Agent, account, and strategy snapshots used for capacity are the current snapshots embedded in the canonical source;
- the complete result is independently hash-bound.

The model's historical account snapshot remains evidence only. It is never current spend authority.

## Authoritative history layer

`AgentAuthoritativeOpenPositionAdmissionService` obtains valuation records directly from `PaperCanonicalValuationHistoryStore`. It adds explicit continuity policy:

- the first valuation must begin within `maximumValuationGapMs` of Arena entry;
- every subsequent valuation gap must remain within that maximum;
- valuations must remain strictly increasing;
- the latest valuation cannot be from the future;
- the latest valuation must be within `maximumLatestValuationAgeMs` of the request;
- the exact history is represented by `valuationHistoryDigest`;
- request time must equal the canonical trade-request time.

If the engine revision changes after the last valuation—even because of an unrelated mutation—the request fails closed until a new canonical valuation is recorded for the current state.

## Required integration rule

Any Arena runner or future autonomous paper worker that increases Agent risk must call `AgentAuthoritativeOpenPositionAdmissionService` rather than directly constructing a `PaperRiskSnapshot` for `PaperOpenPositionAdmissionService`.

The low-level service remains available for deterministic unit composition and compatibility, but it is not the admitted external trust boundary.

## Verification

`.github/workflows/agent-authoritative-open-position-smoke.yml` runs:

1. the existing Human canonical-risk smoke through the shared source;
2. the legacy low-level Agent admission smoke;
3. the authoritative Agent admission smoke.

The focused smoke covers successful admission, canonical zero-exposure sizing, current account binding, valuation-history digesting, tamper rejection, stale latest valuation rejection, valuation-gap rejection, and rejection after the engine advances beyond the latest valuation revision.

## Explicitly absent

This slice adds no:

- paper-order submission side effect;
- simulated fill side effect;
- production worker or timer;
- MCP write tool;
- private key, signer, wallet instruction, or transaction submission;
- live trading authority;
- fee activation;
- contract deployment;
- claim that paper performance authorizes real capital.
