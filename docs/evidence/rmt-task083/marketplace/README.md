# Task083 marketplace and payment qualification

**BLOCKED_NO_BROADCAST. Current listing unavailable; no production payment or purchase admitted.**

The [raw qualification](marketplace-qualification.json.gz) independently recompiles preserved Task082 Seaport/controller source inputs and records fresh public, read-only Robinhood observations. Official and Pocket RPCs corroborated block **118385295**, hash `0x29b23e1a937c0c78dfcbc7d9b00c4844118d2c96b85b3a7d7af58cc9062cfd00`, for the Seaport/controller/conduit runtime comparison. Exact raw block identities take precedence over this prose. No production transaction, owner signature, private wallet or funded purchase was used.

| Source/payment component | Independent result | Remaining qualification |
| --- | --- | --- |
| Seaport 1.6, solc 0.8.24 | All executable bytes and 12 immutable values reproduce; fresh runtime matches both providers. | Source correspondence is not an audit, current order or financial approval. |
| ConduitController and embedded Conduit, solc 0.8.14 | Executable bytes reproduce; exact recorded 53-byte CBOR differences remain visible. Source hashes match the published source metadata. | Original metadata IPFS request returned HTTP429 and stopped. Original complete compiler inputs remain unreproduced. The new vault admits zero conduits only. |
| Wrapped-native TransparentUpgradeableProxy, solc 0.8.16 | Full original runtime, including metadata, independently reproduces from preserved source. | A proxy codehash does not freeze its implementation or administration. |
| aeWETH implementation, solc 0.8.16 | Executable bytes independently reproduce; actual runtime matches both providers after the exact original 53-byte CBOR qualification. | Original metadata input remains unreproduced. This includes gateway-only bridge burning and native deposit/withdraw behavior. |
| ProxyAdmin | Published solc 0.8.19 input independently reproduces executable bytes. | Original onchain CBOR names solc **0.8.16**. The published 0.8.19 reproduction is not the original compiler input. Its exact 53-byte metadata difference remains explicit. |

The implementation remains `0xc6b81b429797e0f555440b70cd99e032d7ae947e`; ProxyAdmin remains `0xa3acd31afb851b4eb9dad00f5204c01d924267df`; both providers observe owner `0x2A153c6A1B66DBc930a8d7017230ab0253005C09`. Source shows `onlyOwner` control of upgrade, upgrade-and-call and admin replacement, without an inherent immutable notice or quorum. An observed address does not establish its controlling signer set, threshold, operational policy or acceptable future upgrades. **Production aeWETH remains unadmitted.**

Native ETH and ERC20 payment are separate paths. Native fulfillment forwards exactly the signed total from independently accounted prefunding and verifies every recipient delta; no ERC20 approval exists. The isolated ERC20 tests use a separately deployed immutable synthetic currency, exact temporary approval and post-fill allowance zero. They do not certify the production aeWETH proxy. Synthetic fee and royalty amounts are test inputs, not approved production economics. The entire signed consideration and current ERC2981 admission are checked; Seaport itself does not guarantee an RMT royalty policy.

## Current-order source investigation

The documented [OpenSea best listing by NFT endpoint](https://docs.opensea.io/reference/get_best_listing_nft) returned **HTTP401** without credentials. Its documentation specifies `x-api-key`. No paid key, private backend, session-cookie reuse or access-control workaround was attempted. The collection URL selects identity only; it provides no seller signature or executable calldata.

[Reservoir's published supported-chain list](https://reservoirprotocol.readme.io/reference/supported-chains) and [Rarible's API support list](https://docs.rarible.org/docs/supported-chains) did not advertise Robinhood in the fetched public documents. A public Rarible marketplace page alone does not establish an API order feed. The [HOODIES public marketplace landing page](https://www.robinhoodnfts.com/marketplace/) request failed; no documented bounded Seaport order API was established, and no restricted backend was scraped. These observations establish no independently verifiable current signed order. Historical filled bids remain historical evidence.

`scripts/seaport-acquisition/listing-source.mjs` is a read-only transport candidate with a fixed documented OpenSea GET origin/path, no credentials/redirects/pagination, eight-second timeout, 512KiB streaming cap, HTTP timestamp checks, exact collection/chain/order/currency/quantity/total binding and the unchanged Task082 independent cryptographic/onchain verifier. It cannot accept an execution URL or API-supplied calldata. Its six tests use explicitly mocked source/RPC transport and genuine test EOA signatures; their positive result is not a live listing claim. Every result keeps execution disabled.

## Fixture and evidence boundary

`scripts/seaport-acquisition/fixture-run.mjs` starts its own loopback Anvil, chain31337, with fresh random test EOAs. It accepts executable paths and a fresh output directory; it accepts no transaction RPC URL or owner key.

- Default mode uses the existing pinned Base Sepolia dependency fork and genuine fixed-supply core to create an explicitly synthetic 1B project. It deploys actual archived source-derived Seaport/controller bytecode and the new V2 candidate. No production RMT token is created.
- `--fork-robinhood` reads a fresh official/Pocket-corroborated 4663 anchor and verifies the actual canonical Seaport runtime. Its information/domain behavior is checked on local chain31337. Project/core/NFT/currency bindings are explicitly synthetic; the existing Base Sepolia core pins are never silently changed into Robinhood pins.
- Receipt/trace cases cover both NFT standards and payment paths, replay, cancellation, wrong delivery, immediate disable/epoch invalidation, orphaned custody/accounting rollback, provider outage and a genuine archived Safe1.4.1 two-owner EIP1271 seller with a distinct gas payer. Connected browser/database work runs through the same chain callback. Safe runtime/source archive provenance remains separately labeled; it is not a new Safe compiler reproduction.
- There is no mocked Seaport fallback when the actual fork fails. A failed archive/proof/provider prerequisite retains failure evidence. This Windows host has no Anvil/Forge executable; fixture execution belongs to actual CI results. Syntax/import checks and 12 marketplace/listing evidence tests passed locally. Contract, connected PostgreSQL and browser execution must not be inferred from these unit checks.

## Reproduction and privacy

Portable solc 0.8.16 and 0.8.19 were fetched from the official [solc-bin repository](https://github.com/ethereum/solc-bin) outside the worktree and checked against its exact official SHA-256 pins. Windows hashes are `84976fb1fc2b29267020d2ca0a3a877f0ec6f88018307d32bfbb43bece865767` and `00d3b5ca64b097964ed6d70d9805a63fdd27113b07c1b2559dbfdd579f994508`; Linux hashes are `1632786c6c1f856a4a899232ec975a12f305118f43cce90e724ed0b2eebfeee1` and `7a5c1d3dc9a8eba62bb2ec37192c9178ae5fe8a54a56e5573fd3c9c17cd9eb48`. Exact versions/inputs/compiler hashes and metadata offsets are in the raw evidence.

```sh
node scripts/seaport-acquisition/provenance-qualify.mjs \
  --solc-seaport /pinned/solc-0.8.24 --solc-controller /pinned/solc-0.8.14 \
  --solc-implementation /pinned/solc-0.8.16 --solc-admin /pinned/solc-0.8.19 \
  --output /fresh/outside-repository/marketplace
node --test scripts/seaport-acquisition/listing-source.test.mjs \
  scripts/seaport-acquisition/provenance-qualify.test.mjs
node scripts/seaport-acquisition/fixture-run.mjs --anvil /pinned/anvil \
  --solc /pinned/solc-0.8.26 --output /fresh/outside-repository/fixture
```

Do not rerun unavailable/rate-limited source requests as an access workaround. All raw responses were scanned before archival with Gitleaks8.30.1 and the unchanged repository configuration. Raw scan exit **1**, its two findings and exact original bytes are preserved. Both findings are independently reproduced public runtime hashes, with exact line/value/source-response hashes and both-provider binding in [manifest.json](manifest.json); unknown findings are zero. No suppression, detector change or history rewrite was added. The prior full-history raw failure remains independent and unchanged.

Compressed [implementation source](weth-implementation-source.json.gz) and [admin source](weth-admin-source.json.gz) preserve the public Sourcify responses byte-for-byte. Their source SPDX/copyright/license notices remain inside the raw source: aeWETH/Offchain Labs files use Apache-2.0; OpenZeppelin files use MIT. Existing Seaport/controller and official Safe archives retain their original notices. No source-response content was altered to avoid a scanner observation.
