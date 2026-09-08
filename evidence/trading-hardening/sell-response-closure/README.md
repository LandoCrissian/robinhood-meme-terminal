# PR 508: response reasons, fee rounding and native trace boundary

Base: `df77bafe05417426baff0ea139649e6d7be951ae`.
Starting PR head: `3a8bc7f8ee266c0f350a477334df93888df8c00c`.
Production, wallet journals, fee admission and ordinary RPC configuration are unchanged.

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
| Sell | 12 | 21 | 15 | 2 |

Of 56 firm envelopes, 54 passed the existing exact-envelope funded `eth_call`.
Two Sell storage layouts (VANTRA and ONE) remain unsupported, not passes. The
ordinary unfunded test identity cannot authorize these swaps. Ephemeral diagnostic
funding grants no wallet authority and changes no transaction envelope or pool.

PEEP ETH Buy, ETH Sell and USDG Buy also passed firm verification and read-only
simulation, outside the 100-row matrix. PEEP USDG Sell remains rejected for an
integrator fee one atomic unit above RMT's canonical floor. All current invalid
responses have explicit bounded reasons: 14 `WRONG_INTEGRATOR_FEE_AMOUNT` and two
`MISSING_INTEGRATOR_FEE` in the matrix. Wrapping/unwrapping WETH omits the RMT fee.
Historical CRUMBS and MONID invalid amounts now return no route; those historical
reasons cannot be reconstructed from a newly absent quote.

## Controlled rounding observations, not permission to change fees

`fee-rounding.json` and `.csv` contain 44 queries: two repetitions over native ETH,
18-decimal PEEP and 6-decimal USDG, including zero/small/midpoint/large remainders,
both midpoint parities, and the original PEEP USDG Sell amount.

42 returned fee observations all match nearest-integer half-up:
`floor((sellAmount * 25 + 5000) / 10000)`.
Two requests were temporarily unavailable and contribute no rounding evidence.
Only 18 observations match floor and 30 match ceiling; this is NOT a ceiling rule.
The maximum observed absolute rational deviation is 5000/10000 = 0.5 atomic units.
Half-up can exceed the existing integer floor by one atomic unit. For 18 decimals,
half an atomic unit is 0.0000000000000000005 tokens; for 6 decimals it is 0.0000005.

The [official 0x monetization guide](https://docs.0x.org/evm/0x-swap-api/guides/monetize-your-app-using-swap)
documents the proportional formula but no explicit integer rounding/tie rule was
found. Live behavior is not an authoritative contractual specification. No fee
admission change was made. Owner review is required before changing the canonical
atomic fee rule to admit responses that do not match the current floor.

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
`dedicated-native-trace-proof.json` records that no dedicated endpoint was supplied
to this process. No provider URL or token is included in artifacts. Supplying the
server-only endpoint and obtaining live proof remain required before release.
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
