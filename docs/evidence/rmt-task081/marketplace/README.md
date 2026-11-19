# Robinhood marketplace observation

**BLOCKED_NO_BROADCAST.** OpenSea support for Robinhood Chain is observed, not absent. This does not approve RMT's new acquisition adapter or a collection/order.

The official and Pocket providers agreed at block **118245029**, hash `0x4b6aafa597aae0dd8d8c8994b650b243f5eb3c62efac3ccb98acf30b829555f7`, timestamp **2026-11-19 13:16:15 UTC**. [Raw bounded read-only evidence](robinhood-4663.json.gz) records the complete runtime hashes, provider URLs, timestamps, domain, conduit mapping and open Seaport channel. The canonical Seaport 1.6 runtime was 23,981 bytes, hash `0x95809b70c9659c30188db5fdd87103e24b1a55379af8c851fca393aba0224a00`. Four observed contract runtimes agree between providers; this is not independent source reproduction or Ethereum L1 finality.

Primary sources:

- [Official Seaport deployments at pinned commit](https://github.com/ProjectOpenSea/seaport/blob/117019831a71efb46108e379d1a873a631731dc4/docs/Deployments.md) names Robinhood4663 and canonical Seaport1.6. Runtime differs across chains in constructor-bound domain/chain/transient-storage values; matching a universal address or runtime size alone is insufficient.
- [Pinned OpenSea SDK chain bindings](https://github.com/ProjectOpenSea/opensea-sdk/blob/3b6f8655f80263942108cf31ef15f6277610cd43/src/utils/chain.ts) and [chain IDs](https://github.com/ProjectOpenSea/opensea-sdk/blob/3b6f8655f80263942108cf31ef15f6277610cd43/src/utils/chainIds.generated.ts) specify Robinhood4663, native ETH listings, WETH offers and default conduit2. The keyless public chain API independently included `robinhood`.
- [Collection identity endpoint](https://docs.opensea.io/reference/get_collection) accepts a collection slug; wallet/profile URLs are different identities. A collection response is an untrusted hint, not verified source or an executable order.
- [Best listings](https://docs.opensea.io/reference/get_best_listings_collection) and [fulfillment data](https://docs.opensea.io/reference/generate_listing_fulfillment_data_v2) distinguish listing identity from complete order/signature/fulfillment. The former returned **401** without credentials for the single bounded sample; no new key or paid service was requested. No fulfillment or wallet request was made.
- [Official Seaport order documentation](https://github.com/ProjectOpenSea/seaport/blob/117019831a71efb46108e379d1a873a631731dc4/docs/SeaportDocumentation.md) defines counters, fills/cancellation, criteria, zones/conduits and ERC721/1155 consideration. A future adapter must restrict its supported subset and verify every consideration item, seller signature/status, ownership/approval, exact recipient, expiry, route runtime and all-in cap; raw marketplace calldata is never admitted.

Both RPCs corroborated the previously recorded historical `OrderFulfilled` receipt `0xbbd7ebdc2b3665ae7781afbf8854125ed430baaf2bb1fd4629612b6e269827fe` and its canonical block. Its WETH offer and NFT/marketplace/creator consideration establish past venue use only. This probe does not independently re-prove every historical asset transfer. The LAMMB collection URL was used solely as an existing public identity sample; no LAMMB purchase, admission, funding or royalty change follows.

Current blockers are specific: Blockscout source API requests returned **403** for all four venue/payment contracts, so exact independently rebuilt source-to-runtime equivalence is unverified. Current complete order/signature, cancellation/fill state, seller approval, collection authority, required zone and recipient-compatible fulfillment are not verified. The local synthetic adapter is not Seaport-compatible merely because canonical Seaport exists. Production NFT acquisition remains hard-disabled. Unsupported proxies, missing source and ambiguous collections are rejected by the resolver; no live collection is admitted.

The resolver never fetches a user URL. It parses only an exact OpenSea collection path or contract address, then requires separately trusted bounded metadata/source adapters, chain/code/ERC165 checks at one numbered block and canonical hash recheck. Names are untrusted display text; artwork/traits/links are not fetched or treated as instructions. Collection verification leaves listing, route and execution unverified and purchasing disabled. Its native/ERC20 payment allowlist is explicit, not derived from a ticker or arbitrary metadata.

Reproduce without a wallet or transaction:

```sh
node scripts/nft-marketplace/probe-4663.mjs /absolute/outside-repository/observation.json
node --test packages/launchpad-common/nft-collection-resolver.test.mjs scripts/nft-marketplace/*.test.mjs docs/evidence/rmt-task081/marketplace/*.test.mjs
```

Only fixed public endpoints and existing read-only RPC methods are admitted. No source code was copied into RMT; upstream URLs/commit/source-response hashes are evidence, not imported dependencies. Own-token buyback pricing gates remain independent and unchanged.

The unchanged Gitleaks8.30.1 raw scan reported nine generic-key observations: one public OpenSea conduit identifier, six WETH contract references and two NFT contract references. A script scan separately reported the same public conduit literal once. [Machine classification](public-data-classification.json), raw redacted scanner reports and original decompressed evidence hashes retain those exact observations. Every value was checked against canonical public SDK/provider identities before compression. No detector/configuration was changed; these are not a claimed zero-finding scan or credential-safety waiver.
