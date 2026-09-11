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

As explicitly requested, cross-page address/asset and canonical market duplicates
fail. The pool-paginated runtime can legitimately repeat an asset with additional
pool evidence: such a response fails this stricter monitor, not proof of a trading
regression. This PR neither deduplicates that failure away nor changes runtime.
Within one page a pool may support both token identities, but duplicate evidence
within one asset is rejected. Quarantine is checked across the entire collection.

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
