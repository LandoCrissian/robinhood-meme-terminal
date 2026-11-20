# Direct production findings and focused defensive proofs

**Website: unresolved.** The approved b79515752ef42e88850ac2cea953955a3bb03087 website artifact is published as `6b008009d57abd2faf8e0ec7`, ready/production since 2026-11-20T17:14:56.180Z. Its server ZIP remains SHA-256 `08d237501b2c16de95627a3e773d9092cc3050c155e39c2d33449503b564c345`. No build or Railway/database change was made.

The existing worker and sleeping-preview credentials were compared privately through their authorized account controls: they match. An authenticated worker GET returned **200/ready**, canonical profile/chain/deployment pins, checkpoint 119196994 at 16:37:55Z, observed at 16:38:18.799Z. A later authorized control read at 17:50:03.263Z returned checkpoint **119239732**, timestamp 17:49:35Z, age **28.263 seconds**, with identical deployment pins and zero new-engine launches. Both existing public RPC witnesses independently matched its exact canonical number/hash/timestamp (four bounded public reads). This proves worker advancement; these direct control requests do **not** establish Netlify authentication.

An actual Netlify function log on the first b795 deployment (`6b007ce744bf122a5a8c32fa`) proves `production_discovery_degraded / profile_disabled`, before the upstream read. Its request ID is `01M7WYVT9D3PFWHDAXSVGB017S`. Both documented deployment-local binding delivery attempts left discovery unavailable. The second published deploy is ready despite the CLI's subsequent HTTP 500 `no records matched`; preserve both facts. Its latest request, `01M7X0EMTCC24V2JVM2GPRMEDK`, returned **404**, with no cache hit and an actual server-function invocation. A later log-stream attempt captured no events, so the earlier diagnostic category is not attributed to the second deploy.

After the owner's separate approval of persistent bindings, the existing authenticated Netlify SDK's `createEnvVars` returned **HTTP 403**. Readback at 17:28 and again at 17:36 UTC shows **zero site bindings**. A 17:52:59 UTC read-only preflight again finds **zero site and team bindings**, the same current deployment, and independently re-verifies the server ZIP and all 90 static-file hashes. It prepares the corrected no-build command without deployment-local overrides and does not deploy. After the owner reported saving the bindings, the 17:54–17:55 follow-up still found no variables through the site/account-ID API, connector, account-slug API and normal CLI; legacy build settings are also empty and Envelope is enabled. The project/location of the reported save therefore needs reconciliation before deployment. The precise role-versus-plan reason for the denied write is unavailable. It was not retried through other accounts, broader scopes or access workarounds. The current website repair has **not** met hosted acceptance: no two fresh Netlify canonical checkpoints or corresponding Railway authenticated reads have been demonstrated. The historical endpoint's old checkpoint is not current discovery.

## One owner-only website action

In the [existing Netlify project](https://app.netlify.com/projects/eclectic-valkyrie-16cb92), save exactly these three bindings in **production context / Functions scope**:

| Key | Value / secure source | Secret |
| --- | --- | --- |
| `RMT_LAUNCH_HISTORY_INDEXER_URL` | `https://robinhood-meme-terminal-production.up.railway.app` | No |
| `RMT_CURVE_PRODUCTION_DISCOVERY` | `rmt-curve-fixed-supply-security-v2` | No |
| `RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN` | Existing worker `RMT_INDEXER_READ_TOKEN`, privately verified against the sleeping preview; transfer within authorized account controls, never a PR/chat | Yes |

If the owner UI also refuses, requires broader scopes, or offers a paid upgrade, stop and report that exact limitation. Do not rotate/create a credential or change Railway. Following a verified save, the already-approved action is a normal no-build deployment of the **unchanged b795 / 08d23750…64c345 artifact**, with no deployment-local overrides. It must then pass two hosted `new-engine` observations beyond the 15-second cache window, advancing canonical checkpoints under 120 seconds old corroborated by both existing public RPC witnesses, and matching Railway protected-path 200 requests. A missing binding, authentication failure, wrong pin or stale checkpoint must remain unavailable. This evidence packet does not substitute for those still-missing observations.

Current hosted boundary checks show config disabled and creation, earnings and profile nonce routes unavailable. All financial/preparation/profile/fixture activation flags remain unset. No governance execution, wallet signing, funding, RMT creation or financial transaction occurred. `production/` contains sanitized captures only; credential values, client IPs, raw logs and account tables are excluded.

## Three source/runtime-bound proof clusters

| Cluster | Exact findings | New executable evidence | Disposition |
| --- | ---: | --- | --- |
| [Graduation](graduation/README.md) | 11 | 6 tests + 512 fuzz cases on each ordinary and canonical profile; exact 21-frame mutable graph; per-account conservation, runtime/expiry/unlock refusals | Callback diversion excluded for the exact admitted implementations and actions under the stated state assumptions |
| [Migration](migration/README.md) | 6 | 9 tests + 512 fuzz cases per profile; six mutable frames, one ledger writer change, asset and earned-claim conservation, hostile handoff rollback | Baseline mutation excluded for the canonical immutable token/ledger and separately admitted exact successor path |
| [Original LP harvest](harvest/README.md) | 1 | 5 tests, 12 numerical snapshots, seven successful/four refused harvest subtrees; real pinned dependency code and original-only fee conservation | Baseline mutation excluded for the fixed original-position harvest graph; local RMT profile is explicitly synthetic |

The combined canonical run passed **20/20 tests, zero failures/skips**, with 512 fuzz cases in each graduation/migration fuzz test. Independent binding checks passed **44/44**. Full traces, numerical vectors, compiler inputs, source/runtime correspondences and failed initial attempts are retained. These finite synthetic-storage proofs do not cover every possible production state, future admission, alternate token/hook/subscriber/action or Permit2 signature path. No confirmed first-party defect requiring a versioned production patch was established; production Solidity and economics remain unchanged.

`stage-dispositions.json` maps all 22 original IDs: the four prior independent expression disproofs remain inherited; the 18 new observations receive the precise bounded technical dispositions above. Original raw severity, all 101 detectors, 22 High observations, seven governance Mediums and the strict failing gate remain intact. No scanner exception or financial authorization is granted. The earlier harvest scan snapshot remains historical: two documentation files changed afterward; the final validation scan binds their current bytes separately.

The new focused CI workflow runs offline proofs and fresh trace extraction. Local results are not labeled as CI results. Prior PR684 CI belongs to b795 only. No release gate is made green by this package.

The latest bounded governance capture (`production/governance-current.json`, 42 public reads) records the original publication still pending/time-eligible at canonical block 119225299, nonce 0, epoch 1, unsuspended, latestVersion 0 and no current factory. Its execution expires 2026-11-26T19:50:06Z. No preparation, simulation, signature, cancellation or execution was performed. Financial launch and publication remain **NO-GO** in this handoff.
