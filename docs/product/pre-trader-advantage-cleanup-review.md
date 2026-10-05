# Pre-Trader Advantage cleanup

Owner scope: `RMT_PRE_TRADER_ADVANTAGE_CLEANUP_V1`, base
`6d0b8103bdad95367445a38e5f5327458baa9ab2`. This change is for independent
review; it does not authorize merge, deployment, asset admission or execution.

## NFT ordering authority

ERC721 inventory token IDs are canonical decimal uint256 strings in the API,
stored as PostgreSQL `numeric(78,0)`. Inventory order is strictly ascending
numeric order. The exclusive `afterTokenId` cursor uses that same order;
`nextCursor` is the last returned ID only when another row exists. JSON strings
and BigInt validation preserve precision through the maximum uint256.

The old query selected `token_id::text` without a distinct alias and used
`ORDER BY token_id`. PostgreSQL resolved the sort to the text output column,
although the WHERE cursor still compared the numeric storage column. The
genuine 24-row response included 10000 before 1001. The web reader correctly
rejected it rather than normalizing an already incorrectly paginated slice.

The query now qualifies `o.token_id` for both ordering and cursor comparison.
No schema, index, storage, cursor format or web validation changes are needed.
The web never exposed a next-page link from the rejected response. An old direct
API cursor remains an exclusive numeric lower bound, not a text-page position;
clients with an old invalid page must start a fresh traversal to recover omitted
earlier IDs. This is not a checkpoint reset.

Regression coverage executes real PostgreSQL reads across numeric boundaries,
adjacent integers above Number.MAX_SAFE_INTEGER, 2^255 and 2^256−1, with complete
paginated traversal and strict reader rejection of text ordering. Dynamic NFT
destination `prefetch={false}` remains intact.

## Markets secondary filter

Primary activity remains Active, Movers, New and Trending. The overlay filters
the existing market universe only:

- All Markets: positively established directory inventory.
- Project Tokens: existing admitted ERC20 Project Graph relationships.
- RWA: existing canonical-stock-token or RWA-paired market evidence.
- Stock Tokens: existing view-only Stock Token classification.
- Held, separately under Your markets: existing confirmed wallet read evidence.

Loaded inventory supplies counts; unknown evidence remains unknown. No token
relationship or activity eligibility is inferred. Launches is removed from the
secondary filter; the first-class Launches, Projects and NFT routes remain
unchanged. The trigger shows the selected scope without a permanent Explore
prefix. Mobile uses a compact modal sheet; desktop uses an anchored popover.
Both overlay the scanner without changing its layout. Escape/close restore
trigger focus. Selection retains the independent activity axis.

Scope history continues to use `universe`. Obsolete/unknown secondary universes
normalize to All Markets (or the existing legacy RWA view) using replaceState,
without adding a history entry. Existing `view=all` compatibility URLs still
cover the broad inventory, but no duplicate Any activity control is exposed.
Visual inventory tests use that compatibility route rather than a removed UI
control; their row, navigation and evidence assertions remain enforced.

## Evidence and release boundary

Corrected UI acceptance runs locally; production is not changed. NFT navigation
acceptance additionally replays captured genuine authenticated production
inventory/item evidence through the corrected local PostgreSQL query. That
capture is a bounded subset, not a claim that all production inventory was
reconstructed. Full uint256 ordering/pagination correctness is tested separately
in the dedicated local/CI PostgreSQL database.

Discovery, passive search-row enrichment, selected-market price authority,
60-second Markets/30-second Launches refresh, interaction hold and execution
boundaries are preserved. No Launch producer, Project Graph, provider, fee,
Privy, treasury, database configuration or PR553 change is included.
