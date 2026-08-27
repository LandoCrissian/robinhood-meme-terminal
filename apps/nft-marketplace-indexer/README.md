# RMT NFT marketplace indexer

This standalone service ingests read-only OpenSea evidence for collections already admitted through `RMT_NFT_ACTIVITY_SOURCES`. V1 is Robinhood Chain (4663), OpenSea, Seaport 1.6, and CCFF00 only.

It stores provider listings, offers, and provider-reported sales in a dedicated PostgreSQL database. It does not execute orders, claim that provider-active orders are executable, infer sales from NFT transfers, or calculate an RMT verified floor. `LOWEST_NORMALIZED_OPENSEA_LISTING` and exact-scope `OPENSEA_REPORTED_FLOOR` are deliberately weaker authorities.

Configuration is documented in `.env.example`. The OpenSea API key is required at service startup and is used only in server-side request headers. `/health` and `/status` expose internal operational state and never expose the key.

The optional `pnpm --filter nft-marketplace-indexer live-probe` command requires the normal service environment and prints sanitized counts and identity fields only. It is not part of CI or production activation.
