# RMT NFT production activation

This runbook prepares the NFT experience for bounded production activation without changing admission or execution authority.

## Services

Deploy two isolated Railway services from this repository:

- `rmt-nft-indexer` using `/apps/nft-indexer/railway.json`
- `rmt-nft-marketplace-indexer` using `/apps/nft-marketplace-indexer/railway.json`

Each service requires its own PostgreSQL database and its own random read token. Do not reuse the market-indexer database or credentials.

## NFT indexer

Required server variables:

- `NFT_INDEXER_DATABASE_URL`
- `NFT_INDEXER_RPC_URL=https://rpc.mainnet.chain.robinhood.com/`
- `NFT_INDEXER_READ_TOKEN`

Require `/health` healthy before wiring web reads.

## Marketplace indexer

Required server variables:

- `NFT_MARKETPLACE_DATABASE_URL`
- `NFT_MARKETPLACE_OPENSEA_API_KEY`
- `NFT_MARKETPLACE_RPC_URL=https://rpc.mainnet.chain.robinhood.com/`
- `NFT_MARKETPLACE_READ_TOKEN`

The OpenSea key and read token remain server-only. Require `/health` healthy and a sanitized live probe before wiring web reads.

## Web wiring

Only after both services are healthy, add these server-side production variables to the web deployment:

- `NFT_INDEXER_URL`
- `NFT_INDEXER_READ_TOKEN`
- `NFT_MARKETPLACE_INDEXER_URL`
- `NFT_MARKETPLACE_INDEXER_READ_TOKEN`

Mint Radar additionally needs its existing server-side OpenSea/RPC configuration. Do not expose credentials through `NEXT_PUBLIC_*`.

## Acceptance

Before claiming the NFT experience live, verify:

1. `/nft` renders Mint Radar, Active Collections and On Our Radar.
2. WATCHING collections remain discovery-only and cannot enter an RMT project market.
3. CCFF00 Project Market shows canonical artwork only when inventory is AVAILABLE.
4. Holder and circulating counts appear only from a complete canonical ownership projection.
5. Marketplace listings/sales remain explicitly provider evidence and never become execution claims.
6. Item pages preserve owner, token-bound account, collection, chain and metadata provenance.
7. Desktop and iPhone navigation works Discovery → Project Market → NFT → Collection.
8. Degraded service states show unavailable/backfilling states without fabricated metrics or artwork.

Production infrastructure creation, credential changes and deployment remain explicit owner-authorized actions.
