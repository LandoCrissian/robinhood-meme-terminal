# RMT NFT marketplace indexer

This standalone service ingests read-only OpenSea evidence for collections already admitted through `RMT_NFT_ACTIVITY_SOURCES`. V1 is Robinhood Chain (4663), OpenSea, Seaport 1.6, and CCFF00 only.

It stores provider listings, offers, and provider-reported sales in a dedicated PostgreSQL database. It does not execute orders, claim that provider-active orders are executable, infer sales from NFT transfers, or calculate an RMT verified floor. `LOWEST_NORMALIZED_OPENSEA_LISTING` and exact-scope `OPENSEA_REPORTED_FLOOR` are deliberately weaker authorities.

Configuration is documented in `.env.example`. The OpenSea API key is required at service startup and is used only in server-side request headers. `/health` and `/status` expose internal operational state and never expose the key.

The optional `pnpm --filter nft-marketplace-indexer live-probe` command requires the normal service environment and prints sanitized counts and identity fields only. It is not part of CI or production activation.

## Production wiring

A Railway service can use `apps/nft-marketplace-indexer/railway.json`. Keep its database and read token dedicated to this service. The web application consumes it server-side through `NFT_MARKETPLACE_INDEXER_URL` and `NFT_MARKETPLACE_INDEXER_READ_TOKEN`; neither credential belongs in browser-visible configuration. Production activation also requires the OpenSea API key and Robinhood Chain RPC. Creating the Railway service/database or changing production environment variables is an owner-controlled infrastructure action, not part of repository CI.
