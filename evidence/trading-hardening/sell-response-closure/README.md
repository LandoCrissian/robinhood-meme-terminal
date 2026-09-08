# PR 508: response reasons, fee rounding and native trace boundary

Base: `df77bafe05417426baff0ea139649e6d7be951ae`.
Starting PR head for final closure: `af21da49785a0901add1ea19ca631f74ce9a47bd`.
Production, wallet journals and ordinary RPC configuration are unchanged.
The owner authorized nearest-integer half-up atomic realization of the unchanged
25-bps sell-token fee. `zeroXIntegratorFeeAmount` is the shared calculation used by
the price parser, firm verifier, fee/plan binding, tests and evidence harness.
Missing fees, wrong tokens and any amount other than this exact result remain rejected.

## Corrected frozen matrix

`matrix.json` and `matrix.csv` preserve seed 5272840 and the original 50 contracts.
All 50 plus PEEP were re-admitted by current exact-contract canonical search. Fresh
Buy output supplies the paired Sell amount, where available. Original invalid
amounts are separately replayed, not substituted with hand-picked successes.

The corrected harness supplies both `nowMs` and `deadlineSeconds`. The earlier
run without these fields is not firm or simulation evidence. Final results:

| Direction | Firm envelope verified | No route | Fee-policy rejected | Provider unavailable |
|---|---:|---:|---:|---:|
| Buy | 44 | 5 | 1 | 0 |
| Sell | 24 | 21 | 1 | 4 |

Of 68 firm envelopes, 65 passed the existing exact-envelope funded `eth_call`.
Three storage-layout simulations remain unsupported, not passes. The
ordinary unfunded test identity cannot authorize these swaps. Ephemeral diagnostic
funding grants no wallet authority and changes no transaction envelope or pool.

All four PEEP directions passed firm verification and read-only simulation outside
the 100-row matrix. The two remaining policy rejections are `MISSING_INTEGRATOR_FEE`
for WETH wrapping/unwrapping. There are no unexplained current matrix responses.

`pre-half-up-matrix.json` preserves the actual preceding run unchanged. Its 14
fee mismatches are replayed at their exact original amounts in
`previousFeeMismatchCases`: 13 reached firm verification, one was temporarily
unavailable, and none returned a fee mismatch. Their extra simulations are separate
from the 100-case totals: 11 passed, two storage layouts were unsupported.

The original PEEP -> USDG amount `46344563744511694555819` now has exact canonical
and returned fee `115861409361279236390`, versus floor `115861409361279236389`.
The fresh paired PEEP -> USDG trade also passed firm verification and simulation.

## Controlled rounding observations and authorized atomic policy

`fee-rounding.json` and `.csv` contain 44 queries: two repetitions over native ETH,
18-decimal PEEP and 6-decimal USDG, including zero/small/midpoint/large remainders,
both midpoint parities, and the original PEEP USDG Sell amount.

39 returned fee observations all match nearest-integer half-up:
`floor((sellAmount * 25 + 5000) / 10000)`.
Five requests supplied no fee observation and contribute no rounding evidence.
Only 16 observations match floor and 29 match ceiling; this is NOT a ceiling rule.
The maximum observed absolute rational deviation is 5000/10000 = 0.5 atomic units.
Half-up can exceed integer floor by one atomic unit. For 18 decimals,
half an atomic unit is 0.0000000000000000005 tokens; for 6 decimals it is 0.0000005.

The [official 0x monetization guide](https://docs.0x.org/evm/0x-swap-api/guides/monetize-your-app-using-swap)
documents the proportional formula but no explicit integer rounding/tie rule was
found. The authority for this atomic rule is the owner's explicit product-policy
decision, not an inferred provider specification. No fee-bps or fee-token change
was made, and arbitrary floor-plus-one admission is not permitted.

## Dedicated native trace authority

`RMT_SETTLEMENT_TRACE_RPC_URL` is server-only. The new client can request chain
identity, the exact transaction receipt before/after tracing, and callTracer for
one valid hash. It cannot quote, authorize, sign, broadcast or proxy arbitrary RPC.
The normal application RPC remains independent transaction/receipt authority.

The authenticated endpoint requires a linked wallet and its successful, zero-value
AllowanceHolder transaction. Independent receipt block identity must match the
trace source. The browser additionally checks its saved plan/payload, exact
sender/target/calldata/value, native output and protected minimum before requesting
trace evidence and again before settling. Only positive net recipient delivery at
or above the protected minimum can settle; reverted subcalls grant no credit.

HTTP response size, JSON depth/object count, duplicate keys, call depth/node count,
JSON-RPC IDs/version/result shape, and total timeout are bounded. Calldata and raw
provider errors are discarded; only normalized call values/addresses and root
calldata hash cross the server boundary. Credentials/endpoint are never returned.

[QuickNode documents Robinhood callTracer support](https://www.quicknode.com/docs/robinhood/debug_traceTransaction),
but documentation and deterministic fixtures are NOT live endpoint proof.
`dedicated-native-trace-proof.json` records a successful live public-documentation
control through the actual production trace client: chain 4663, successful receipt,
callTracer, bounded normalization and matching receipt block before/after tracing.
The control uses the already-mined ETH -> USDG canary and is NOT native-output
settlement proof. Bounded discovery did not establish a suitable native-output
transaction, so live 0x native settlement is explicitly NOT_AVAILABLE. Exhaustive
deterministic production-verifier tests remain separate positive settlement proof.
The documented endpoint was used only in an ephemeral development process. No
Production endpoint was provisioned and no CI/Production configuration changed.
No provider URL or token is included in artifacts.
`native-trace-capability.json` separately preserves the old ordinary-RPC method-not-
found result; it is not confused with the new dedicated client's capability.

## Reproduction

From `apps/web`, with existing credentials supplied securely to the process:

```sh
pnpm exec tsx scripts/zero-x-sell-response-closure.ts
pnpm exec tsx scripts/zero-x-fee-rounding-proof.ts
pnpm exec tsx scripts/zero-x-settlement-trace-proof.ts
pnpm test:trading-hardening
pnpm exec tsx lib/vnext/zero-x-adapter-smoke.ts
```

The live trace script can use `RMT_SETTLEMENT_TRACE_PROOF_TX_HASH` for an already-
mined public native-output control, or bounded existing explorer hash discovery.
Its reconstructed public capability record is never written to a wallet journal.
No real wallet requests, signatures, approvals or transactions were performed.
