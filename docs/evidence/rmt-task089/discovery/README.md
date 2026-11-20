# Task 089: production discovery handoff

**Exact live fallback trigger: UNKNOWN. No production action is approved by this evidence.**

At 2026-11-20 14:08 UTC, the ordinary public historical API still returned
`verified-snapshot / stale` at block **113899119**, dated November 14.
The current Railway health response independently reported historical ingestion
**119107514**, latest block **119107534**, lag 20, and a caught-up new-engine
checkpoint **119107193** at **14:07:32 UTC**. An advancing worker checkpoint does
not make a checked-in fallback fresh or activate the separately gated new-engine
reader.

[Normal reads](normal-reads.json) contain only three GET summaries, body hashes,
fixed response headers and public checkpoint fields. No Authorization header,
credential, transaction, protected read or write was sent. The supplied
`capture-readonly.py` is a future repeat-capture utility; the first observation
was captured by the equivalent inline standard-library command. It refuses to
overwrite an earlier output and limits repeats to these three documented URLs,
25 seconds/read, 128 KiB/read, no redirects and no retries.

## What is established and what is not

[Provider metadata](provider-metadata.json) binds:

- Unchanged Netlify deployment `6afd4265956a469adeb55747`, production/ready.
  The provider has no `commit_ref` for this manual artifact. Its title identifies
  Task071/PR666 and source `4fdfbecd`. Its actual server ZIP SHA-256
  `f8f7c3cd291bf95d9e088e71f0e5c1c4a617613e3c72c349c8c551f58800032d`
  exactly matches the retained Linux artifact identity in
  `docs/RELEASE_ACCEPTANCE.md`; this is stronger than the title alone.
  The published function remains Node 22 / Next adapter 5.16.8.
- The normal request `01M7WMJ8TXCD5FYN5NQZRB31F4` traversed the server
  function (4.552 seconds), yet returned the same old snapshot. Durable-cache
  metadata reported stale/store and TTL -4598. Cache is a contributor, not a
  demonstrated sole cause; this request actually invoked the function.
- The new-engine API returned **404 / unavailable**, with durable cache bypass.
  In the source bound to that reviewed artifact, this response precedes its
  authenticated read and can result from profile, fixture or request-authority
  rejection. It does not demonstrate an upstream 401 or invalid schema.
- The Netlify current site-variable listing decoded twice to an empty array.
  Targeted team reads returned exactly `No env var found matching key` for the
  read credential and discovery profile. These are current configuration
  observations, **not proof of the environment frozen into this function
  version**. No secret value or secret fingerprint was exposed or used.
- Railway deployment `b48f0e6e-a34b-4a26-b95f-d4b978562282` remains successful,
  one replica and no staged changes. The worker's read-token variable name is
  present; its value and a match to the website credential are not established.
  In the bounded **14:07–14:10 UTC** HTTP log window, the only observed request
  was our `/health`; no historical/new-engine protected request was observed.
  Log absence and timing cannot prove whether the reader failed before sending,
  used another endpoint, hit transport failure or encountered another condition.

| Candidate cause | Source/fixture evidence | Live conclusion |
| --- | --- | --- |
| Frozen/missing/wrong function configuration | Existing reader rejects absent/invalid credential or origin before fetching. | Current lists are empty; frozen function values are not exposed by the available connector read operations. **Unknown.** |
| Endpoint or bearer-header failure | Exact HTTPS origin, canonical historical/new-engine paths and Bearer header are tested; missing/wrong synthetic credentials fail closed. | No production credential was retrieved or manually replayed. **Unknown.** |
| Schema or historical merge rejection | Old reader catches failures silently; old historical merge rejects already-reflected lifecycle receipts. Task088 repaired this pinned synthetic reproduction. | No authenticated live response body was inspected. **Unknown as the live trigger.** |
| Historical fallback | Reviewed artifact source returns checked-in verified history after any failed live read; public response matches its stale snapshot block. | **Established response mechanism**, not its initiating failure. |
| CDN reuse | Old API admits verified snapshots to 15-second durable cache; actual stale/store metadata corroborates. Task088 excludes snapshot caching. | **Established contributor**; not sufficient to explain the function's fallback selection. |
| New-engine gate | Route exists but the reviewed implementation rejects disallowed profile/fixture/authority with 404 before reading Railway. | **Pre-read rejection** is consistent with the artifact; the individual frozen gate input remains unknown. |
| PostgreSQL/worker freshness | Public health reports current independent cursors. | **Advancing** at the observation; this does not authenticate website-to-worker continuity. |

The available connector reads expose deploy/function identity and current
configuration, not that published Lambda version's frozen environment or a
categorized old-reader fallback. The prior normal CLI log observation also
contained no category. No restriction was bypassed and no hidden diagnostic
route, alternate credential or provider was tried. A separately approved
diagnostic-code/configuration deployment is the minimum remaining live
investigation boundary. Task088's tested code is **not deployed**.

## Narrow nondeployed diagnostic correction

The Task089 candidate changes only
`apps/launch-website/lib/server/production-discovery.ts` and its tests:
the existing identical profile/fixture/authority predicate now produces fixed
server-only `profile_disabled`, `fixture_active` or `authority_rejected`
categories before its existing 404. The handler forwards the same diagnostic
callback into its authenticated reader. All categories reuse the existing
shared one-per-minute server-log budget. No caller, URL, header value, body,
exception text, environment value or credential enters a category.

There is no new route, secret, flag, public response field, header, permission
or network fallback. Disabled routes still return 404/unavailable/no-store and
never invoke the backend; authorized reads preserve Bearer authentication,
origin admission, no redirects, byte bounds and schema/freshness checks.

Tests-first evidence retained **three failures** from 21 production-reader tests
(18 passed). After correction, **47 focused discovery tests passed** and the
complete website suite passed **327/327**, zero failures/skips; website
typecheck also passed. The earlier 44-test unchanged baseline is retained.
Exact commands, source digests and compressed raw outputs are bound by
`manifest.json`. These are synthetic-credential source tests, not live
credential continuity or a published artifact. Root Task089 evidence separately
records real Next/PostgreSQL/browser acceptance and exact-head CI.

## Minimum rollout proposal — NOT APPROVED

1. Review the final Task089 commit and exact Linux artifact manifest/CI,
   including server ZIP, static and edge digests. The final go/no-go document
   supplies those identities; do not deploy an unbound working tree.
   Preserve the current deploy ID, server ZIP digest, source tree and private
   operator configuration record before any separately approved change.
2. If the owner first approves a **diagnostic-only read-only website deployment**,
   deploy the reviewed candidate with currently intended financial/profile/fixture
   flags unchanged and OFF. This is an owner approval boundary, not permission
   granted here. Use the normal routes and server log categories to identify
   the gate/read stage. A website-only prebuilt publication does not require
   removing the existing automatic-production-build guard.
3. To enable only fresh public **read discovery**, the owner/operator must verify
   and bind these exact server keys in **Netlify Functions scope, production
   deploy context**, then rebuild/redeploy once (values freeze per deploy):
   `RMT_LAUNCH_HISTORY_INDEXER_URL` (the existing approved HTTPS worker origin),
   `RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN` (the existing worker read credential,
   private continuity check against `RMT_INDEXER_READ_TOKEN`), and
   `RMT_CURVE_PRODUCTION_DISCOVERY=rmt-curve-fixed-supply-security-v2`.
   Never place the credential in Git, a client bundle, NEXT_PUBLIC variables,
   request/query parameters, ordinary logs or evidence. Do not infer that the
   old deployed secret transfers automatically. If an approved private
   operator source cannot establish continuity, stop and request that exact
   credential-binding decision; do not disable auth or invent/rotate a value.
   No Railway redeploy, new worker/database/provider, paid plan, DNS change or
   original-volume access is required by this proposal.
4. Keep `RMT_CURVE_PRODUCTION_EXECUTION`, `RMT_CURVE_PRODUCTION_PREPARATION`,
   profile activation/release attestations, all fixture/emulator flags and
   public financial routes OFF/unset as the existing policy requires.
   A discovery profile does not authorize creation, trading, migration or claims.
5. After approval, correlate a bounded normal GET sequence: record unchanged
   deployment IDs and current `/health`; GET historical `/api/launchpad/launches`
   and new-engine `/api/launchpad/new-engine` on the approved canonical HTTPS
   origin; bind request IDs, tight UTC window, corresponding server enum and
   Railway path/status, then re-read health. Account for the **shared one-minute
   diagnostic budget** and concurrent traffic: use at most ordinary requests
   after a quiet interval, never a request flood. A missing category proves
   nothing and must not be used as a success criterion.
6. GO for **read-only website cutover only** requires the correctly bound
   authenticated endpoint, ready/schema-valid new-engine status with a checkpoint
   younger than 120 seconds, expected factory/registry/profile and exact receipts;
   historical and new-engine provenance stay separate. Fresh-only CDN lifetime
   is at most 15 seconds and bounded before expiry. Historical snapshot/stale
   responses remain no-store; unavailable/stale new-engine data is 503 and cannot
   claim current inventory or current absence. Verify the fixed production
   headers/authority in the legitimate hosting path; do not loosen them to make
   a preview work. Synthetic missing/wrong credential, outage, stale and reorg
   tests remain the negative acceptance evidence; do not inject failures into
   production.
7. Any 404 gate mismatch, 401/403, schema/pin mismatch, stale checkpoint,
   credential leak or unexplained continuity failure is **NO-GO**. Preserve the
   observation and keep financial routes disabled. For an approved candidate
   regression, prepare a **fix-forward source revert/rebuild** from the preserved
   approved read-only source plus reviewed configuration, retest and obtain
   separate publication approval. Do not call restoreSiteDeploy/publishDeploy,
   change DNS, restore the original database volume, replay transactions or
   treat disabling a website flag as reversing an on-chain action.

This plan is prepared for an explicit owner website-only decision. Neither its
configuration values nor a diagnostic/profile deployment has been approved or
performed in Task089.

## Writer and backup boundary

Current provider inventory confirms the existing single worker and original
PostgreSQL volume identity/mount, but public health contains no lease-owner
field; the bounded runtime lease-log query returned zero rows. A fresh
dedicated-connection advisory-lock owner was **not directly observed**.
Source requires the existing shared writer lease, and isolated tests exercise
lease contention/restart, but those do not constitute a fresh production query.

The connector has no read operation for the existing volume's backup inventory.
Retained Task066 owner-local encrypted-backup/isolated-restore evidence is
historical. Current backup age, an accessible off-device recovery copy and
current production lock ownership remain **UNVERIFIED** until established
through separately reviewed read-only operator evidence. No original volume,
database credential, SQL connection, snapshot, fork, restart or configuration
was touched here.

**BLOCKED_NO_BROADCAST.**
