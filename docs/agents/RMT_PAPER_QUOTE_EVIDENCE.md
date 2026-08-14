# RMT paper quote evidence boundary

**Status: PAPER ONLY — read-only quote evidence, no order/fill/wallet authority**
**Admitted:** 2026-08-14

`RmtPaperQuoteService` is the execution-adjacent boundary between the agent engine and RMT's existing VNext quote normalization. It deliberately stops before paper-order creation, fill accounting, wallet authorization or transaction submission.

## Input contract

The service accepts a `RmtPaperQuoteReader` that returns an already-normalized VNext-style comparison response for Robinhood Chain (`chainId = 4663`). The reader is injected; this phase does not connect a production HTTP endpoint, provider SDK, signer, wallet or API key.

The response is treated as untrusted at the agent boundary and is rechecked for:

- exact requested input/output token addresses;
- exact input amount;
- chain ID 4663;
- bounded request/completion timestamps;
- 1–8 unique provider attempts;
- supported VNext providers only;
- `adapterVersion = 1`;
- positive expected/protected output for indicative routes;
- protected output not exceeding expected output;
- one consistent output-decimal domain;
- finite price impact in `[0, 1]`;
- valid quote/expiry timestamps;
- `authorizationReady = false`;
- explicit gas-payer semantics;
- no partial economics on unavailable attempts.

## Route selection

Paper selection is intentionally stricter than simple discovery ranking.

A candidate must be:

1. `indicative`;
2. `strictVerificationAvailable = true`;
3. within the configured quote-age limit;
4. within the configured maximum price-impact limit.

Among eligible candidates, the service chooses:

1. highest `protectedOutputAtomic`;
2. lowest latency;
3. provider ID as deterministic final tie-breaker.

A higher-output route that is not strictly verifiable is rejected in favor of a lower-output verified route.

## Paper evidence mapping

The selected VNext observation becomes `VerifiedPaperQuoteEvidence` using:

- canonical input asset ID: `eip155:4663/contract:<lowercase-address>`;
- canonical output asset ID: `eip155:4663/contract:<lowercase-address>`;
- exact requested input amount;
- **protected** output amount, never optimistic expected output;
- provider identity `rmt-vnext:<provider>:adapter-v1`;
- price impact rounded **up** to integer basis points;
- quote observation and expiry timestamps;
- deterministic quote ID;
- canonical SHA-256 evidence hash.

The overall adapter result is independently hash-bound as well.

## Cost boundary

This phase does **not** translate VNext provider/network economics into `PaperExecutionCosts`.

That is deliberate. VNext protected output already represents user-protected economics, while wallet gas, gas sponsorship and provider fee semantics vary by route. Creating a separate fee/gas debit before that accounting contract is proven could double-count costs and corrupt paper performance.

The quote result therefore reports only whether wallet network cost is still pending versus no separate cost ledger. A future paper-fill layer must define and test the exact cost basis before calling `fillPaperOrder`.

## Explicitly absent

`RmtPaperQuoteService` has no:

- `submitPaperOrder` method;
- `fill` method;
- `execute` method;
- wallet authorization codec;
- signer/private key;
- transaction payload;
- RPC write;
- live execution path;
- fee activation;
- production quote-reader deployment.

The next phase may design deterministic paper-order sizing and complete fill-cost accounting, but it must remain separated from wallet submission and must not promote paper evidence into live execution authority.