# RMT Execution Provider Benchmark

Status: specification only; all benchmark activity is read-only

## Purpose

RMT will not select providers by brand count. A provider earns production integration by materially improving protected net outcome, route coverage, gas abstraction, reliability, or a policy-specific use case.

The benchmark runs outside terminal startup. It performs no approval, signature, order submission, transaction, deployment, fee collection, treasury action, or bridge action.

## Current evidence snapshot

| Provider | Robinhood evidence | Current benchmark position |
| --- | --- | --- |
| Sushi | Existing RMT quote/execution path | Baseline; preserve current production boundary |
| Uniswap direct | Existing RMT V3/V4 route paths | Baseline; preserve exact transaction verification |
| UniswapX | Robinhood V3 Dutch reactor, quoter, and Uniswap Permit2 deployed; service rollout and filler readiness require proof | Benchmark only after production quote service is confirmed |
| 0x | Official Swap API and Gasless API support for chain 4663 | Priority candidate; API key required |
| 1inch | Official Classic and Intent/Fusion support for chain 4663; cross-chain marked unsupported for Robinhood | Priority candidate; API key required |
| Pancake direct | Official V2/V3, Smart Router, and Universal Router deployments | Benchmark if high-level providers do not already cover meaningful Pancake liquidity |
| PancakeSwapX | Official Router/Quoter/PCS Permit2 deployments; public chain-4663 probe currently restricts swaps to pairs containing an RWA | Specialized RWA research candidate, not a general meme route today |
| KyberSwap | Product availability requires current verification | Optional only after priority candidates |

Contract presence proves neither service availability nor safe execution. Proxies require implementation resolution and monitoring.

## Required credentials and isolation

- Provider API credentials are server-only environment variables.
- The benchmark fails clearly when a credential is absent; it does not silently omit a provider from denominator calculations.
- Logs redact credentials, authorization headers, full payloads, and wallet identifiers.
- Use a dedicated non-funded benchmark address when a provider requires a taker field.
- Never use a private key or signature.
- Provider responses are retained only as redacted fixtures where vendor terms permit.

No 0x or 1inch key was configured in the repository or process environment during the 2026-08-07 foundation review. Their live quote rows therefore remain unmeasured, not failed.

## Representative asset matrix

All addresses, decimals, policy eligibility, and route legality must be revalidated immediately before a run.

### Core directions

- USDG → liquid Robinhood asset;
- liquid Robinhood asset → USDG;
- WETH → liquid Robinhood asset;
- liquid Robinhood asset → WETH;
- USDG → newer meme asset;
- newer meme asset → USDG;
- asset-to-asset path that does not use native ETH as the user-facing input or output.

### RWA directions

Run only in an appropriate policy environment with a current eligibility review:

- USDG → permitted RWA;
- permitted RWA → USDG;
- comparison of 1inch/Rialto-related coverage and PCSX RWA intent availability where independently proven.

### Notional sizes

Use atomic units derived from verified decimals and a fresh valuation source:

- approximately $10;
- $50;
- $100;
- $500;
- $1,000;
- larger sizes only when market depth makes the result meaningful.

Do not treat thin-asset failure at an unrealistic notional as equivalent to normal retail-route failure.

## Run design

1. Freeze a run manifest containing provider versions, chain, asset registry revision, pair list, sizes, slippage policy, timestamps, and credentials-present flags.
2. Warm only shared network/DNS connections. Do not warm provider quote caches with unrecorded pair calls.
3. Randomize provider request order within each sample.
4. Fan out providers concurrently using independent abort signals.
5. Record time to headers, time to validated response, and timeout separately.
6. Validate response schema before recording economic fields.
7. Normalize assets and atomic amounts before comparison.
8. Mark indicative and executable quotes separately.
9. Repeat across multiple periods to expose provider/filler intermittency.
10. Publish aggregate results plus failure taxonomy, not cherry-picked winners.

Recommended initial timeout budget:

- first useful feedback in the UI: 250 milliseconds;
- soft provider comparison budget: 1,500 milliseconds;
- hard benchmark timeout: provider-specific, capped and recorded;
- late candidates can be shown as alternatives only if still fresh and the user has not begun authorization.

These are test hypotheses until measured. They are not production promises.

## Normalized observation

Each provider observation records:

- run and sample ID;
- provider, family, adapter version, and endpoint mode;
- chain and canonical input/output asset keys;
- trade type and atomic amount;
- request start, validated response time, quote time, and expiry;
- availability state: executable, indicative-only, no route, policy restricted, timeout, provider error, invalid response, or unverified;
- expected and protected output;
- provider, RMT, network, bridge, and liquidity fee lines without double counting;
- gas payer and approval requirement;
- authorization kind and declared spender/settlement target;
- route sources when supplied;
- settlement mode and provider estimate;
- verifier result code without exposing raw authorization payload;
- redacted response fingerprint.

`fillProbabilityEvidence` is not emitted as a fabricated percentage. Until sufficient production outcomes exist, record observable evidence such as recent successful fill count, sample window, order mode, and provider estimate source.

## Metrics

Per provider and segment:

- quote availability percentage;
- executable-quote percentage;
- P50/P95/P99 validated latency;
- timeout and invalid-response percentage;
- best expected-output win percentage;
- best protected-output win percentage;
- protected net-outcome win percentage where common valuation is reliable;
- gasless coverage percentage;
- unique route coverage;
- incremental coverage over the admitted provider set;
- approval-required percentage;
- expiry-window distribution;
- later canary fill, confirmation, fallback, and recovery rates.

Results must include confidence intervals or at least sample counts. A provider cannot earn production access from one favorable quote.

## Comparison policy

Comparison has two stages.

### Eligibility

Reject candidates with:

- schema or asset mismatch;
- stale/future quote;
- missing protected output;
- unverified target/spender/domain/order structure;
- invalid or undisclosed fee;
- failed required simulation;
- hard policy blocker.

### User-mode ranking

Do not collapse unlike execution into one unexplained score.

- Recommended: protected net outcome within a configured tolerance, then reliability and settlement time.
- Best price: highest protected net outcome with clear asynchronous-fill disclosure.
- Fastest: shortest evidence-backed settlement estimate within a maximum protected-output sacrifice.
- Lowest gas: smallest user-paid network cost within a maximum protected-output sacrifice.

All tolerances are versioned policy, covered by tests, and disclosed. Gross provider marketing output never wins by itself.

## Provider admission gate

A provider is eligible for an implementation proposal only when:

1. it adds meaningful incremental value in measured segments;
2. official chain/API support and exact production targets are verified;
3. authorization semantics can be decoded and independently verified;
4. rate limits, terms, credential handling, and outage behavior are acceptable;
5. latency fits request-time fanout without delaying the terminal directory;
6. a kill switch can remove it without disabling existing providers;
7. maintenance/security cost is proportionate to incremental value.

The admission proposal must state what provider can replace or whether it adds a genuinely distinct execution network. More adapters are not inherently better.

## Report template

```text
Run ID / date / code revision
Chain and registry revision
Credential availability
Pair and notional coverage
Sample counts

Provider summary
- availability
- validated latency P50/P95
- protected net wins
- gasless coverage
- unique routes
- verifier failures
- operational caveats

Recommended minimal set
Deferred providers and why
Unresolved security/policy questions
No-write assertion
```

## Stop conditions

Stop a provider's benchmark immediately if it requests a signature, approval, funded wallet, private key, order submission, unexpected external redirect, or value-moving transaction. Stop the full run if asset identity, chain identity, or response redaction cannot be trusted.
