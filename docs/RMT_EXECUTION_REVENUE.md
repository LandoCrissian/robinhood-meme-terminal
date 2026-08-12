# RMT execution revenue

**Status: CURRENT — implementation program; production collection disabled**

## Approved policy direction

The owner has approved implementation support for the first forward terminal execution-fee policy:

| Field | Value |
| --- | --- |
| Policy ID | `RMT_EXECUTION_V1` |
| Version | `1` |
| Fee | 25 basis points (0.25%) |
| Rounding | floor in atomic units |
| Minimum fee | none |
| Allocation | 100% RMT operations |
| Eligible origin | independently proven RMT-originated executions only |
| Initial settlement assets | canonical Robinhood USDG and WETH/native-compatible settlement, subject to exact provider admission |

This policy direction does **not** activate collection. Production remains disabled until an exact public treasury, effective block boundary, provider-specific settlement implementation, complete wallet disclosure, settlement proof and explicit release authorization all exist.

Across funding, wallet transfers, failed transactions, quote requests and unrelated transactions are not eligible. V6 economics, Stonk/up allocations, PoH allocations, subscriptions, hidden spread, positive-slippage capture and automatic fee-conversion swaps are not part of this policy.

## Canonical domain

`apps/web/lib/vnext/execution-fee-policy.ts` owns the provider-neutral fee policy and normalized net-execution math.

A complete policy binds:

- policy ID and version;
- fee basis points;
- exact treasury;
- chain and effective block boundary;
- authenticated RMT execution origin;
- chain-qualified eligible settlement assets;
- the 100% RMT-operations allocation;
- one deterministic policy hash.

No treasury is embedded in the repository. The `RMT_EXECUTION_V1` descriptor is deliberately incomplete until an exact public treasury and effective boundary are supplied. A policy missing either cannot produce a valid commitment.

Every indicative provider observation now carries explicit net economics. While collection is disabled, its commitment is structurally `disabled`, exposes no policy or treasury authority, carries zero expected/maximum fee and leaves gross/provider/net amounts unchanged. A bare hard-coded zero is not accepted as the normalized RMT fee model.

## Net execution math

### Input-side fee

For buys whose canonical settlement asset is the input:

```text
fee = floor(userGrossInput × feeBps / 10,000)
providerInput = userGrossInput - fee
```

The provider quote must be calculated for `providerInput`. The fee and provider execution must later settle atomically through an admitted provider-specific implementation.

### Output-side fee

For sells whose canonical settlement asset is the output:

```text
expectedFee = floor(providerGrossExpectedOutput × feeBps / 10,000)
expectedUserNetOutput = providerGrossExpectedOutput - expectedFee
protectedFee = floor(providerProtectedOutput × feeBps / 10,000)
protectedUserNetOutput = providerProtectedOutput - protectedFee
```

The wallet-authorized maximum fee is explicit. Tiny trades may produce a legitimate zero fee through floor rounding. There is no minimum fee.

## Provider separation

One normalized commitment supports provider-specific settlement modes. It does not create a generic arbitrary-call executor.

Planned settlement identities are:

- `rmt-direct-executor-v1`;
- `uniswapx-order-output-v1`;
- `zerox-integrator-fee-v1`.

These identifiers describe bounded settlement families, not active providers. Uniswap V3 receives the first separately reviewed executor. up-v2 and up-cl require their non-fee production proofs first. Sushi must be reconciled with the separate deadline-guard track. UniswapX and 0x require their own admitted wallet execution and native fee semantics.

## Review sequence

1. Versioned policy, normalized commitment and net math — no collection.
2. Narrow non-upgradeable Uniswap V3 fee executor and adversarial/fork tests — no deployment.
3. Server quote, strict verification and fee-bearing authorization — gates off.
4. Client pre-sign verification and fee disclosure — gates off.
5. Receipt reconciliation, exactly-once settlement proof and finality/reorg accounting.
6. Deployment verification and controlled proof tooling — no public activation.

Production revenue is not booked from a quote or plan. It exists only after a successful, final, unambiguous settlement proves exactly one authorized fee to the exact treasury.

## Current release state

- Policy implementation: foundation present.
- Production treasury: not configured.
- Fee executor: not implemented or deployed.
- Fee-bearing authorization: not implemented.
- Fee disclosure: not implemented.
- Fee settlement ledger: not implemented.
- Provider fee gates: off/not present.
- Production fee collection: disabled.

The older disabled Uniswap fee capability is compatibility code, not authorization to activate revenue and not the canonical VNext revenue architecture.
