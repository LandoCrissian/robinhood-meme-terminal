# Current native-ETH listing and collection observations

**BLOCKED_NO_BROADCAST. No current executable signed order, collection purchase policy or production payment route is admitted.**

The fixed-target [read-only probe](../../../../scripts/seaport-acquisition/probe-current-native-sources.mjs) began **2026-11-20 00:05:41.252 UTC**. Robinhood's official and Pocket public RPCs corroborated numbered block **118625674**, hash `0x0325a0a27de7e9c9d465086b6c422d30d5d19791a52222c0f063813cf813fda7`, timestamp **2026-11-20 00:05:51 UTC**. Both canonical headers were reread. These are L2 observations, without an independent L1 finality proof or durable archive SLA.

[Structured observation](current-native-source-observation.json) · [61 original bounded responses](raw-public-source-responses.json.gz) · [Integrity and unchanged scanner results](probe-manifest.json) · [Source excerpts and hashes](source-policy-excerpts.json) · [Upstream MIT notices](UPSTREAM_NOTICES.md).

## Listing-source verdict

| Source | Actual observation | Admission consequence |
| --- | --- | --- |
| [Documented OpenSea listings GET](https://api.opensea.io/api/v2/listings/collection/lammbs-59693791/best?limit=1) | HTTP401, 70-byte missing-key response | Final access boundary. No key, cookie, account, restricted API or alternative authenticated endpoint was used. |
| [Public OpenSea collection UI](https://opensea.io/collection/lammbs-59693791) | HTTP200; 50 native-ETH best-listing summaries in the public HTML hydration data | A current-looking asking-price claim is observable. Full OrderParameters, seller signature, exact consideration/payees, order hash, order type, zone and conduit are absent; it is **not** an independently executable admitted order. |
| Recent Seaport `OrderValidated` logs | Both providers return zero logs in the same bounded 10,000-block window **118615675–118625674**, capped at100 logs | Not a chain-wide scan or evidence that no orders exist. A validation log alone would still require exact publicly published validate calldata/signature and current status/counter/ownership/approval proof. |
| [Hoodies/RhinoMarket public page](https://www.robinhoodnfts.com/marketplace/) | Timed out in this capture; the public product describes a different settlement contract | No current Seaport order established. No private backend was accessed. |
| [HoodMarket documentation](https://docs.hoodmarket.io/) | Fetch unavailable in this capture | No supported current-order endpoint established. |
| [RelicRadar public UI](https://radar.radiorelic.fun/) | HTTP200 aggregate collection/mint UI | Aggregate floor/mint data is not a structured signed Seaport listing. |

One **UI claim**, NFT478, was reported as listing `0e7dbbe77e683649800eef790c5aa9cd`, seller `0x5EBb2e071aE9bf1B2313d1c65c99370e9564A19a`, displayed price **0.00068442ETH**, quantity1, start **2026-11-20 00:05:29 UTC**, end **2026-11-27 00:05:29 UTC**. This is the exact observation at capture, not a current quote or transaction instruction. The floating-point display price is never converted into executable integer consideration. The UI ID is not asserted to be the Seaport order hash. Other summaries expire quickly, and no ongoing feed, retrying scraper or watcher is activated.

**Verdict: `NO_CURRENT_EXECUTABLE_SIGNED_NATIVE_ORDER_ADMITTED`.** Public access is broader than the earlier API401 alone demonstrated, but the accessible UI omits the cryptographic and payment material needed for the supported order subset. Historical fills and bids remain historical. No seller signed payload was supplied during this task, and no signature was inferred from on-chain logs or requested from a live wallet.

## Candidate collection: purchase eligibility

This candidate was selected because it is the collection in the already retained public historical receipt and API target. It is **not an owner-approved purchasing collection**. No LAMMB permission, royalty change, live order execution or production integration is implied.

| Boundary | Corroborated observation | Status/limitation |
| --- | --- | --- |
| Identity | LAMMBs, chain4663, collection `0x7a543c61c021e9a5c7949faBdc2f4e0a58088daf`; ERC721 interface true, ERC1155 false | Identity/interface evidence, not safety or purchasing approval. |
| Clone/runtime | Exact45-byte EIP1167 clone, runtime hash `0xe3e252831cdd0c11e1327d04a57ddd9bfa11ef49d50edb524040d98bfb228bc4`; fixed implementation `0x09a26fc8fcef18192e267d7a6da9dfb4be81dd6a` | Clone routing is fixed; mutable delegated application state remains relevant. |
| Implementation source | Public Sourcify4663 source `ERC721SeaDropCloneable`, solc0.8.17; hosted full runtime equals observed21,257-byte runtime, hash `0xda60742d810ae5de9c087af2e82b05fb84e9112cfade927fca0db6490ea52519` | Hosted exact correspondence was checked. This task did **not** independently recompile the implementation. Original clone-address source endpoint returned404; this does not erase the source recovered through its verified implementation. |
| Issuer powers | On-chain owner `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA`; source permits owner changes to royalty, maxSupply, metadata, allowed SeaDrop and transferValidator. Observed maxSupply/totalSupply720/720 | No unrestricted seize/force-transfer entry point was found in the reviewed collection implementation. This is a source-inspection statement, not proof about an unreviewed validator/module closure or an immutable supply cap. |
| Transfer restrictions | Current validator `0x721C008fdff27BF06E7E123956E2Fe03B63342e3`; source invokes it for nonmint/nonburn transfers | Owner can replace validator. Future transfer/custody behavior is not immutable merely because clone runtime is pinned. |
| Validator source |4663 Sourcify endpoint404; Ethereum reference source observed,24,012-byte executable matches **outside explicit immutable ranges**, while full runtime differs | Chain/domain/internal immutable bindings are preserved in the report, not ignored as authority. No fresh independent compilation or management-module/EOA-registry/ruleset closure admission. |
| Validator policy | owner `0x591Aa9dfF01B8144DC17Cb416001D9aC84b951cd`; rulesetId0/listId0/customRuleset0/globalOptions0/rulesetOptions2/tokenType0; bound ruleset `0x00721CE73fDE1e57A9048E0e19B7ee7c8D3F10E3` | Observed settings do not establish who controls all mutable lists, modules or future policy. No approval is inferred. |
| Seller478 | Current owner equals UI seller; token approval0; `isApprovedForAll(seller,Seaport)`false; canonical OpenSea conduit approvaltrue | The existing **zero-conduit** route cannot use this seller's conduit-only approval. No signature or supported zone/conduit terms were available. |
| Safe-receiver read | `validateTransfer` simulated from the actual collection, with seller478, canonical Seaport or conduit and deployed Operations Safe receiver, reverts `0xe1f1d02e` on both providers | Exact bounded read evidence, not a real purchase or a universal claim that all Safe/vault receivers fail. Underlying authorizer/validator closure remains unqualified; no permission is added to force compatibility. |
| Royalty evidence | `royaltyInfo(478,1ETH)` returns owner beneficiary and0.1ETH | This is the current ERC2981 result, not the exact royalty for missing signed consideration, an RMT entitlement, or authority to alter live royalties. |

**Collection purchase status: NO_GO.** Source, mutable-policy authority and actual receiver-specific route admission remain incomplete; no owner collection policy is approved. This is entirely separate from permanent Reclaim surrender/burn eligibility. Reclaim remains frozen.

## Native payment and watcher consequences

Native ETH avoids a payment-token approval, proxy or rebasing assumption. It does not establish an NFT's value, order authenticity, collection policy, royalty correctness or RMT custody. The missing signed payload prevents verification of exact all-in consideration, marketplace/royalty recipients, zero zone/conduit, current counter/unfilled status and final custody. aeWETH/other productionERC20 remain separately NO_GO under the preserved authority limitations. No WETH substitution, calldata fetch or broadened vault capability was added.

The anchor header records `baseFeePerGas` **20,100,000wei (0.0201gwei)**, block `gasUsed` **361,606** and `gasLimit` **1,125,899,906,842,624**. These describe that block, not the gas needed for an NFT acquisition. No genuine executable-order calldata was available, so an actual current-order execution-gas estimate, L1 data-cost component, total network fee and gas-economics approval are **unavailable**. The UI expiry is an observed source claim, not an execution guarantee. Never substitute a synthetic fixture's gas usage or a native price display for those missing production costs. The eventual trigger pays its own network fee; independently funded vault assets pay only admitted signed consideration under existing caps and reserve accounting.

The operational choices remain explicit: a seller/owner can supply an already signed structured supported order for strict read-only verification; a permissionless submitter can provide the same material under an admitted source policy; or an owner can later approve a legitimate credentialed feed. None means this task may create an account, bypass API authentication, pay for a feed, activate a keeper or purchase an NFT. Missing source/order/policy leaves the watcher idle and fail-closed.

## Reproduce and verify

```sh
node --test scripts/seaport-acquisition/probe-current-native-sources.test.mjs
node scripts/seaport-acquisition/probe-current-native-sources.mjs /isolated/current-native-observation
```

The probe admits only fixed public GET targets and allowlisted JSON-RPC reads;112-call cap,10-second per-read timeout,2MiB public-body/256KiB RPC-body limits,100-log/10,000-block bound, no redirects, cookies, API credentials, signatures or submission method. The UI parser parses bounded JSON data without evaluating scripts, following embedded URLs or constructing payment calls.9 focused tests pass: honest UI classification, expiry, identity rejection, script/body bounds, source/immutable uncertainty, and four archive-integrity groups binding the original bytes, read scope, canonical/NO_GO report, source excerpts/notices and scanner configuration/results.

The archived raw envelope is4,143,722 uncompressed bytes/646,333 compressed bytes. Original response bodies and the original envelope were separately scanned **before release**, after capture, using unchanged Gitleaks8.30.1/configSHA `682c4983b955469645ca36b3145f10bd9baa6e3011ac4f8d82cc4de6b49be8cc`: **zero findings, exit0** in both scans. These results apply to this new archive, not the older raw scans or unresolved contract gates. Raw compressed bytes, source response hashes, report hash and script hash are recorded. No scanner/detector/ignore file changed.

Current quotes, source availability, approvals and policy can change after capture. The exact Task084 Slither input and all23 unresolved SeaportV2 High findings remain unchanged, along with separate core/dependency/Treasury/Reclaim gates. No new production route, collection, financial release or independent audit is established by this evidence.
