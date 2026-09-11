# PR520 monitor-only reconciliation

Base: `943b718a672601b65604221d2081c93df59b5483`.
Prior PR: #520, head `a0d6b12305cff4a00491ed7b8e37a8d3cbb3e8ec`.
The prior branch/worktree is preserved, not rebased or updated.

## Prior-file disposition

| Prior file | Still required | Main equivalent | Text conflict | Monitor only | Port |
| --- | --- | --- | --- | --- | --- |
| .github/workflows/production-readiness.yml | YES | NO | NO | YES | YES, replace one continuation with bounded collection |
| scripts/production-monitoring-schedule-smoke.mjs | YES | NO | NO | YES | YES, new collector assertion |
| scripts/terminal-health-boundary-smoke.mjs | YES | NO | NO | YES | YES, new collector assertion |
| scripts/verify-production-health-smoke.mjs | YES | NO | NO | YES | YES, replace overlapping fixtures and add adversarial sequences |
| scripts/verify-production-health.mjs | YES | NO | NO | YES | YES, extend page validation to collection validation |

## Explicit successor allowlist

The five paths above plus `scripts/collect-production-directory.mjs` and this
document are the entire write allowlist. No application, directory runtime,
trading, fee, wallet, environment or deployment behavior changes are authorized.
The workflow retains its schedule, permissions, public URLs and timeout.

## Evidence boundary

A pass means the observed directory and existing health/search contracts pass
monitor validation. It never means universal coverage or trading, quote, wallet
or execution authorization. Any observed partial page makes aggregate coverage
partial, even when the final cursor is null. A terminal cursor is not complete
identity coverage. The eight curated search controls remain; eight is not the
required directory size.

The collector follows returned cursors unchanged, sequentially, without identity
enrichment, credentials or upstream indexer access. It allows at most eight pages,
90 seconds of continuation collection, 15 seconds per fetch and 2 MB per response.
Exhaustion fails as incomplete; it never manufactures terminal success. The
existing workflow timeout remains an additional bound. Evidence is saved before
validation so failure diagnostics survive.

Cursor v2, chain 4663 and unfiltered query bindings are pinned to the current
market-indexer server contract. Descending block/log coordinates must strictly
progress. Unknown versions, loops, changing filters and backward coordinates fail.
The monitor observes and follows cursors; it never generates or rewrites them.

### Asset-scoped successor reconciliation

Successor base: `0b3a3262a12a7bb2bc79284a66385af5d32aae22`.
Saved live run `34654888636` failed under the original strict cross-page duplicate
rule. Its two partial pages contain 17 and 20 asset observations; five assets recur
with distinct additional pools. Classification: `STRICT_MONITOR_DUPLICATE_FALSE_NEGATIVE`.
This is historical captured evidence, not a new live Production rerun.

Upstream `directoryMarketsFromCanonicalPools` associates each pool with both its
token0 and token1 assets. Duplicate authority is therefore asset-scoped:
`normalizedAssetAddress:sourceId:poolKey`, not global pool-key uniqueness.
Coherent repeated assets union distinct canonical pool evidence. Repeated evidence
for the same asset/pool fails `CROSS_PAGE_DUPLICATE_MARKET_EVIDENCE`, including after
intervening pages. A shared pool under different assets is valid if it binds both
assets and its immutable canonical metadata agrees. A global metadata map checks
consistency only, never rejects a pool merely because another asset uses it.
Mutable live pool telemetry is not treated as immutable identity.

Each asset retains one normalized address/assetId/verified-address and exact verified
name, symbol and decimals. Cross-page conflicts fail
`CROSS_PAGE_ASSET_IDENTITY_CONFLICT`; no page silently wins. Quarantine remains
collection-wide. Within-page duplicate evidence remains invalid.

The collector still records raw pages before validation; aggregation never edits
them or hides a rejected duplicate. `observedMarkets` counts raw asset occurrences,
`uniqueAssets` counts aggregated assets, and `assets` exposes coherent identities
and their union of asset-scoped canonical pools. Coverage and cursor semantics are
unchanged: repeated assets never imply complete coverage or trading authorization.

This successor changes only the monitor verifier, its smoke tests and this document.
Collector code, workflow behavior and all application/runtime boundaries remain
unchanged. No live rerun is authorized before independent PR review.

Known identity-enrichment failures may accompany truthful partial coverage.
Explicit inventory/classification errors, unknown reasons, false-empty pages,
curated fallback, malformed identities and cached continuation pages cannot pass.
Fresh RPC/health and exact-address/text-search controls remain independent gates.

## Validation commands

```sh
node scripts/verify-production-health-smoke.mjs
node scripts/production-monitoring-schedule-smoke.mjs
node scripts/terminal-health-boundary-smoke.mjs
node scripts/production-health-smoke.mjs
git diff --check
```

These are deterministic monitor tests, not a live Production acceptance claim.
Unchanged CI and secret-scan workflows supply remote exact-head validation.
No merge or deployment is authorized.
