# RMT paper market source and scheduler

**Status: PAPER ONLY — no execution authority**
**Admitted:** 2026-08-14

This document records the first concrete RMT market-evidence source and controlled scheduling boundary for agents.

## Reused RMT authorities

The paper worker does not invent a new market feed.

- Market evidence comes through the same normalized VNext market-directory contract used by the terminal: token address, price USD, liquidity USD, 24h volume/change, market cap, pair and DEX evidence where available.
- Canonical Robinhood-stock identity remains independent from market evidence. An RWA is admitted only when the directory token address is present and active in the complete Robinhood Stock Token registry snapshot already used by RMT's universal market resolver.
- The VNext trading quote endpoint remains wallet/recipient authenticated. The paper worker does not call it and this phase does not change its authentication.

This preserves the existing distinction:

```text
market exists / has liquidity
        !=
canonical Robinhood Stock Token
```

A community token using the same symbol as a stock token cannot enter the RWA paper source unless its exact contract address is the registry address.

## `RmtRobinhoodStockMarketSource`

The v1 source is intentionally RWA-only.

It:

1. reads the VNext directory through an injected read-only reader;
2. reads the Robinhood Stock Token registry snapshot through an injected read-only reader;
3. requires complete registry coverage;
4. validates active registry entries by exact nonzero contract address;
5. fails closed if two active registry entries expose the same token symbol;
6. filters directory rows by exact registered contract address;
7. applies `StrategySpec` include/exclude aliases and minimum liquidity only after registry identity is known;
8. rejects zero-price rows;
9. ranks matching markets by liquidity, then volume, then contract address;
10. caps the final observation count;
11. converts USD price/liquidity/volume/market-cap evidence to integer six-decimal atomic values before returning it to `PaperEvaluationService`.

The verified registry symbol is used as the v1 paper decision/prediction identifier for compatibility with natural-language ticker strategies. This does not make symbol the classification authority: the symbol becomes usable only after exact contract-address registry membership and duplicate-symbol checks.

`COMMUNITY` classification is not inferred as the complement of the stock registry. Mixed or community strategy scope is rejected by this source until a separately admitted community identity authority exists.

## Controlled scheduler

`PaperEvaluationScheduler` is deliberately a bounded `runOnce()` primitive rather than a permanent in-process timer.

For each catalog candidate it computes:

```text
interval_ms = StrategySpec.evaluationIntervalSeconds * 1000
slot_start = floor(now / interval_ms) * interval_ms
```

The logical evaluation key binds:

- agent ID;
- paper account ID;
- evaluation interval;
- current slot start.

Duplicate catalog rows collapse to one key. The scheduler caps both the candidate count and concurrency, runs only the current slot, and reports per-candidate fulfilled/rejected results without stopping unrelated evaluations.

The scheduler itself does not provide retry history or model replay. `PaperEvaluationService` + `AgentRunStore` remain authoritative for first-writer-wins replay of a logical evaluation key. Re-running the same slot therefore may call the service again, but the service reuses the stored canonical run before re-querying market/model adapters.

## Explicitly deferred

This phase does not add:

- a deployed cron/worker;
- a production database connection;
- a concrete model provider;
- community-token classification;
- an executable quote adapter;
- paper order sizing/generation;
- live trades;
- wallet/signing authority;
- fee activation.

The next execution-adjacent paper phase must reuse VNext normalized quote semantics without bypassing the existing authenticated trade endpoint. Paper fills remain simulations and must stay separate from wallet submission.
