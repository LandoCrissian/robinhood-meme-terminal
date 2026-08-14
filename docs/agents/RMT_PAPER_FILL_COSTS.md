# RMT paper fill cost accounting

**Status: PAPER ONLY — deterministic simulated cost ledger, no fill/wallet authority**
**Admitted:** 2026-08-14

`buildPaperFillCostPlan()` converts a validated `RmtPaperQuoteResult` into the exact separate costs, if any, that the paper engine may debit in addition to the quote's protected token output.

## Accounting invariant

VNext quote semantics define protected output as user-protected net token output. Paper accounting therefore must not debit provider/RMT route fees a second time.

For every ready cost plan:

```text
feeAmountAtomic = 0
feeAssetId = undefined
```

The quote's `protectedOutputAtomic` remains the paper token credit.

## Wallet-paid network gas

VNext represents Robinhood native ETH as a native EVM asset. The paper string key mirrors VNext's `assetKey()` convention:

```text
eip155:4663/native
```

When the selected quote says the user pays gas:

- if `networkFeeNativeAtomic` is known, the plan is `READY` and that exact amount is a separate debit from `eip155:4663/native`;
- if the network fee is still unknown, the plan is `BLOCKED_NETWORK_FEE_PENDING` and exposes no guessed `PaperExecutionCosts`.

Zero is accepted only when the quote explicitly reports a zero network fee; missing is never treated as zero.

## Sponsored / intent gas

When the selected VNext attempt states that the user does not pay network gas, the plan is `READY` with:

```text
feeAmountAtomic = 0
gasCostAtomic = 0
```

No synthetic gas debit is created.

## Evidence

The cost plan binds:

- quote result hash;
- quote evidence hash;
- selected-attempt hash;
- route-fee accounting basis;
- native gas asset and amount when applicable;
- exact `PaperExecutionCosts` when ready;
- canonical SHA-256 cost-plan hash.

Validation may be performed again with the full quote result, which recomputes quote integrity and proves the selected network-gas evidence.

## Explicitly absent

This layer has no:

- order mutation;
- paper fill mutation;
- network-fee estimator;
- wallet signer;
- transaction submission;
- live execution;
- fee activation.

The next layer may orchestrate a paper fill only when the pending order, immutable admission/submission evidence, fresh strictly verified quote, and `READY` cost plan all agree exactly.