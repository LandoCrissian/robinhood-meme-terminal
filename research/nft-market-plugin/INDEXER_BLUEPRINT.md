# Future `apps/nft-market-indexer` blueprint

This is a design, not a deployed service.

## Authority model

The future service should copy the **operational pattern** of `apps/market-indexer`, not its pool schema:

- dedicated PostgreSQL database;
- one writer until leader election exists;
- pinned chain ID `4663`;
- archive-capable historical source plus independent current RPC;
- confirmation boundary before publishing canonical transfer state;
- canonical block checkpoints;
- idempotent `(transactionHash, logIndex, subIndex)` event identity;
- reorg rollback to retained common ancestor;
- bounded reads;
- bearer-protected detailed APIs;
- public health limited to operational summaries;
- compiled shadow/activation lock;
- no signer, key, wallet, transaction submission, fee or treasury path.

## Do not use marketplace feeds as NFT-existence authority

NFT asset truth comes from chain evidence. Marketplace APIs/contracts are separate market evidence.

### Chain evidence to ingest

ERC-721:

- `Transfer(address,address,uint256)`
- ERC-2309 `ConsecutiveTransfer(uint256,uint256,address,address)`
- optional ERC-4906 `MetadataUpdate(uint256)` / `BatchMetadataUpdate(uint256,uint256)`

ERC-1155:

- `TransferSingle`
- `TransferBatch`
- `URI`

Interface detection is enrichment, not a reason to discard an already observed canonical transfer. Malformed or conflicting standard behavior should produce an explicit conflict state.

## Proposed tables

### `nft_sources`

Per source progress, manifest identity, start block, schema version, error state and last heartbeat.

### `nft_sync_points`

`source_id`, rollup block number/hash, parent hash, optional L1 block number. Retain enough points for the reviewed reorg window.

### `nft_collections`

Canonical contract identity, observed standard support, first observed block/tx, metadata pointers, code hash and conflict flags. Do not store a marketplace slug as identity.

### `nft_items`

`contract + token_id`, burn state, first/last canonical transfer, metadata snapshot pointer and quantity model.

### `nft_balances`

For ERC-721, exactly one live owner at quantity 1 when not burned. For ERC-1155, owner/token balances derived transactionally from event deltas.

### `nft_transfer_events`

Append-only normalized canonical transfer rows keyed by transaction/log/sub-index. Preserve source event kind and both block clocks.

### `nft_metadata_snapshots`

URI, resolved URI, content hash, media references, status, source, refresh reason and observed block/time. Metadata is not ownership truth.

### `nft_market_sources`

Venue source registration and independent state machine. A web/API source and an onchain protocol source are not automatically the same authority.

### `nft_orders`

Normalized listings/offers with source, venue, protocol/order hash, criteria, payment asset, gross amount, fee components, observed/expiry times, fillability evidence and source reference.

Marketplace API observations are ephemeral until revalidated. Never treat an API row alone as permanently fillable.

### `nft_sales`

Confirmed fills/relevant transfers with market source attribution only when transaction evidence establishes the venue/order relationship.

### `nft_tba_accounts`

Optional ERC-6551 enrichment keyed by NFT identity + registry + implementation + salt + chain ID. Never collapse TBA holdings into the NFT's base market price without an explicit valuation policy; avoid recursive/double-counted ownership graphs.

## Dual block clocks

Persist:

- `rollup_block_number` from the Robinhood Chain block/log;
- `rollup_block_hash`;
- `l1_block_number` from the Robinhood/Arbitrum block header when available.

Use rollup number/hash for chain ordering/reorg identity. Use the L1 number only when reproducing semantics of a contract value based on Solidity `block.number`.

## Metadata security worker

Metadata retrieval must run in an isolated fetcher with:

- HTTPS/IPFS/JSON-data allowlist;
- no localhost/private/link-local/multicast destinations;
- DNS rebinding protection by validating resolved IPs at connection time;
- redirect revalidation on every hop;
- connect/total timeouts;
- byte ceilings before buffering;
- content-type and JSON parsing limits;
- no script/HTML execution;
- SVG sanitized or rendered in a sandboxed image path;
- IPFS gateway responses content-hashed;
- images/media proxied rather than injected as arbitrary remote HTML.

## APIs (shadow first)

Suggested private surface:

```text
GET /v1/status
GET /v1/collections?cursor=&contract=
GET /v1/items?contract=&tokenId=&cursor=
GET /v1/owners?contract=&tokenId=&cursor=
GET /v1/orders?contract=&tokenId=&kind=&source=&cursor=
GET /v1/activity?contract=&tokenId=&cursor=
```

Every response carries:

- `authoritative` per evidence dimension, not globally;
- coverage: `complete | partial | unavailable`;
- checkpoint block/hash;
- observed time;
- source provenance;
- stale state.

## Source state machines

Chain source:

```text
backfilling -> shadow-ready -> error
```

Venue source:

```text
candidate -> identity-verified -> observing -> quote-ready -> error
```

Execution admission is deliberately **not** an indexer state.

## Cutover evidence

Before any public NFT inventory consumes the service:

1. complete chain backfill from at least two independent RPC/archive sources;
2. compare collections/items/ownership against at least one independent indexed dataset;
3. prove ERC-721, ERC-1155 and ERC-2309 coverage with fixtures from Robinhood Chain;
4. rehearse shallow and retained-window reorgs;
5. corrupt/malformed RPC and metadata responses;
6. confirm bounded storage and cursor stability;
7. publish known limitations;
8. remove activation lock only in a separate reviewed change.
