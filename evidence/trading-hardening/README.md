# Trading hardening live read-only evidence

Base: `df77bafe05417426baff0ea139649e6d7be951ae`.

## Review artifacts

- `zero-x-50-token-matrix.json`: final 50 unique tokens, 100 Buy/Sell cases, four additional PEEP cases, full sampling population, source observations and Stock Token controls.
- `zero-x-50-token-matrix.csv`: the same 100 cases plus four separately indexed PEEP cases (`sampleIndex=0`).
- `zero-x-unfunded-baseline.json`: earlier unfunded experiment, not the final matrix or a simulation-pass claim.

Seed `5272840` (`0x507508`) reproduces the stratified selection. The final admitted window contains 512 eligible contracts from eight canonical pages plus exact-contract search admission of the existing curated bootstrap contracts. Primary evidence is sorted by protocol, version and pool identity. The sampled distribution is 13 V2, 19 V3 and 18 V4 tokens. There was no additional protocol bucket in the sampled population. Venue evidence is not execution authority: every route request uses the production `zero-x-swap` adapter and strict firm verifier.

The harness can use an earlier population manifest as discovery hints when the root directory is degraded. A hinted contract is never admitted from the manifest alone: current exact-contract search and the production canonical parsers must admit it again. The final run recovered indexed pagination and did not need this fallback.

## Outcomes, not blanket passes

The 100-case matrix returned 59 indicative routes and 59 strictly verified firm envelopes, 21 no-route responses, 18 responses rejected by the adapter, and two temporarily unavailable responses. The artifact records each exact contract and direction; rejection/unavailability is not represented as route support.

The public test identity has no funded balance. Its unmodified application simulation correctly reports insufficient balance. A separate diagnostic uses canonical RPC `eth_call` state overrides at a recorded block. Only ephemeral test-wallet native balance and, where needed, the exact input-token balance and exact AllowanceHolder allowance are changed. Token storage mappings require two distinct readbacks and a combined balance/allowance readback. Pool state, code, quote calldata, value, gas and gas price are not changed. No override is persisted, and this diagnostic grants no wallet authority.

57 exact-envelope funded diagnostic calls passed. Two sell cases (VANTRA and ONE) have unsupported token storage layouts and are explicitly **not** simulation passes. The other 41 cases did not reach a firm executable envelope. No failed or unavailable simulation is counted as a pass.

PEEP ETH Buy, ETH Sell and USDG Buy returned verified firm envelopes and passed funded read-only simulation. PEEP USDG Sell returned an adapter-rejected response, not an invented route. These observations are time-bound, not a promise of later route availability.

32 canonical Stock Token controls remained view-only with zero execution quote requests. Legacy executor calls, wallet requests, signatures and broadcasts were zero.

## Historical owner attempt

No exact owner PEEP transaction hash was recoverable from the available local evidence. The hash in the retained PEEP search result is a pool-creation transaction, not evidence of the owner's purchase. The owner's historical attempt remains `UNRECOVERABLE_WITH_AVAILABLE_EVIDENCE`; this PR does not manufacture a classification or alter its journal.

## Reproduction

From `apps/web`, run `pnpm proof:zero-x:50-token` with the already-authorized 0x credential supplied securely to the process. Never print it. The optional `RMT_MATRIX_DISCOVERY_MANIFEST` supplies discovery hints only. Live prices and inventory may differ; the frozen artifact's seed and population reproduce its sample exactly.

`node .github/scripts/trading-matrix-evidence-check.mjs` validates the frozen sample, all 100 direction bindings, recorded executable bounds, runtime hashes, exact diagnostic envelopes and stock controls without network access or credentials. It runs with the focused hardening tests in the existing terminal release suite.
