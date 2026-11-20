# Direct production findings and focused defensive proofs

**Read-only website repair verified on 2026-11-20.** Netlify deployment `6b0096332beb675b1d8e0f49` is ready/production since 18:49:44.086Z. It uses unchanged tested source `b79515752ef42e88850ac2cea953955a3bb03087`, server ZIP SHA-256 `08d237501b2c16de95627a3e773d9092cc3050c155e39c2d33449503b564c345`, all 90 verified static files and the same native edge bundle. No build or Railway/database change was made.

The immediate failed-rollout gate was a configuration mismatch: website activation requires **`rmt-curve-fixed-supply-security-v2-4663-task066`**, while the worker's response format is **`rmt-curve-fixed-supply-security-v2`**. Earlier rollout instructions incorrectly used the latter as the activation value. Exact source and compiled-artifact checks reproduce the short value's `profile_disabled` rejection and preserve fixture/authority refusals; those instructions are corrected. This explains the demonstrated new reader's 404, and is not retrospective proof of the initial Task071 historical-fallback trigger.

The existing worker credential was retrieved privately through the authorized Railway session, matched against the sleeping preview and authenticated successfully. It was transferred directly to Netlify and marked secret; no value was printed, saved locally or sent through ChatGPT/GitHub. All three bindings have **Production as their only context**. Netlify reports per-variable scope controls unavailable, so the owner explicitly approved existing default scopes: secret Builds/Functions/Runtime; public values retain their defaults. No paid upgrade or token rotation occurred.

[Actual hosted evidence and reproduction](hosted-resolution/README.md) · [canonical responses](hosted-resolution/hosted-acceptance.json) · [Railway correlation](hosted-resolution/correlation.json).

| Netlify response UTC | Checkpoint | Age at read | Corresponding Railway protected GET |
| --- | ---: | ---: | --- |
|18:56:04.666|119278659|44.666s|18:56:04.251797519Z /200|
|18:56:32.899|119279107|26.899s|18:56:32.488005604Z /200|

Both ordinary public GETs returned 200/ready; checkpoints advanced by 448 blocks over 28.233 seconds, and eight public RPC reads independently matched both checkpoints' exact number/hash/timestamp through the existing official and Pocket witnesses. These are real hosted reads, not synthetic credentials or fixture responses. Both launch arrays are empty; this establishes the authenticated fresh checkpoint path, not populated production-launch execution, independently proven confirmation depth, L1 finality or sustained uptime.

Config remains disabled; creation, earnings and profile nonce boundary probes return 404. The unauthenticated worker request returns 401. Only the three read bindings exist; preparation, release, execution, profile and fixture activation flags remain unset. **No further owner action is required for the read-only website. Financial launch and governance execution remain NO-GO.**

Earlier captures remain dated history in `production/` and `hosted-resolution/prior-*`: empty bindings/403, incorrect activation404, a checker using the wrong upstream schema for the sanitized public response, a Pocket null witness and a naturally occurring Railway 503. No rejection was bypassed or discarded. The later paired acceptance proves recovery; it does not erase those availability observations. Netlify browser automation was unavailable, so the successful transfer used the authorized SDK with the verified existing credential in process memory.

## Three source/runtime-bound proof clusters

| Cluster | Exact findings | New executable evidence | Disposition |
| --- | ---: | --- | --- |
| [Graduation](graduation/README.md) | 11 | 6 tests + 512 fuzz cases on each ordinary and canonical profile; exact 21-frame mutable graph; per-account conservation, runtime/expiry/unlock refusals | Callback diversion excluded for the exact admitted implementations and actions under the stated state assumptions |
| [Migration](migration/README.md) | 6 | 9 tests + 512 fuzz cases per profile; six mutable frames, one ledger writer change, asset and earned-claim conservation, hostile handoff rollback | Baseline mutation excluded for the canonical immutable token/ledger and separately admitted exact successor path |
| [Original LP harvest](harvest/README.md) | 1 | 5 tests, 12 numerical snapshots, seven successful/four refused harvest subtrees; real pinned dependency code and original-only fee conservation | Baseline mutation excluded for the fixed original-position harvest graph; local RMT profile is explicitly synthetic |

The combined canonical run passed **20/20 tests, zero failures/skips**, with 512 fuzz cases in each graduation/migration fuzz test. Independent binding checks passed **44/44**. Full traces, numerical vectors, compiler inputs, source/runtime correspondences and failed initial attempts are retained. These finite synthetic-storage proofs do not cover every possible production state, future admission, alternate token/hook/subscriber/action or Permit2 signature path. No confirmed first-party defect requiring a versioned production patch was established; production Solidity and economics remain unchanged.

`stage-dispositions.json` maps all 22 original IDs: the four prior independent expression disproofs remain inherited; the 18 new observations receive the precise bounded technical dispositions above. Original raw severity, all 101 detectors, 22 High observations, seven governance Mediums and the strict failing gate remain intact. No scanner exception or financial authorization is granted. The earlier harvest scan snapshot remains historical: two documentation files changed afterward; the final validation scan binds their current bytes separately.

Exact source head `4a174f425ded6b0a8ed212878cffbde732a87cc8` completed all five workflows: 11 jobs passed and four unchanged strict-analysis jobs failed. Both focused Linux profiles passed 44 binding checks and 20 proofs/512 fuzz cases, both browser lifecycle jobs passed, and 327 website plus 132 contract tests passed. The new hosted captures and documentation corrections change no application, contract or scanner code; their subsequent PR checks remain separately identified. No financial release gate is made green.

The latest bounded governance capture (`production/governance-current.json`, 42 public reads) records the original publication still pending/time-eligible at canonical block 119225299, nonce 0, epoch 1, unsuspended, latestVersion 0 and no current factory. Its execution expires 2026-11-26T19:50:06Z. No preparation, simulation, signature, cancellation or execution was performed. Financial launch and publication remain **NO-GO** in this handoff.
