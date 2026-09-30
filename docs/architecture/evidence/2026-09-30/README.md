# Evidence boundaries

All source inspection is tied to authorized main `41cbc27029dfffad07ee71e97c3052d9d5d0cabb`. Proposed watch-scope behavior is tested separately from deployed configuration. No secrets, provider bodies containing credentials, private accounts, wallet requests or financial RPC calls are retained.

| Artifact | Evidence class | Meaning |
| --- | --- | --- |
| `public-rpc-probe.json` | READ_ONLY_PUBLIC_RPC |21 bounded HTTP requests,22 logical calls;20 single requests and one two-read batch. Contains public contract/block references and sanitized outcomes/latencies, no signing/sending.8s deadline; no natural timeout observed. Not an Alchemy comparison or production wallet-session test. |
| `alchemy-published-support.json` | PUBLISHED_OFFICIAL_DOCS | Public chain-specific feature table on2026-09-30, network `ROBINHOOD_MAINNET`. Product/method support flags are published capability claims, not measured entitlement/equivalence. No docs-demo key used. |
| `rpc-source-calls.json` | SOURCE | Actual helper call locations across five app families; excludes smoke/test/acceptance names. Includes dormant modules, offline scripts and generic `.call`/`.request` sites requiring interpretation. The audit tables identify active/dormant families. Counts are not traffic. |
| `railway-live-scope.json` | READ_ONLY_CONFIGURATION | Existing application source/watch metadata and variable **names**, plus five image-backed PostgreSQL services. No secret values or destructive/API mutations. |
| `railway-watch-baseline.json` | SOURCE | Exact `railway.json` files read using `git show` at the authorized base. Used by the regression to preserve all non-watch settings and demonstrate previous trigger behavior. |

Run from repository root: `node --test scripts/railway-watch-scope.test.mjs`. The existing indexer CI job runs it at the PR head. It tests tracked production source, recursive workspace dependencies/exports, root lock/package inputs, own build/config inputs, unrelated apps, documentation, fixtures and shadow-only changes.29 tests passed locally. CI check links provide exact-head results; no financial/browser fixture is involved.

All latency measurements are single samples, not percentiles/SLA. All user/cost forecasts in the report are labeled assumptions; observed current configuration overrides, invoices and provider account quotas remain unknown when values/access were unavailable.
