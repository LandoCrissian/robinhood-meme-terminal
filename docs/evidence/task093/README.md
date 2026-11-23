# Task 093 worker acceptance

The recovered production worker is `3b6e5b24-7589-4135-b023-a0aa87bea011`. The failed handoff recorded four consecutive HTTP 503 responses from Railway readiness, authenticated discovery and the Netlify discovery route. Railway identified a resource-unavailable JSON-RPC error. The previous logs did not capture the upstream HTTP status, method or provider, so they cannot establish that the production error was an HTTP 429.

In an isolated replay of the old worker, a 429 on the factory activity log query produced four consecutive 503s from readiness, health and discovery. Registration held its busy flag across the activity scan. The scheduler repeated both operations up to 16 times and legacy reads had their own RPC transports. The candidate gives activity its own loop, makes each feed's state visible and shares one paced request slot per provider. The original advisory lease owns every write. A registration request can finish at its verified checkpoint across ordinary extension. Reorg, expiry, missing database evidence and mismatched market checkpoints still close the relevant read path.

During a longer live-RPC replay, Pocket returned JSON-RPC `-32000` with `invalid block range params` for the 54-block registration query at 120719331–120719384. The identical request succeeded on that provider afterward. The worker retries this exact response once only for an explicit, ordered `eth_getLogs` range of at most 2,000 blocks. Exhaustion reports an upstream delay. An invalid range, missing state, provider disagreement or unverified checkpoint cannot advance the feed.

Pocket also returned a null header at block 120721298 after reporting sufficient head height. A numbered header read now gets the same bounded retry on the same provider. If either provider still cannot produce the header, verification stops at the last committed range.

| Check | Result |
|---|---|
| Worker HTTP with PostgreSQL 18.6 | 17 fresh discovery checks. Activity received 429, 503, timeout and JSON-RPC resource errors. Health and readiness stayed 200 during those checks. An unauthenticated market read returned 401 and an authenticated read returned 503 during catch-up. The restarted worker resumed the stored checkpoint under one lease. |
| Full backlog | Both deterministic providers covered every block in 3,841,624 blocks. PostgreSQL committed 3,842 checkpoints, including the final partial range. A mid-run restart preserved the cursor. This uses an accelerated RPC fixture and measures coverage, not live throughput. |
| Live public data | The corrected component used isolated PostgreSQL and the verified empty production registration catalog. Robinhood and Pocket independently confirmed 17 successive activity checkpoints from the factory deployment to block 116852101, including the last failed worker's cursor at 116849101. The registration checkpoint advanced from 120722283 to 120723319. All 68 concurrent registration reads returned fresh evidence. |
| Trading history | The PostgreSQL market suite checked the existing deployed-contract fork receipts at every recorded checkpoint and interval, including sellback, pending graduation, the pool transition, reorg replacement and disconnection. The public factory currently has no indexed token whose live fills can be checked. |

[Measured results](acceptance.json) · [Live boundary replay, checkpoints and request counts](live-boundary.json) · [Receipt-based chart evidence](../token-market/production-candidate/receipts.json)

## Railway candidate

Use the CI indexer artifact's `worker.tar`, `source.txt` and `SHA256SUMS`. The build remains `pnpm install --frozen-lockfile && pnpm --filter indexer build`. Reuse the current worker service, one replica, existing authenticated read bindings and the installed Migration 092 schema. No dependency installation changes or additional service are required.

| Setting | Default | Accepted range |
|---|---:|---:|
| `RMT_INDEXER_RPC_SPACING_MS` per provider | 400 ms | 350–2,000 ms |
| `RMT_INDEXER_ACTIVITY_BLOCKS` per pass | 1,000 | 1–2,000 |
| `RMT_INDEXER_ACTIVITY_INTERVAL_MS` between passes | 5,000 ms | 1,000–60,000 ms |

Allow one wire request in flight per provider, one retry on transient errors and a jittered cooldown. Historical discovery processes at most one range of up to 1,000 blocks per cycle. Activity sleeps after each range and backs off after failures. At the default interval, 3,842 ranges require more than five hours even before RPC latency, retries and new blocks. Check `feeds` on readiness and health for durable progress, lag, timing and RPC counters.

Obtain approval for this exact worker and a temporary discovery interruption. Drain the recovered deployment, observe zero lease holders, then start the candidate. Verify one writer, advancing canonical discovery in Netlify and Railway, isolated activity delays, and stable provider load. If existing discovery repeatedly becomes unhealthy, drain the candidate, verify zero holders, redeploy the recovered image and confirm two advancing hosted checkpoints. The rollback image digest is `sha256:a0168b9f3a5b27bff8b25d772d703cac02617408afc0e41924b12264e8321d3f`.

Hold website promotion pending a current authenticated activity checkpoint. A token-specific market response also requires a genuine published registration. Creation, trading and claims require separate acceptance and authorization.
