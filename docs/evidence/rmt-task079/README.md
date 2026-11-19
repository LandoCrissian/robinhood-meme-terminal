# Task079 permanent-retirement acceptance artifacts

**Local synthetic evidence only. BLOCKED_NO_BROADCAST.** [Acceptance and limits](../../RMT_RECLAIM_SECURITY_AND_POLICY_ACCEPTANCE.md), [security findings](../../RMT_RECLAIM_V2_SECURITY.md), [campaign policy](../../RMT_RECLAIM_CAMPAIGN_POLICY.md).

`browser-acceptance-manifest.json` binds implementation14440d3bb06fe309e4d281f83c34308ac09c834a to its byte-identical Actions merge tree, the exact compiler input and completed CI. Raw browser records retain the actual merge checkout identity. The evidence-only handoff commit is separately verified on PR#673; raw input identities are not rewritten to that later commit.

`browser/{chromium,webkit}/` contains unmodified JSON compressed with deterministic gzip,11 PNG viewport captures per engine, raw redacted scanner reports and fresh public-data classifications. The JSON ties the reviewed fields, signed synthetic request, receipt/logs, Safe approvals, canonical PostgreSQL rows, restart, lost-hash recovery and reorg rollback. No synthetic private keys or infrastructure credentials are included. The scanner's240 findings per engine are explicitly retained and individually classified as public synthetic token addresses/runtime hashes; the scan itself is not described as clean or suppressed.44 public Safe-signature occurrences per engine were independently recovered against their actual chain31337 digest/owners.

`public/` records the actual read-only production-style build tests, route denials, zero wallet/financial calls and honest snapshot state. These are loopback observations, not a production publication or phone acceptance.

Representative captured views:

- [Chromium desktop](browser/chromium/reclaim-standard-desktop.png)
- [WebKit portrait](browser/webkit/reclaim-permanent-active-portrait.png)
- [WebKit landscape](browser/webkit/reclaim-permanent-active-landscape.png)
- [Native-burn consent and cost review](browser/chromium/reclaim-direct-review-native-burn-cost-viewport.png)
- [Safe sink outer transaction and costs](browser/webkit/reclaim-safe-outer-review-permanent-sink-cost-viewport.png)

`security/` preserves the original reports, exact compiler inputs/AST/ABI/sizes, individual disposition and37 passing Foundry tests. V2's7 high observations and all earlier holds remain unresolved. `failed-before/` retains unsuccessful runs as separate evidence. `indexer-isolated-postgres.json` records the earlier native PostgreSQL18.6 smoke; the browser manifest independently records the actual Linux18.6 server/UTF8 state.

Run `pnpm test:release-evidence` to cross-check these archived real inputs, including deliberate corruptions of the NFT destination, SQL reward and Safe approval. The tests do not fetch live state or replace missing records with mock success. `artifact-inventory.json` covers every tracked Task079 artifact except itself, with binary hashes for gzip/PNG and explicit LF normalization for text.

No live NFT collection is admitted. A sink transfer is not labeled a native burn. Source/runtime and non-remint/non-seizure assumptions need independent collection review before admission. Existing same-block balance attribution, archive/trace/finality and physical-wallet gaps remain release blockers.
