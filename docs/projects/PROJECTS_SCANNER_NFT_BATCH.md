# Projects scanner and NFT-led batch

Owner authority: `RMT_PROJECTS_SCANNER_AND_NFT_PROJECT_BATCH_V1`.
Authorized baseline: `0ea35d3f80c4f6e21a0b71f5035b67d6e696092d`.

Projects is RMT's intentional project directory. CCFF00 is one represented
project; admission does not imply a CCFF00 relationship, endorsement, safety,
ownership completeness, benefits or execution authority.

## Existing architecture and changes

`packages/shared/src/project-identity.ts` remains the reviewed static graph.
It already supports multiple tokens and collections, typed edges, independent
ownership readers and exact-contract search. Project directory and detail
routes consume the same identities. The four initial entries and the inactive
PEEPS token relationship history remain intact.

Discovery now uses compact scanner rows with project artwork, connected assets
and composition, using the Markets spacing and typography language. All,
Token + NFT and NFT-led are composition filters. Specialized Project Markets
retain their hero, asset cards, ownership and Evidence & Sources. Project
enrichment remains independent of charts and trading.

## Candidate authority

The batch retains `OWNER_SUPPLIED_CANDIDATE` separately from `OWNER_VERIFIED`.
The owner authorized admission conditional on technical verification, rather
than claiming these exact contracts were already personally verified. Candidate
evidence can admit an NFT identity only with independent onchain evidence and
project-official or exact provider collection evidence. It cannot authorize an
ERC-20 relationship. Existing owner-verified relationships retain their original
classes. Matching names, artwork or a slug never establishes an asset edge.

Technical evidence is in [nft-project-batch-evidence.json](nft-project-batch-evidence.json).
All twelve established collection contracts contain bytecode and pass ERC-165,
ERC-721 and invalid-interface rejection at chain 4663 block 78675838. Provider
collection items resolve to those exact contracts. Provider supply and onchain
`totalSupply` are verification observations, not current ownership metrics.
Where a project-official contract reference was not established, the report
preserves that absence rather than upgrading provider evidence.
Provider-listed social and website URLs without independent verification are
retained as `DERIVED` candidate evidence in the technical record. They are not
published as verified official links by the Project Graph.

| Project | Composition | Admission |
| --- | --- | --- |
| RECEIPTS | NFT-led | Admitted; duplicate owner input deduplicated |
| Gogh Punks | NFT-led | Admitted to Projects; NFT discovery remains WATCHING |
| Pixel Hood | Clan + Minis | Admitted as one project with two exact collections |
| Robinhood Bear | NFT-led | Admitted from the exact supplied collection page |
| Sknots Go Down | NFT-led | Admitted |
| Clay StonKz | NFT-led | Admitted |
| Robin Rabbits | One established collection | Partial; second contract not established |
| Suited Ape Society | NFT-led | Admitted |
| Stray Cars | NFT-led | Admitted |
| Spawnhood | Genesis collection | Admitted; no additional collections inferred |
| THE UNDEADZ | NFT-led | Admitted; name confirmed by collection and onchain reads |

Pixel Hood Minis' collection description explicitly identifies it as an
expansion of the original Clan collection; both exact collections identify
Pixelord. This is positive collection relationship evidence, not name matching.

Robin Rabbits' official Court names the existing verified contract. The supplied
Fringe destination and other official pages did not establish a second exact
collection. It remains pending, without a guessed contract or invented pair.
No current OpenSea destination is asserted for Robin Rabbits.

Robinhood Bear has an unusual hexadecimal onchain name. The supplied page's
items independently resolve to `0x0084e3f586dfd424b959e80537208cef4cbcee21`.
No similarly named collection or the address embedded in its name replaces that
contract. Stray Cars' description says Stray Cats while its collection title and
onchain name say Stray Cars; the exact supplied identity is retained.

## Destinations and artwork

Each NFT asset may retain multiple bounded destinations with exact-asset
evidence. Marketplace destinations require provider verification; official
collection destinations require project-official evidence. The initial graph's
exact evidenced OpenSea destinations remain compatible.

Explore NFT collection opens the stored verified collection URL directly.
Robin Rabbits uses Official collection to its official Court. Contract copy and
Blockscout explorer remain separate compact actions. CCFF00 also retains its RMT
collection workspace as a secondary action. No slug is constructed from a name.

Collection logos are retained production assets, not review screenshots.
Original source, contract, page digest, image digest, bounded transformation and
provenance are recorded in [project-artwork-evidence.json](project-artwork-evidence.json).
Some provider image paths retain older slug aliases; the image is bound through
the exact collection page and its item contracts, not through a guessed slug.
Static retained frames avoid animation and runtime marketplace dependency.
Monograms remain the final fallback. Artwork never establishes ownership.

## Release separation

No NFT registry status, indexing admission, backfill, NFT worker or database is
changed. A collection can independently qualify for NFTs while also belonging
to Projects. Missing indexed ownership remains compact unavailable enrichment.
No token relationship is added to this batch.

No PR564 worker, launch source, schema, checkpoint, cursor, backfill or Launches
UI is changed. No production configuration or deployment is performed. Public
execution remains 0x AllowanceHolder on chain 4663 with the reviewed wallet and
fee policy; Project admission cannot make an asset executable or ineligible.

## Verification

Domain checks cover candidate/onchain separation, unsupported token admission,
exact per-collection destinations, multi-collection search, preserved withdrawn
PEEPS evidence and unchanged NFT WATCHING states. Product capture covers every
admitted Project Market at 375, 390, 430 and 1440, retained artwork, compact
ownership failure, market failure and exact-token navigation. Screenshots and
videos belong to CI artifacts; no review-only binary archive is committed.

The unchanged baseline dependency graph currently fails production audit on
`@fastify/busboy` through Firebase Admin: GHSA-xjh9-v7x6-24jw and
GHSA-x8mw-p69m-v3mx. No exclusion, waiver or dependency correction is included.
Final release readiness requires those checks to pass through separately
reviewed remediation.
