# RMT Agent Authoritative Open-Position Execution

Status: implemented paper-only foundation on `codex/agent-engine-foundation`. This document does not authorize deployment, live execution, wallet signing, or capital custody.

## Problem closed

The low-level Agent entry primitives accept values from their caller:

- `PaperOpenPositionAdmissionService` accepts a `PaperRiskSnapshot` plus Agent/account snapshots;
- `PaperOrderSubmissionService` accepts an inner order admission;
- `PaperFillOrchestrationService` accepts an inner order-submission record.

Those are useful deterministic domain components, but they are not sufficient external trust boundaries for an Arena runner. A caller could otherwise attempt to construct selective risk evidence or discard the authoritative valuation proof after admission.

The authoritative Agent path removes those choices from the runner-facing workflow. RMT derives and retains the account, Agent, strategy, risk snapshot, valuation history, order authorization, quote, and fill evidence across the complete paper-entry chain.

## Shared canonical risk source

`PaperCanonicalRiskSnapshotService` is participant-neutral and is used by both:

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

## Authoritative valuation-history layer

`AgentAuthoritativeOpenPositionAdmissionService` obtains valuation records directly from `PaperCanonicalValuationHistoryStore`. It adds explicit continuity policy:

- the first valuation must begin within `maximumValuationGapMs` of Arena entry;
- every subsequent valuation gap must remain within that maximum;
- valuations must remain strictly increasing;
- the latest valuation cannot be from the future;
- the latest valuation must be within `maximumLatestValuationAgeMs` of the admitted order time when admitted, or request time when blocked;
- the exact history is represented by `valuationHistoryDigest`;
- request time must equal the canonical trade-request time.

If the engine revision changes after the last valuation—even because of an unrelated mutation—the request fails closed until a new canonical valuation is recorded for the current state.

## Proof-bound paper-order submission

`AgentAuthoritativeOpenPositionSubmissionService` accepts only an `AgentAuthoritativeOpenPositionAdmissionRecord` whose inner result is `ADMITTED`.

Before creating a paper order, it rechecks:

- the persisted engine revision equals the admitted revision;
- the persisted engine state hash equals the admitted state hash;
- the durable writer is synchronized to that same revision;
- the current canonical valuation-history digest is unchanged from authorization;
- every order-intent field exactly equals the inner immutable order admission.

Its idempotency key is derived from the **authoritative admission hash**:

```text
agent-paper-open-position:<authoritative-admission-result-hash>
```

This prevents a runner from stripping off the valuation-history authorization and submitting only the lower-level order admission. Retries resolve through the durable engine mutation log and return the same `PENDING` order even after the successful submission advances engine revision.

## Authoritative guarded fill

`AgentAuthoritativeOpenPositionFillService` accepts only the proof-bound authoritative submission. It requires:

- a `PENDING` paper order;
- strictly verified RMT quote evidence matching input asset, output asset, and exact input amount;
- Arena quote asset as the order input;
- the admitted canonical position asset as output;
- quote time at or after order creation;
- price impact within the immutable strategy's `maximumPriceImpactBps`;
- a `READY` `PaperFillCostPlan` with exact fee/gas evidence;
- a returned fill matching the order, quote, provider, protected output, timestamp, evidence hash, and costs exactly.

The fill idempotency key binds:

- order ID;
- authoritative submission hash;
- authoritative admission hash;
- quote-evidence hash;
- cost-plan hash.

The resulting fill record retains the entire authorization → submission → quote → cost → fill chain under its own canonical hash.

## Required integration rule

Any Arena runner or future autonomous paper worker that increases Agent risk must use this chain:

```text
AgentAuthoritativeOpenPositionAdmissionService
        ↓
AgentAuthoritativeOpenPositionSubmissionService
        ↓
AgentAuthoritativeOpenPositionFillService
```

Direct construction of a `PaperRiskSnapshot`, direct use of the inner `PaperOrderAdmissionRecord`, or direct fill from the generic submission record is not the admitted external Agent trust boundary.

The low-level services remain available for deterministic unit composition and compatibility. They do not grant runner authority by themselves.

## Verification

`.github/workflows/agent-authoritative-open-position-smoke.yml` runs:

1. the existing Human canonical-risk smoke through the shared source;
2. the legacy low-level Agent admission smoke;
3. the authoritative Agent admission smoke;
4. the authoritative Agent admission → submission → guarded-fill smoke;
5. the public export smoke.

The execution smoke verifies:

- successful canonical admission from zero exposure;
- exact NAV-bps sizing and current-account binding;
- rejection when valuation history changes after admission;
- proof-bound order idempotency and replay;
- authorization-hash tamper rejection;
- strategy price-impact rejection before fill mutation;
- guarded successful fill and replay;
- final paper balances and position cost basis;
- absence of signer or live-execution methods.

The same execution smoke is imported by `all-foundation-smoke-v2.ts` so the broader Agent/Arena foundation continuously covers the authoritative increase-risk path.

## Explicitly absent

This slice adds no:

- production worker, daemon, or timer;
- automatic decision-to-order loop;
- MCP write tool;
- private key, signer, wallet instruction, or blockchain transaction submission;
- live trading authority;
- fee activation;
- contract deployment;
- pooled capital or custody;
- claim that paper performance authorizes real capital.

All order and fill side effects described here are confined to the deterministic paper engine.
