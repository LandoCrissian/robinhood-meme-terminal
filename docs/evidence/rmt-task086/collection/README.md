# Task086 collection source and transfer evidence

Status: **BLOCKED_NO_BROADCAST — collection NO_GO; CURRENT_ORDER_UNAVAILABLE.** Exactly one candidate was inspected: chain4663 collection `0x7a543c61c021e9a5c7949faBdc2f4e0a58088daf`, NFT478. No additional market search, signature, approval, transaction, state override or live purchase occurred. The production catalog remains empty.

[Observation](collection-policy-observation.json), [original public responses](raw-public-responses.json.gz), [manifest and unchanged scanner results](probe-manifest.json), [source/authority matrix](source-authority-matrix.json), [archival license notices](UPSTREAM_NOTICES.md).

## Canonical evidence limitation

The final capture ran **2026-11-20T02:39:20.147Z–02:39:50.029Z** at height **118715542**, hash `0x7d1b0cd49e3ef0eab841af0579691509d1f81728f995cddc56b52c3308df7a0f`, timestamp1795142366. The official RPC completed its canonical recheck. Pocket returned matching initial header and all37 anchored code/call responses, but its final `eth_getBlockByNumber("0x7137496", false)` returned JSON-RPC `result:null`. That is a missing canonical witness, not a successful recheck. The final observation records `corroborated:false`, `RPC_RESULT_UNAVAILABLE`, and no qualified top-level anchor/state.

The [original report](collection-policy-observation.initial.json) and [exact capture producer](capture-producer.mjs) are retained. The final report additionally restores Pocket's partial point **offline**, only after matching every archived code/call result or revert data to the official response. It preserves `canonicalRechecked:false`, records zero new network reads, and never upgrades the capture to corroborated. The manifest separately binds the original capture producer, initial report, offline reconstruction producer and final report. Future collector runs retain partial points as they are captured. The policy review must remain UNAVAILABLE/NO_GO without both canonical witnesses.

Earlier raw attempts are preserved separately:

| Archive | Meaning |
| --- | --- |
| [development-first](development-first/README.md) | Both RPCs completed at118699215/hash`0x65288242e36eb3e6de1a88d4c76af69546fd5dbf62a8561fff2f77db82f77656`. The producer changed while it ran, so its emitted producer hash does not identify the executing module. This is development evidence, never producer-bound qualification. Its older schema also omits approvalPresent. |
| [development-sequential-archive-failure](development-sequential-archive-failure/collection-policy-observation.json) | Original sequential capture at118700714; Pocket could not finish aged anchored reads. Retained as degraded evidence. |
| [development-concurrent-rate-limit](development-concurrent-rate-limit/collection-policy-observation.json) | First concurrent rerun reached HTTP429 on Pocket code retrieval. Retained as degraded evidence. |
| Final sibling archive | One bounded retry used concurrent providers with Pocket limited to one request in flight and250ms spacing. Final canonical header returned null as described above. No further live retry was made. |

## Observed source and authority

The following rows describe anchored code and state captured by the official RPC, with equal raw Pocket code/calls but **without** Pocket's final canonical witness. They establish no production admission.

| Role | Address | Evidence and remaining boundary |
| --- | --- | --- |
| Collection | `0x7a543c61c021e9a5c7949fabdc2f4e0a58088daf` | Exact45-byte EIP1167 fixed clone points to the following implementation. The clone itself has no separate hosted source. This fixes the implementation address, not mutable state/validator authority. |
| Implementation | `0x09a26fc8fcef18192e267d7a6da9dfb4be81dd6a` | Full runtime matches legitimate Sourcify4663 ERC721SeaDropCloneable source; no independent recompilation is claimed. |
| Validator | `0x721c008fdff27bf06e7e123956e2fe03b63342e3` | No4663 hosted source was available. Chain1 CreatorTokenTransferValidator executable bytes match outside explicit immutable ranges. Reference constructor/module slots bind the three module addresses below to actual runtime words. Actual4663 deployment constructor and every domain immutable remain unverified. |
| EOA registry | `0xe0a0004dfa318fc38298ae81a666710eadceba5c` | Full4663 runtime matches chain1 hosted EOARegistry reference. |
| Management module | `0x721c002d2cae3522602b93a0c48e11dc573a15e3` | Full4663 runtime matches chain1 ModuleCollectionAndListManagement reference. |
| Safe delegate module | `0x721c0086cc4f335407cc84a38ce7dcb1560476b0` | Reference constructor parameter safeDelegateModule_; hosted compile unit ModuleRulesetBindings; full4663 runtime matches that reference. |
| Bound ruleset | `0x00721ce73fde1e57a9048e0e19b7ee7c8d3f10e3` | boundRuleset(0) selects this address. Full4663 runtime matches chain1 RulesetWhitelist reference. |
| Seaport | `0x0000000000000068f116a894984e2db1123eb395` | Genuine previously pinned runtime hash`0x95809b70c9659c30188db5fdd87103e24b1a55379af8c851fca393aba0224a00` matches. Source/runtime identity does not admit this collection or an absent signed order. |

This exhausts the bounded eight-role source inventory. The collection owner `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA` has23-byte EIP7702 delegated code; its delegation target, key control and administrative call closure are unreviewed. Validator/list owner `0x591Aa9dfF01B8144DC17Cb416001D9aC84b951cd` has12,878-byte contract code, hash`0xa8c88f963781240d1488a5daa469fefc49f2b373f9ee70fa7e360618f3ce92e0`; its implementation, signer threshold, upgrade and privileged powers are unreviewed. No EOA independence or multisig guarantee is inferred from these addresses.

Observed collection security policy is rulesetId0/listId0/customRuleset0/globalOptions0/rulesetOptions2/tokenType0. Source exposes mutable collection-validator, list/ruleset, royalty and supply controls; those are not frozen by code hashes. The source matrix retains every original source-file SHA and explicit SPDX or null. Explicit headers are MIT; tm-core-lib files without SPDX remain unadmitted license/provenance gaps. Task085 notices are reused honestly, not treated as proof that every dependency is MIT or independently compiled.

## Seller approval, validator and royalties

NFT478 owner is `0x5EBb2e071aE9bf1B2313d1c65c99370e9564A19a`; token-specific approval is zero. Seaport `isApprovedForAll` is false, while the marketplace conduit approval is true. The direct zero-conduit Seaport transferFrom call fails `0x59c896be` (`TransferCallerNotOwnerNorApproved`). This is missing seller authorization and does not establish an immutable receiver ban.

The approved conduit transfer and both explicit validator calls fail `0xe1f1d02e`, whose legitimate source name is **CreatorTokenTransferValidator__CallerOrFromMustBeWhitelisted**. validateTransferSim agrees; both operator whitelist reads and the seller whitelist read are false. The sampled seller/receiver freeze reads are false. This is a current caller/from whitelist restriction, not evidence of a permanent smart-contract receiver ban.

The receiver in this public observation is the existing Operations Safe contract sample `0xAF9F10258b091719618c19D057F9cDAB72eFFd8b`, **not a deployed V2 vault**. Actual isolated V2-receiver fork evidence belongs to the separate Task086 acceptance artifacts. Public read-only transfer failure is not a purchase/custody proof.

ERC721 support is true and ERC1155 support false; maxSupply and totalSupply are720. royaltyInfo(478,1ETH) returns the collection owner and0.1ETH. This is an ERC2981 quote, not the missing signed order's precise royalty consideration, payment recipient admission or authority to change live royalties. Issuer policy can change in the same block or freeze a received NFT later. The existing vault does not atomically bind this offchain policy fingerprint. No revalidation or code hash removes those risks.

## Missing order and next external input

The fixed OpenSea listings API returned401 without credentials. The public collection UI returned200 and a listing summary only. There is no complete OrderParameters, seller signature or supported executable current order. Counter/status, exact signed native consideration and royalty/fee recipients, expiry/domain and final custody cannot be qualified from a displayed price. **CURRENT_ORDER_UNAVAILABLE** is an external input limitation.

The only next external input is an already seller-authorized complete signed supported order payload supplied voluntarily, or owner approval of a lawful complete-order data source. Do not request private keys, seed phrases, a new live signature, seller approval, payment or an authentication bypass. An input would still require fresh canonical collection/source/authority review, the existing strict importer and all release gates. Production catalog, automatic purchases, signing and broadcasting remain off.

## Bounds and verification

The final capture contains98 responses,82 read-only RPC requests and16 fixed public GETs;6,296,540 raw envelope bytes,1,036,731 compressed bytes. Collector bounds are160 RPC reads,16 GETs, four concurrent public GETs, up to eight concurrent RPC reads and one in-flight Pocket request with250ms spacing. Every request uses credentials omit, redirect error,10-second timeout,2MiB public-body/256KiB RPC-body limits and8KiB RPC-parameter limit. Only eth_chainId, eth_getBlockByNumber, eth_getCode and eth_call are permitted.

All four original raw envelopes **and** their unescaped HTTP response bodies were separately scanned using unchanged **Gitleaks8.30.1** and unchanged repository config. **Eight scans: exit0, zero findings; no detector/config/ignore/suppression changes.** Each archive manifest binds compressed/raw/report bytes and the scanner version/config/body hashes. The license matrix and source-response hashes retain upstream content identity.

The focused tests exercise drained concurrency, distinct approval/policy failures, module runtime drift, bounded public-response replay, JSON-RPC identity/HTTP failure, partial-provider reconstruction/drift rejection, all four archives, source-file attribution and all eight scan reports. The replay's positive canonical witness is explicitly synthetic; the real archived null recheck remains unavailable. Existing safety, security findings, local vault chain31337 restriction, immutable TreasuryV1 beneficiary rights and Reclaim freeze are unchanged.

```sh
node --test scripts/seaport-acquisition/probe-collection-policy.test.mjs
```
