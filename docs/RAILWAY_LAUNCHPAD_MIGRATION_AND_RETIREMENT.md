# Railway launchpad migration and legacy retirement

Owner directive: [Task 073 on PR #666](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/666#issuecomment-6980678273).
Base: `a71b2dbd0044b5f30228bb60443f77f752a9adf7`. The approved visual design,
contracts, economics, Firebase records and governance safeguards are preserved.
This work delivers a read-only Railway preview; it does not authorize a domain
cutover, wallet authentication, token issuance or financial execution.

## Current acceptance boundary

The Railway preview is `https://rmt-launch-website-preview.up.railway.app`.
The preview is working. Deployment `6d7863ad-02a0-4ef0-a7be-b3b645a450fa`
uses committed source `484f6bb7b431c2f9eff278c08c14d9d3e57eb11f`, image
`sha256:1ab4c9782f4bcb49817266ce6431e81c134273dd44b3563302c8a4f68e975d9d`.
It started at `2026-11-18T14:46:18Z`. Subsequent code-candidate changes through
`cbac3dea7c0adbb1ffbf9f017fb791f5e3431c0b` affect synthetic CI diagnostics only;
the deployed application/runtime files are identical.

At `2026-11-18T14:53:15Z`, both discovery and readiness were HTTP 200.
The verified history API returned four registrations, `v6-indexed`, checkpoint
`117481251` / `2026-11-18T14:53:04Z`, with L1 finality explicitly unverified.
Two V6 records come from the current indexer; two V4 records retain their
reviewed snapshot provenance. These are historical registrations, not four new
product launches. The private new-engine feed separately returned `ready`, zero
launches, chain 4663; its public route and all execution remain disabled.
See [source-bound evidence](evidence/railway-073/acceptance.json),
[actual discovery](evidence/railway-073/current-discovery.json) and
[draft PR #667](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/667).

`https://www.rmtlaunch.fun` remains on Netlify. Task 071's production deployment
is `6afd4265956a469adeb55747`; its historical API was observed using an explicitly
stale snapshot. No Netlify configuration was changed. The earlier
deployment `6af86be73747ac95bd6d15ea` is separately retained recovery evidence.
Recheck their availability before any future cutover. This task does not change
either deployment, DNS, domains or TLS.

The 22 high contract findings and strict scanner failures remain visible.
Website acceptance does not clear contract, finality or physical-wallet gates.

## Reused resources and actual dependencies

Project `robust-ambition`: `19587a6e-6f02-4cfa-b7db-f308934f697b`.
Environment `production`: `539a42da-fb60-420f-b9fa-8c29af25ebbe`.

| Resource | Exact service ID | Verified role / disposition |
| --- | --- | --- |
| `robinhood-meme-terminal` | `27b1aa2c-77e5-4ed4-91a1-1951d68c488e` | Keep the existing authoritative historical/new-engine indexer and read API. Its actual `DATABASE_URL` refers to **Postgres**. |
| `Postgres` | `a1ef7853-e21a-401e-87c9-c99002228507` | Keep the original production database and volume `bf6e7ddc-3be6-4ba7-ad53-8e7010e76c86`. No replacement, DDL, reset or new writer. |
| `rmt-launch-website` (formerly `rmt-nft-marketplace-indexer`) | `8e9c1c15-74b5-4262-8851-72603a3dfc98` | Reuse the never-deployed, volume-free service in place for the separate Next.js web process. The service count does not increase. |
| `rmt-nft-indexer` | `a883fe02-583b-493e-b2ef-6acd87d775b9` | Retired from GitHub autodeployment; restart policy `NEVER`. Retain its record/configuration. Its former connection is to `rmt-nft-indexer-db`. |
| `rmt-market-indexer-shadow` | `9ea9a7d3-34d8-4229-a7ff-e3326c67ceef` | Retired from GitHub autodeployment; restart policy `NEVER`. Its actual former database is **Postgres-EHZZ**, not the similarly named shadow database. |
| `rmt-market-indexer-shadow-db` | `96ace991-4c71-404f-af95-323415b0a45d` | Retain unclassified persistent data; no current cross-service reference found in the audited map. Name alone does not establish ownership. |
| `rmt-nft-indexer-db` | `d7c33990-12e7-4762-85a5-f43e748bc48d` | Retain former NFT indexer data pending export, restoration and deletion approval. |
| `rmt-nft-marketplace-indexer-db` | `46619727-f4fb-4e44-a4d3-9c2a0d56b873` | Retain the former marketplace connection/data; the repurposed website receives no database credentials. |
| `Postgres-EHZZ` | `d51260ff-3651-41f9-b888-d62d49e25fd2` | Retain the shadow worker's actual former database, including its larger unclassified data set. |

The dependency map distinguishes explicit configured references/connections from
Railway's automatically advertised `RAILWAY_SERVICE_*` variables. An automatic
URL variable is not proof that a service consumes that URL. Existing database
services have no public domains or TCP proxies in the audit. Do not expose them
to perform a backup or a preview.

No database or volume has been deleted. The two retired workers were already
failed with zero sampled CPU/memory usage. Retirement prevents abandoned source
from redeploying; it is **not a measured cost saving**. Their service objects,
historical deployments and preserved configuration remain distinct from live
product infrastructure.

## Private read path and runtime packaging

The verified path is:

```text
Browser -> Railway Next.js read-only website
        -> authenticated private existing indexer
        -> original Postgres (existing indexer writer only)
```

The web process receives no `DATABASE_URL`, signing key, Firebase administrative
credential or public RPC execution gateway. Its read token references the
existing indexer variable and remains server-only. Private HTTP is admitted only
for the exact reviewed project, environment, website service, indexer service
and origin `http://robinhood-meme-terminal.railway.internal:8080/`; arbitrary
HTTP origins, ports, credentials, paths and user-supplied URLs are rejected.
The public browser communicates only with its own website origin.
Read-only inspection inside the existing containers established the actual
indexer runtime `PORT=8080`; the source default 3001 was not the deployed port.
The incorrect port returned `ECONNREFUSED`. On 8080, health/readiness returned
200, history without a bearer returned 401 and the existing bearer returned
200. Six later private reads completed in 310–348 ms. Temporary operator SSH
access used for these diagnostics was revoked and local temporary key files
removed; no database or indexer restart was performed.

The same application uses the digest-pinned Node 22 Debian image and Next.js
standalone output through [the Dockerfile](../apps/launch-website/Dockerfile).
The image runs as the unprivileged `node` user. Dependencies remain frozen by
pnpm 10.12.1 and the existing lockfile. Netlify's adapter is not required in the
Railway runtime. [API settings](../apps/launch-website/railway-settings.json)
record the existing service, build/start path, healthcheck, one replica and
0.5 GB / 1 vCPU limit. This is a review-input manifest, not a new unsupported
Railway Config-as-Code file. The original indexer's configuration is unchanged.

Startup requires `RMT_WEB_HOSTING=railway-read-only-v1`, the exact deployment
identities, `RMT_WEB_ORIGIN=https://rmt-launch-website-preview.up.railway.app`,
the pinned private endpoint and existing read credential. Provider-generated
domain labels can remain stale after a service rename, so they never override
the explicitly verified origin. Missing/wrong configuration fails closed.
The startup gate rejects unrelated privileged configuration and all nonempty
profile/Firebase/curve/mobile execution activation variables.

The single-process request budget is independent of spoofable client-IP headers:
600 reads, 120 stateless draft reviews and 12 account/creation mutations per
minute, with `Retry-After`. Mutation endpoints remain disabled regardless of
budget. Counters reset on a web restart; durable indexing, canonical receipts and
transaction-recovery journals do not. This budget is not a distributed limiter;
additional replicas require a separately reviewed configuration.
The reader coalesces requests and caches list results for 30 seconds; exact
reads are bounded to four concurrent requests and 64 cache entries. Railway
does not honor Netlify-specific CDN headers as a shared API cache. The browser
receives private/no-store responses; no Railway CDN hit or distributed budget is
claimed. Failure telemetry contains only fixed stage names, HTTP status and
allowlisted transport codes, bounded to once per minute per reader.

## Preservation, backups and deletion hold

Original service variables/configuration were preserved in owner-local
Windows current-user DPAPI storage before retirement and repurposing. The
encrypted file is 20,582 bytes, SHA-256
`c6dba765ecd51e8e2dd26c8d2d855363222f097d8c6eec5dbd346990c53e50dd`;
encryption/decryption roundtrip was verified. No raw secret is in Git.
**This is a configuration archive, not a PostgreSQL backup or an off-device
disaster-recovery copy.** It depends on the owner's Windows profile.

The Task 073 backup inventory observed no listed volume backups for original
Postgres, NFT DB or marketplace DB. EHZZ retained metadata for two resize
snapshots with October 23 expiry dates. The shadow DB listed an August resize
snapshot with no expiry in its metadata. None of these snapshots was restored
or established as a usable current recovery copy during this task. Their small
historical `usedMB` fields do not prove current databases are empty.

The [exact candidate deletion manifest](evidence/railway-073-deletion-manifest.json)
is **not approved for execution**. Each of its four legacy database/volume pairs
must first receive a consistent PostgreSQL 18 custom-format dump, encryption in
owner-controlled storage outside Railway, SHA-256/size/UTC record, successful
`pg_restore --list`, and a restore into a separate isolated PostgreSQL instance.
Compare schema, indexes, counts, chain/contract/checkpoint/event identities and
any unique accounting or recovery data. Establish the retained historical-data
location and recovery procedure. Never restore over the original database.

Only after that evidence and a fresh dependency check should the owner approve
the **exact manifest hash and resource IDs** for permanent deletion. No broad
"cleanup" approval, absent source path, sleeping state, resize snapshot or
zero-traffic sample substitutes for those conditions. The original Postgres,
its volume, the authoritative indexer and the reused web service are explicitly
excluded from deletion.

## Measured usage and plan constraints

The pre-change 24-hour sample used 25 hourly observations. Average memory was
0.120869 GB for the active indexer and 0.138336 GB for original Postgres; average
CPU was 0.002337 and 0.001506 respectively. The original 500 MB database volume
used approximately 0.273859 GB. These are observations, not web-service capacity
or long-term billing guarantees.

Legacy volumes provision 20,000 MB in total. Measured persisted use was roughly
0.489406 GB (shadow DB), 0.343458 GB (NFT DB), 0.137798 GB (marketplace DB) and
2.323669 GB (EHZZ). Their combined nonzero use is not a safe deletion signal.
Seven-day HTTP analytics for the three old stateless workers returned no
buckets; report this as no recorded traffic, not proof of no external consumers.

The observed plan remains **Free**: three-service and zero-custom-domain
capabilities, with nine existing resource services retained/grandfathered.
Reusing the existing web slot adds no service or volume. The observed remaining
usage credit initially was **$0.251195**. At final measurement it was
**$0.244518**, with **$0.755482** metered in the current billing period and a
provider period projection of **$1.567816**. The period ends November 29 at
16:40:44 UTC. The projection is not an invoice or approval for spending beyond
the Free allowance. The website's one-hour sample included build downtime:
current memory 0.091992 GB, peak 0.193475 GB, peak CPU 0.056463 vCPU.
Do not extrapolate the zero-inclusive average into a steady monthly bill.
The separate Linux CI post-restart idle sample was 87.81 MiB / 512 MiB and
0.04% CPU; it is not a Railway billing measurement.
No upgrade, credit purchase, paid add-on or
automatic spending authorization is implied. Continuous Free operation is not
guaranteed when allowance is exhausted.

## Hosted acceptance and later domain cutover

Verified results:

- All ten PR checks passed on code candidate `cbac3dea`: repository, indexer,
  contracts, Operations Safe, gitleaks, web, isolated lifecycle, isolated Firebase,
  Linux Netlify artifact and Linux Railway container. Web tests: 88/88;
  Foundry: 98/98 across 13 suites. This is the current cleaned suite, not a claim
  to have rerun every historical frozen suite or cleared Slither.
- The lifecycle job checked out synthetic merge `61d02a529113a2edb85f1270fed4f5b50e9ddceb`.
  Its entire Git tree equals `cbac3dea`: `1ddcb050ff20568b2c0b1ba5bba686888df84938`.
  The new container job explicitly checks out the PR head and binds its reports
  to that source. [CI evidence](evidence/railway-073/acceptance.json) links each job.
- The actual Linux standalone image served pages, enforced host binding,
  disabled authentication/execution, returned stale fallback without its test
  backend, enforced 429 and repeated acceptance after Docker restart at
  512 MiB / 1 CPU. [Runtime](evidence/railway-073/linux-runtime.json) and
  [restart](evidence/railway-073/linux-restart.json) reports are retained.
- Actual Railway Chromium/WebKit desktop, portrait and landscape checks passed:
  approved UI, search outer focus, draft validation/review/edit/refresh,
  no horizontal overflow and zero wallet, external or operational requests.
  [Desktop](evidence/railway-073/screenshots/desktop.png),
  [portrait](evidence/railway-073/screenshots/portrait.png),
  [landscape](evidence/railway-073/screenshots/landscape.png),
  [review](evidence/railway-073/screenshots/creation-review.png).
- Hosted route checks denied 70 route/method cases and eight disabled
  account/creation mutations without cookies; the thirteenth aggregate mutation
  returned 429 despite spoofed IP headers. The actual read credential was absent
  from four HTML pages and 47 script reads. No secret value is in the report.
- A controlled web-only restart of deployment `4957caac` resumed private reads.
  Six browser layouts and five successive history samples passed; checkpoint
  advanced from 117474703 to 117475044. Four exact-address lookups retained
  their registration receipt identities. The subsequent deployment adds only
  bounded failure diagnostics; its data/readiness were checked again above.

Retained limitations and original failures:

- Early hosted reads sometimes returned 503 readiness and the explicitly stale
  snapshot. Both failure and recovery observations are retained in
  [the availability sample](evidence/railway-073/post-restart-availability.json).
  No specific transport/parser defect was established: actual payload replay
  passed strict validation unchanged, and later private reads and final hosted
  observations were healthy. This is not continuous-availability certification.
- The first Linux smoke harness did not preserve Host through fetch; then native
  HTTP DELETE requests lacked body framing. The harness was corrected, with
  its status, host and security assertions retained. Original failed CI remains
  accessible; subsequent container acceptance passed.
- The `1757d153` isolated lifecycle run refused a graduation review. No cause was
  established from its incomplete artifact. JSON-safe synthetic diagnostics were
  added, correcting an intermediate diagnostics-only BigInt serialization bug.
  The complete rerun passed unchanged client/server validators; this is an
  unreproduced observation, not a claimed protocol fix or security clearance.
- Rapid WebKit page replacement initially canceled an in-flight session GET.
  Waiting for destination network completion passed the same assertions. The
  original failure remains in the owner-local evidence directory.
- Windows standalone copying hit symlink EPERM. Automatic approval review
  rejected a local standalone-server start with “blocked by policy” and no
  further reason; that action was not retried. Authorized hosted and Linux CI
  evidence is separate. Physical iPhone acceptance was not performed.
- The evidence-only `22d08473` commit triggered eight Gitleaks generic-api-key
  matches: the same four public ERC-20 contract addresses in two JSON reports.
  Both paths were added to the existing exact-four-address, AND-path allowance.
  No new value pattern, directory exclusion, detector or severity change was
  introduced. The full reachable-history scan remains enabled.

No production database schema, backup restore, main indexer restart, additional
writer, RPC subscription, DNS or Netlify deployment change was performed.

Domain migration is **not executable on the observed Free entitlement**, which
admits zero custom domains. Do not promise a free custom-domain cutover or work
around this by weakening HTTPS/origin/security checks. No plan change is
authorized. A supported entitlement and separate owner DNS/cutover approval are
required before adding `www.rmtlaunch.fun` or its apex to Railway.

Before any later approved cutover, capture current Netlify DNS/TLS/deploy and
credential provenance; review a separately pinned production-origin runtime;
verify both Railway domain certificates and private-feed readiness; preserve
the Netlify deployment and exact DNS records; then obtain approval for only the
specified records and cutover window. Preview-origin startup guards must not be
silently relaxed. Keep authentication and transactions disabled through this
hosting-only change.

Before cutover the rollback is to leave the existing Netlify domain untouched.
After a separately approved cutover, an owner-approved DNS reversal can route
back to the retained Netlify website while the Railway defect is fixed. Do not
silently restore an older Netlify deploy: prepare a fix-forward rebuild of the
approved source when an application rollback is needed. No rollback technique
deletes data, replays transactions or bypasses governance notice or LP custody.

The next approvals remain separate: preview acceptance/domain entitlement and
DNS cutover; Firebase/physical-wallet activation; mature factory governance;
creation/trading/claims; and finally the owner's ordinary creator-flow RMT
creation. No RMT token is created by infrastructure deployment.
