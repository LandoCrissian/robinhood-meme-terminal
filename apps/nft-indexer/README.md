# RMT NFT activity indexer

Standalone, non-production backend foundation for the curated RMT NFT Terminal. It indexes only runtime-verified entries from the canonical `@rmt/shared/nft/activity-sources` manifest. V1 contains CCFF00 only and begins at its reviewed deployment block `10929152`.

The service has no public NFT data API and always reports `servingProductionTraffic: false`. It does not infer sales or any other marketplace meaning from transfers.

## Operations

Copy `.env.example` into the service environment and provide a dedicated PostgreSQL database. Startup fails if the RPC is not HTTPS/chain 4663, source deployment/bytecode/ERC-165 evidence differs, the database collides with another configured RMT database, or unrelated public tables exist.

```sh
pnpm --filter nft-indexer typecheck
pnpm --filter nft-indexer build
NFT_INDEXER_TEST_DATABASE_URL=postgres://... pnpm --filter nft-indexer test
```

The worker processes bounded finalized ranges atomically. It persists canonical event evidence and normalized movements, applies strict ownership, records a retained sync point, and advances the checkpoint in one transaction. Reorg recovery requires a retained common canonical ancestor and rebuilds ownership from retained canonical activity; otherwise it fails closed.
