# Deterministic 0x terminal acceptance

Build with the same process-local public flags as the `0x browser acceptance`
workflow, then run `RMT_ACCEPTANCE_ONLY_ZEROX=true pnpm test:terminal-high-end`.
The runner starts and stops an isolated production Next.js server on loopback
port 3100. No deployment, real API key, wallet signature, or transaction is used.

The public terminal components call the real `/api/vnext/quotes`, `/verify`,
`/authorize`, and recovery routes. An ephemeral identity fixture is checked by
the real identity verifier against its process-local test public key. Canonical
seed data feeds mocked contract reads, not a replacement directory response.
The 0x HTTP, chain RPC, wallet transport, registry/enrichment reads and receipt
reads are deterministic boundaries. Previous Next.js HTTP cache entries are
excluded from the test process. Destination classification happens before JSON
parsing; analytics is no-op, known unavailable enrichment is explicit, and
unexpected destinations fail acceptance. No external request is forwarded.

Positive journeys never replace an application API response. Separate negative
transport-corruption probes obtain a genuine server authorization, mutate one
field in transit, and recompute its unkeyed payload hash. These test the real
client's evidence/plan validation rather than merely detecting a stale hash.
They never fabricate valid quote, verification, or authorization logic.

Desktop 1440x900 and mobile 390x844 cover direct swap, exact approval and fresh
post-approval authority, native value, rejection, pending recovery, expiry,
provider release scope, malformed 0x responses, altered authorization evidence,
and exact simulated/authorized/wallet envelopes. Confirmed provider-native fees
remain quoted without independent transfer reconciliation. JSON evidence and
screenshots are written to `terminal-zerox-evidence` and uploaded by CI.

Route-on-demand cases use non-curated ERC20 RPC identities with no admitted
directory pools. Both viewports cover a live 0x route, no liquidity, separately
observed workspace evidence, a canonical stock token, and an unverified token.
The real server must produce the successful verification and authorization;
the negative cases must never authorize or prompt a wallet. No directory
evidence is fabricated to enable execution.

For focused fixture debugging only, `RMT_ACCEPTANCE_ROUTE_ON_DEMAND_ONLY=true`
runs the seven new cases per viewport, including both ETH/USDG directions.
Final acceptance and CI leave this unset and run all 41 scenarios per viewport.

Production fixes in this stack are limited to removing the duplicated client
admission guard (with a type derived from `VNextPreSignEvidence`) and excluding
custom-executor execution IDs from provider-native verification requests. The
0x verifier's rejection of custom-executor authority remains intact.
