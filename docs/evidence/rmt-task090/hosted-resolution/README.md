# Hosted read-only resolution

The unchanged b795/08d23750 artifact is deployed as 6b0096332beb675b1d8e0f49. `activation-profile-correction.json` and `compiled-gate-audit.json` bind the correct long activation value separately from the short worker response format. `secret-binding-transfer.json` contains metadata and private equality/authentication results only. `owner-scope-approval.json` records the explicit Production-only/default-scope approval; no credential value or credential-derived fingerprint is present.

`hosted-acceptance.json` records two actual public Netlify 200/ready responses, eight exact canonical RPC reads, financial/profile refusals and unauthenticated worker 401. `railway-http.json` excludes client addresses; `correlation.json` pairs the two protected 200 requests with Netlify responses at 415 ms and 411 ms differences. No direct authenticated control reads occurred in that paired window. Railway's deployment remains b48f0e6e-a34b-4a26-b95f-d4b978562282.

The public response contract is `{status,launches,checkpoint}`; internal chain/profile/deployment metadata is checked by the pinned server-side worker parser and intentionally omitted from that response. The public checker independently validates exact public fields, row identities, freshness, advancement and canonical block identity; it does not manufacture missing upstream metadata. Its bounded null-block retries never accept a different hash or exceed a freshness deadline of 120 seconds; the final paired capture needed no retries/null results.

From repository root, reproduce ordinary read-only checks with a new absolute output path:

~~~powershell
pnpm --filter @rmt/launch-website exec tsx --tsconfig tsconfig.test.json ../../docs/evidence/rmt-task090/hosted-resolution/verify-hosted.mts <fresh-output-json>
~~~

Verify the current deployment identity through authorized account controls before treating a later run as evidence for this dated b795 deployment. `producer-correspondence.json` proves that packaging changed only repository-relative imports and the explicit output argument; validation and request logic match the actually executed producer.

Limits: zero current launch rows, 20 reported confirmations rather than independent confirmation-depth proof, L1 finality unverified, finite observations rather than uptime assurance. Earlier failed checks remain in `prior-*`; `prior-null-witness.json` includes a Pocket null result and later ordinary traffic observed one Railway 503. Recovery did not loosen any application/authentication predicate. Three empty POST requests test disabled boundaries; no financial execution, wallet signing, governance action or token creation occurred.
