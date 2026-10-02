# RMT Project Graph — reviewed intelligence

Owner authority: `RMT_PROJECT_GRAPH_CCFF00_AND_PROJECT_MARKETS_V1`.
Implementation base: `b0ff0f344d50727156e4ced42aaaf7c667108ad3`.

## Current owner amendment

`RMT_PROJECT_MARKETS_FINAL_PRODUCT_QUALITY_V1`, base
`779ec852546c6e10006a311aca97be9779508c3c`, withdraws the active PEEPS token
relationship. Founding Feathers remains NFT-led at its existing stable `/projects/peeps`
URL. Active search, ownership composition and project edges contain only its exact
NFT contract. `OWNER_WITHDREW_TOKEN_RELATIONSHIP` and the original evidence are
retained separately in `WITHDRAWN_PROJECT_RELATIONSHIPS`; the initial verification
record below is historical, not the current active graph. This does not quarantine
or change permissionless trading for the independent token.

Project presentation uses exact-contract retained artwork with original source,
evidence class and content digests in `project-artwork-evidence.json`. These small
production assets are not review screenshots. Collection logos remain provider
presentation evidence; CCFF00 artwork comes from its onchain token URI. Retaining
them removes a runtime OpenSea dependency. CANNACAT has no separate image in the
observed Gecko token response: its token surface uses project identity artwork,
without claiming a newly verified token image. Optional market and ownership
reads remain independent, and unavailable metrics use compact states.

## Existing architecture and change

`packages/shared/src/project-identity.ts` remains the shared identity model.
It previously projected the curated NFT registry into project assets. The NFT
intake separately retained owner-confirmed Hopium and PEEPS token references.
Token presentation, artwork and the Project tab already consumed exact-address
relationships. RWA/Stock identity and origin readers remain separate authorities.

This change extends that same model with typed, provenance-bearing edges and a
reviewed source catalog. Storage is versioned repository evidence, not Firestore.
There is no new database, worker or provider. Multiple ERC20s and collections are
supported. `OWNER_CONFIRMED_PROJECT_TOKEN` is retained as relationship authority.
Names, symbols and artwork never create an edge. Watch-only NFT projects remain
outside verified Project discovery. Graph membership does not change NFT activity
sources, backfill admission, Stock Token policy or ordinary-token execution.

## Initial verification

The machine-readable record is `initial-project-evidence.json`. Public RPC reads
used installed Viem 2.55.5, individual framing and pinned block **77518907** on
chain **4663**, observed 2026-10-01. `observedAt` is verification capture time,
not project creation or the historical date the owner first confirmed an edge.
OpenSea public collection pages independently link exact Robinhood item contracts.
The owner directive supplies relationship knowledge; ERC165/ERC20 reads establish
machine facts. Neither substitutes for the other. No conflicting positive
relationship evidence was encountered in the examined intake, registry, project
site and exact collection pages. This is a bounded finding, not an exhaustive
claim about the internet.

| Project | ERC20 | ERC721 | Admission |
| --- | --- | --- | --- |
| CannaCats | `0x1139d423C1706BDeaD91f03507F521635591eD92` | `0x289c8ce652f38029867842048068b39bd0464a3f` | Verified Token↔NFT |
| Hopium Machines | `0xB6cE51925C2e397eBF1a443b343d19267B3D4225` | `0x7da15c761409cb921a81f0e003704cff418b700b` | Verified Token↔NFT |
| PEEPS / Founding Feathers | `0xf202de51bb42a0073948b0971707d14c54ef5f44` | `0xc1605fb719f388110b1b0f384b7ffd64ba4ba5df` | Verified Token↔NFT |
| CCFF00 | None admitted | `0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146` | Verified NFT-led |

The PEEPS token was not guessed: the existing owner-confirmed intake and official
`https://peeps.wtf/launchpad/peeps` explorer destination agree on the exact address.
CannaCat/Hopium supplied contracts are ERC20s, not their NFT collections. All
three ERC20 decimals reads returned 18; this catalog records those observations,
never an unknown-unit default. NFT `totalSupply()` results in this technical
capture are **not** circulating supply authority or live user-facing totals.
CCFF00's token-bound-account/getter evidence does not admit a CCFF00 ERC20 edge.
At block 77555550, read-only `balanceOf` and `allowance` calls also succeeded for
all three ERC20 contracts. The queried account was each public contract itself,
not an owner wallet. An earlier attempt at historical block 77518907 returned
RPC "Missing or invalid parameters"; that unavailable historical read is retained
in the evidence and does not establish an onchain revert or identity conflict.
No pending/rejected candidate relationship is concealed; all four requested
projects have the stated verified composition, with no asserted CCFF00 token.

Evidence classes remain distinct: OWNER_VERIFIED, ONCHAIN_VERIFIED,
PROJECT_OFFICIAL, PROVIDER_VERIFIED and DERIVED. OpenSea item identity/links are
provider evidence, not proof of ownership or a redundant requirement for the
owner-confirmed project relationship. Technical NFT clone/backfill verification
in the existing intake remains a separate worker-admission process.

## Product and API surfaces

Owner product amendment: the first-class primary navigation is **Markets |
Projects | NFTs | Portfolio | Distribution**. Projects means verified Token↔NFT
Project Markets, with the explicitly permitted CCFF00 NFT-led flagship; it is not
an arbitrary project directory. The `/projects` landing cards show exact token
and NFT collection identities together immediately, while CCFF00 has no invented
token side. Mobile uses compact cards; desktop shows a paired-market directory.
Deep intelligence and provenance stay inside the selected Project Market.

Explore → Projects remains a secondary entry. Universal terminal search uses
only verified graph entries, including NFT-led projects with no directory token row. `/projects` searches
project names, token names/symbols/contracts and collection names/contracts.
`/projects/[projectId]` is the Project Market: per-asset token market observations,
collection identity, independent ownership summaries, links and progressive
Evidence & Sources. There is no combined market cap, synthetic price or liquidity.
The existing token Project surface connects back to the Project Market. Tokens
open the existing terminal; CCFF00 opens the existing NFT inventory/items; other
collections link to the verified OpenSea destination until worker admission is
independently released. This does not invent local inventory for those collections.

Market and ownership sections stream independently into fixed geometry. Their
failure does not erase identity. Project data is never imported into quote,
verification, authorization or handoff. The existing composer/controller is
unchanged. Token↔project navigation is intentional; passive enrichment never
changes token, wallet, amount, asset or chart.
The browser regression holds a real workspace market-read response until after
amount entry and a nonterminal caret are established, then measures the actual
response publication. It separately covers a delayed 503 on a Project Market.
The browser regression also enters Projects directly from the top-level tab,
checks all five product tabs and active state, validates each paired card and the
NFT-led exception, then returns to Markets through the ordinary navigation.
The four viewport profiles are emulated and use controlled external responses;
they are not a physical iPhone or a live authenticated quote acceptance.

## Ownership facts and future interfaces

`project-ownership.ts` separates READY confirmed zero/positive from UNAVAILABLE.
`/api/projects/[projectId]/ownership?wallet=<public-address>` returns facts for an
exact public wallet. It has no signing/authorization side effect and no caching
of personal wallet responses. The UI binds reads to the existing connector-qualified
selected-wallet authority and cancels obsolete responses.

CCFF00 uses a new **read-only** endpoint on the existing NFT indexer:
`/internal/v1/projects/ccff00/ownership/<wallet>`. It requires the existing server
read token. A single SQL snapshot reads the existing ERC721 projection and its
canonical checkpoint. Only fresh SYNCED evidence publishes a count, including
zero. BACKFILLING, missing, stale, wrong-chain/contract/wallet or malformed evidence
remains unavailable. Existing transactionally persisted events/checkpoints and
reorg rebuilds own recovery; there is no second ownership store.

Non-indexed graph assets use exact `balanceOf` at one RPC block after chain4663
verification. These are head observations, **not finalized economic eligibility**.
Balances from different blocks cannot establish simultaneous token+NFT ownership.
Exact-address holder overlap requires complete canonical holder sets at the same
block/hash; current token-holder completeness is not established, so no live
overlap percentages are displayed. No wallet merging or inferred common owners.

Typed future interfaces cover Bubblemaps ENRICHMENT_ONLY, launch origins
PONS/STONKBROKERS/INDEPENDENT/OTHER_VERIFIED_SOURCE, and RWA/Stock/stablecoin
reference/issuer relationships. Nothing is populated from branding or integrated.
Proof of Holding, benefits, eligibility, Distribution and portfolio valuation are
outside this change. No Coming Soon card collection is introduced.

## Release and live limitations

Implementation/tests are not deployment or financial acceptance. The new CCFF00
wallet-count endpoint needs a separately reviewed release of the existing NFT
service; until present/healthy it returns unavailable. The three new collection
relationships do not promise indexed ownership, marketplace activation or complete
inventory. OpenSea outage cannot erase the repository graph or canonical CCFF00
ownership. No provider credentials, wallet sessions or financial actions are
required to validate the public relationship facts.

PR553 remains separate. No production configuration, DB writes, deployments or
merges are authorized by this implementation.
