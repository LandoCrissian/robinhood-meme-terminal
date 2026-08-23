# Research ledger — 2026-08-23

The purpose of this ledger is to separate **verified facts**, **candidate evidence**, and **design inspiration** so future Codex work does not promote a marketing page into runtime authority.

## Robinhood Chain

### Official network documentation — verified

Sources:

- https://docs.robinhood.com/chain/connecting/
- https://docs.robinhood.com/chain/contracts/

Facts used:

- mainnet chain ID `4663`;
- native gas currency ETH;
- official public RPC exists but is rate-limited/not recommended for production;
- Alchemy is the recommended provider and archive access is recommended for historical indexing;
- WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`;
- production indexing should use provider-grade/archive infrastructure rather than assuming the public RPC is complete.

### Orbit dual clocks — independently documented by Nightgarden

Source:

- https://nightgarden.app/docs/how-it-works

Nightgarden documents a Robinhood-specific implementation pitfall: `eth_blockNumber` is the rollup height while Solidity `block.number` reflects L1 height. The plugin therefore preserves rollup block number/hash and optional L1 block number as distinct fields.

This is a strong operational clue, not a substitute for RMT independently testing the RPC/header behavior before production.

## OpenSea / Seaport

### Robinhood support — verified

Sources:

- https://opensea.io/blog/articles/robinhood-chain-is-live-on-opensea
- https://github.com/ProjectOpenSea/opensea-sdk/blob/main/CHANGELOG.md

OpenSea publicly launched Robinhood Chain support July 11, 2026. Current OpenSea SDK release notes explicitly add Seaport support for Robinhood chain ID 4663:

- canonical Seaport 1.6;
- listings use native ETH;
- offers use Robinhood WETH `0x0bd7d308f8e1639fab988df18a8011f41eacad73`;
- Robinhood is represented by OpenSea chain slug `robinhood`.

### Seaport deployment — independently anchored

Source:

- https://robinhoodchain.blockscout.com/address/0x0000000000000068F116a894984e2DB1123eB395

Blockscout identifies `0x0000000000000068F116a894984e2DB1123eB395` as `Seaport`. RMT must still pin deployment transaction/block and runtime bytecode hash when moving from research to a strict verifier.

### OpenSea API surfaces — verified documentation

Sources:

- https://docs.opensea.io/reference/get_best_listings_collection
- https://docs.opensea.io/reference/get_offers_collection
- https://docs.opensea.io/reference/generate_listing_fulfillment_data_v2
- https://docs.opensea.io/reference/generate_offer_fulfillment_data_v2
- https://docs.opensea.io/changelog/removing-deprecated-rest-api-endpoints-and-response-fields

Key implications:

- best collection listings support pagination and up to 200 results;
- best-listing results are **not deduplicated by token ID**, so RMT must dedupe before floor/sweep calculations;
- collection offers and item/trait offers are distinct order forms;
- current fulfillment endpoints return the information/signatures needed for onchain fulfillment;
- deprecated generic orders list endpoints were removed in May 2026, so adapters should target current collection-based endpoints;
- fulfillment API output is not authorization proof — RMT still verifies it locally.

### Seaport semantics — design requirement

Review Seaport order state, counters/cancellation, criteria resolvers, zones, conduits, partial fills, signatures/EIP-1271 and all consideration items before an execution tranche. An API status of ACTIVE is not sufficient if live onchain state has changed.

## Reservoir

Source:

- https://nft.reservoir.tools/reference/supported-chains

Current hosted API chain list does not include Robinhood Chain. Reservoir remains useful architectural research for aggregated orderbooks, but RMT must not depend on a nonexistent hosted Robinhood endpoint.

## HoodMarket

Sources:

- https://docs.hoodmarket.io/
- https://docs.hoodmarket.io/contracts/overview
- https://docs.hoodmarket.io/contracts/addresses
- https://docs.hoodmarket.io/developers/overview

Verified facts:

- Robinhood Chain marketplace/launch product;
- docs explicitly separate primary mint contracts from **secondary marketplace trading protocol**;
- published Launch Factory, HoodDrop V2 and SeaDrop addresses are not secondary trading contracts;
- HoodMarket explicitly says current application endpoints are private implementation details and not a supported public API;
- public API/SDK schemas are planned, not available yet.

RMT posture: candidate. Do not scrape private application endpoints and do not mislabel primary mint contracts as secondary trading authority.

## Nightgarden

Sources:

- https://nightgarden.app/docs/how-it-works
- https://nightgarden.app/docs/faq
- https://nightgarden.app/docs/contracts
- https://nightgarden.app/docs/security

Verified/documented facts:

- chain-wide NFT catalogue joins chain identity and market state strictly on `(collection, tokenId)`;
- its market contract is written/tested but **not deployed**, so trading is not live;
- it calls out stale indexed metadata and reads `tokenURI` directly for its own factory collections;
- it documents the Robinhood dual-block-clock problem;
- it documents phishing/airdrop lure NFTs as a real catalogue problem and uses multi-signal warnings/de-ranking rather than pretending the tokens do not exist.

RMT posture: catalogue-only research source. No execution capability.

## Mintera

Source:

- https://mintera.art/

The public marketplace surface demonstrates meaningful Robinhood NFT inventory/collection activity. This research pass did not establish a stable public developer API, exact secondary settlement contract, deployment boundary or ABI from first-party documentation.

RMT posture: candidate only.

## StonkBrokers / Anvil NFT AMM

Sources:

- https://www.stonkbrokers.cash/docs
- https://robinhoodchain.blockscout.com/address/0xe302733accf4800146e55fc45b46b4e4ffc032d2

Official docs currently state:

- StonkBrokers collection: `0x539cdd042c2f3d93ebc5be7dfff0c79f3b4fabf0`;
- `$STONKBROKER`: `0xe934e36a439c94017b64a3fece66af12099abf50`;
- Anvil AMM vault: `0xe302733accf4800146e55fc45b46b4e4ffc032d2`;
- the vault is live and integrator-facing functions are summarized as `buy / sell / snipe`;
- collection is ERC-721 and uses ERC-6551 token-bound accounts;
- documented trading principal is 666,666 STONKBROKER plus native ETH fees, with different regular vs snipe fee descriptions.

Blockscout independently identifies the vault as `StonkNFTAMMVault` and shows active transaction/transfer history.

RMT posture remains candidate until it independently pins:

- creation tx and deployment block;
- runtime bytecode hash;
- verified source/ABI;
- constructor/immutable bindings;
- buy/sell/snipe semantics;
- fee math from live contract state;
- event/replay provenance;
- adversarial and fork simulations.

This is a **separate provider family** from Seaport. Do not normalize its execution calldata through a Seaport verifier.

## NFT standards

### ERC-721

Source: https://eips.ethereum.org/EIPS/eip-721

Key rules used:

- globally qualified NFT identity on a chain is `(contract address, uint256 tokenId)`;
- token IDs are black boxes; never assume sequential numbering;
- `Transfer` covers ownership changes, mints and burns, with constructor caveat.

### ERC-1155

Source: https://eips.ethereum.org/EIPS/eip-1155

Key rules used:

- `TransferSingle` and `TransferBatch` are canonical balance-change events;
- event-log enumeration is explicitly recommended;
- one token ID can have quantity >1 and multiple owners.

### ERC-2309

Source: https://eips.ethereum.org/EIPS/eip-2309

Large consecutive ERC-721 ranges may use `ConsecutiveTransfer`; an indexer that only listens for ordinary `Transfer` can silently miss canonical minted items. Huge ranges should be stored/processed as bounded range jobs instead of unbounded in-memory expansion.

### ERC-4906

Source: https://eips.ethereum.org/EIPS/eip-4906

Optional metadata update events are useful refresh triggers. They change metadata evidence, not ownership.

### ERC-2981

Source: https://eips.ethereum.org/EIPS/eip-2981

`royaltyInfo()` standardizes royalty recipient/amount discovery, but royalty payment itself is voluntary/marketplace-dependent. RMT quotes must show the actual order/venue economics, not assume every venue enforces ERC-2981.

### ERC-6551

Source: https://eips.ethereum.org/EIPS/eip-6551

Canonical registry address specified by the standard:

`0x000000006551c19487814612e58FE06813775758`

An NFT can have token-bound accounts based on registry + implementation + chain + token contract + token ID + salt. Multiple account implementations/salts can exist for one NFT; do not assume a single wallet address. TBA holdings are optional enrichment and require cycle/double-counting protections.

## Market-structure research

These protocols/products are design references, not Robinhood dependencies:

- Blur — trader-oriented aggregation, sweeping and portfolio analytics.
- Tensor — Sell Now, collection-wide bids and liquidity/market-making UX.
- sudoswap — NFT AMM pools/bonding curves/partial fill primitives.
- NFTX — vault-backed NFT liquidity and fungible vault-token abstraction.

RMT should first **route and normalize existing liquidity primitives**, not deploy an RMT NFT AMM just to create another fragmented venue.

## Research conclusions

1. Asset truth must be chain-native and independent of market APIs.
2. OpenSea/Seaport is the strongest first verification-ready external venue.
3. Stonk Anvil is a valuable Robinhood-native AMM candidate and a separate execution family.
4. HoodMarket/Mintera should remain candidate until secondary settlement identity is independently anchored.
5. Nightgarden currently contributes catalogue/indexing lessons, not live liquidity.
6. Reservoir cannot be assumed as a hosted Robinhood aggregation backend.
7. The long-term RMT abstraction should be asset-neutral, but changing current fungible VNext types before the active execution work settles would create unnecessary collision risk.

## Related internal research branch

The repository already contains `research/ccff00-tba-probe`. This plugin does not treat that branch as runtime or architectural authority, and it does not overwrite it. Before implementing the ERC-6551/TBA tranche, inspect and reconcile that branch so useful CCFF00/TBA evidence is reused rather than duplicated.
