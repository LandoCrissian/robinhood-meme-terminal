# RMT paper order admission boundary

**Status: PAPER ONLY — immutable intent evidence, no order mutation or wallet authority**
**Admitted:** 2026-08-14

`buildPaperOrderAdmission()` is the pure boundary between an admitted `PaperRiskCapacityPlan` and a future durable paper-order submission service.

It does not submit, fill or execute an order.

## Admission prerequisites

A paper order may be admitted only when:

1. the supplied capacity plan independently passes `assertPaperRiskCapacityPlan()`;
2. capacity status is exactly `ADMITTED`;
3. `admittedInputAmountAtomic` exists and is exactly equal to the originally requested amount;
4. the admitted amount does not exceed `maximumInputAmountAtomic`;
5. the capacity plan carries no blocking reasons;
6. the admission occurs at or after the capacity-plan timestamp;
7. the capacity plan is no older than the explicit admission-policy freshness window.

There is no automatic resize path. If a strategy requests 50 units while current risk capacity is 40, the risk plan is blocked and order admission fails. A future caller must make a new explicit 40-unit request if it wants to trade 40.

## Exact intent binding

The resulting `PaperOrderIntent` is derived without model discretion from the admitted evidence:

- `agentId` = capacity-plan agent;
- `strategyVersion` = capacity-plan strategy version;
- `accountId` = capacity-plan paper account;
- `inputAssetId` = capacity-plan quote/input asset;
- `outputAssetId` = capacity-plan position asset;
- `inputAmountAtomic` = exact admitted/requested amount;
- `maximumSlippageBps` = admitted strategy slippage bound;
- `createdAt` = admission timestamp.

`assertPaperOrderAdmissionRecord()` rejects any mismatch between those fields and the capacity evidence.

## Auditability

Each record retains the entire capacity plan and its hash.

The record also carries:

- deterministic `admissionId` bound to schema version, policy version, freshness window, capacity-plan hash and exact intent;
- canonical `admissionHash` over the complete admission record except the hash itself.

Both hashes are recomputable. Tampering with the intent, amount, account, strategy, assets, timestamps or underlying capacity evidence fails validation.

## Explicitly absent

This boundary has no:

- `submitPaperOrder` call;
- durable order mutation;
- fill method;
- quote request;
- signer/private key;
- wallet authorization;
- transaction payload;
- RPC write;
- live execution;
- fee activation.

The next paper-only layer may persist and submit an already-valid admission through `DurableAgentEngine.submitPaperOrder` with an idempotency key derived from the immutable admission. That service must not accept free-form order fields and must remain unable to submit a live transaction.