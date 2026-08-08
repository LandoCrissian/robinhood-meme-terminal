# RMT Terminal VNext Migration Boundary

Status: proposed delivery sequence; no production routing change

## Objective

Move RMT from a Robinhood ETH↔token, displayed-pair-centered terminal to a chain-aware account, portfolio, asset-to-asset execution, and settlement architecture without interrupting live Sushi or Uniswap trading.

This is not a big-bang rewrite. Existing production remains available until VNext reaches state parity and its individual release gates pass.

## Branch and release isolation

- VNext work branches from current production `origin/main`.
- PR #313 and `codex/sushi-deadline-guard-current` remain an independent contract-deployment track.
- VNext does not deploy, enable, or route through the Sushi deadline guard.
- V7 contracts, Position Guard automation, fees, treasury execution, advanced orders, cross-chain, NFT settlement, and RWA authorization remain separate gates.
- A provider-specific outage must not disable directory discovery or another provider.

## Preserve, adapt, replace

### Preserve and adapt

- existing Uniswap transaction-integrity decoding and exact target/recipient/output checks;
- Sushi request authentication, runtime verification, quote freshness, simulation, balance, allowance, and failure recovery;
- trade diagnostic redaction;
- execution recovery concepts;
- route protected-output comparison tests;
- chain-aware treasury evidence and immutable accounting separation;
- public directory caching and stale-state disclosure.

These become adapter/verifier/reconciler inputs. Their current provider-specific UI contracts do not become the VNext shared model.

### Replace behind parity

- fixed `TradeVenueId` unions;
- buy/sell models that infer WETH or native ETH from side;
- execution identity based on displayed token/pair/venue;
- local journal schema locked to chain 4663 and one transaction hash;
- portfolio scanning limited to the V6 launch list;
- fixed 18-decimal portfolio formatting;
- one generic unavailable route state;
- desktop/mobile feed implementation split;
- global cascade of terminal stylesheet generations.

### Do not reuse

- provider raw responses as shared client state;
- a global Permit2, router, reactor, or approval spender;
- symbol-based asset equality;
- displayed market pair as execution authorization;
- pending proceeds as Spend Balance;
- automatic route retry after wallet interaction;
- implicit fee or treasury behavior.

## Delivery slices

### Slice 0 — foundation contracts and ADRs

- provider-neutral domain contracts and state reducer;
- architecture, UI ownership, benchmark, and migration decisions;
- pure smoke tests;
- no runtime import from production routes.

Exit: typecheck and domain tests pass; documents agree on non-goals.

### Slice 1 — unified VNext shell

- development-only VNext route or disabled flag;
- one semantic component tree;
- account/available/pending visual shell;
- directory, market item, workspace, and trade-composer fixtures;
- no live provider execution.

Exit: required state fixtures pass mobile/desktop visual and accessibility review.

### Slice 2 — optimistic directory

- fast directory payload separated from route verification;
- cached route hints labeled as hints;
- requested asset identity/search available before execution audit;
- meaningful delayed/stale/error states;
- no provider quote fanout on cards.

Exit: shell usable within the product budget and existing discovery coverage preserved.

### Slice 3 — portfolio and Spend Balance reads

- chain-specific wallet account model;
- canonical asset registry and verified decimals;
- wallet-held asset detection beyond the launch feed;
- spam/unknown visibility controls;
- settled/pending/reserved balance model;
- USDG valuation and deposit experience;
- no credit and no automatic movement.

Exit: independently reconciled onchain balances; pending value never spendable.

### Slice 4 — existing provider adapters

- map existing direct Uniswap and Sushi quotes into VNext candidates;
- preserve provider-specific verification unchanged at first;
- decouple displayed price source from selected execution;
- upgrade execution journal for asynchronous-capable settlement records;
- keep current production ticket available as rollback.

Exit: output, fee, target, simulation, submission, confirmation, and recovery parity.

### Slice 5 — read-only provider benchmark

- dedicated server/CLI harness;
- 0x and 1inch server-only credentials;
- UniswapX service-readiness probe;
- PCSX RWA-only classification unless public policy changes;
- reproducible report and minimal-provider recommendation.

Exit: evidence-backed provider admission proposal; still no new wallet authorization.

### Slice 6 — one admitted provider

- one adapter and one provider-specific verifier;
- disabled production flag;
- adversarial fixtures and runtime allowlist monitoring;
- preview UX for synchronous/asynchronous lifecycle;
- separately authorized small-value canary.

Exit: provider release checklist and operations owner sign-off.

### Slice 7 — dollar-first capital loop

- default supported sells to USDG;
- default supported buys from settled USDG;
- quick dollar amounts;
- confirmed settlement refreshes Spend Balance;
- buy-another continuation;
- alternative settlement asset selector only for verified routes.

Exit: end-to-end sell→confirmed USDG→buy flow passes mobile and desktop with recovery.

## Compatibility seam

During migration, adapters translate existing quote outputs into `ExecutionCandidate` only after validating asset identity and economics. The translation is one-way:

```text
legacy provider quote
        |
        v
provider adapter validation
        |
        v
VNext candidate summary
        |
        v
existing provider-specific exact verifier
        |
        v
VNext authorization plan
```

The VNext shared model never generates legacy calldata or orders. This lets security-critical verifier code remain narrow while product state becomes provider neutral.

## Feature controls

Use separate, fail-closed controls for:

- VNext shell exposure;
- portfolio enrichment;
- Spend Balance actions;
- each provider quote adapter;
- each provider authorization adapter;
- provider fee capability;
- policy-restricted asset classes.

Quote enablement and authorization enablement are different controls. A provider can participate in internal benchmarking without becoming visible or executable.

Controls default off until their release slice is complete. Position Guard remains off by default.

## Rollback

- Directory and portfolio reads degrade to their last confirmed snapshot with a visible stale state.
- Provider failure removes only that provider's candidate.
- If VNext authorization is disabled, current verified production routes remain unchanged.
- Pending settlements continue reconciliation even when new quote/authorization controls are disabled.
- Rollback never deletes execution records, retries a transaction, cancels an order implicitly, or changes allowance.

## Testing strategy

### Pure contract tests

- chain-specific identity;
- asset mismatch rejection;
- canonical atomic amounts;
- warning/blocker separation;
- quote and authorization expiry;
- illegal state transitions;
- pending versus settled Spend Balance.

### Provider contract tests

- fixtures from documented response schemas;
- unknown-field/type behavior;
- target/spender/domain changes;
- recipient/input/output/fee mutations;
- expiry, replay, and payload-hash changes;
- provider outage and malformed response.

### End-to-end tests

- mobile and desktop state parity;
- connected external wallet;
- USDG buy and token→USDG sell;
- approval required/not required;
- synchronous confirmation;
- asynchronous open/fill/expiry;
- unknown transaction result and later recovery;
- stale balance and valuation;
- provider fallback without directory interruption.

## Definition of migration complete

Migration is complete only when:

1. mobile and desktop use one terminal component tree;
2. legacy terminal stylesheet generations have no production references;
3. portfolio detects owned assets independently of the V6 launch directory;
4. USDG Spend Balance distinguishes settled and pending value;
5. input/output assets are explicit throughout quote and authorization;
6. displayed market source is decoupled from execution;
7. admitted providers use independent adapters, verifiers, credentials, targets, and kill switches;
8. settlement recovery supports transactions and asynchronous orders;
9. current Sushi/Uniswap safety and availability are not regressed;
10. no unapproved fee, bridge, contract, treasury, or automation behavior exists.
