# RMT Launch independent-audit handoff

This candidate starts from [draft #588](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/588) at `1035940e74436f6a07a966dfb0224adebeadefe1`. The stack below it preserves the guarded direct-launch and production-data review evidence. Task 021 applies to the undeployed bonding-curve engine. Existing RMT assets and the historical direct-launch contracts retain their original code and terms. The 31337 web fixture and offline 4663 review build use simulated transactions.

## Creation fee and accounting

The draft fixture fee is **0.0004 ETH**, approximately **$1** at the illustrative reference of **$2,500 per ETH**. This reference is fixed documentation. The wallet reviews an exact ETH value plus network gas. The factory fixes the fee and operating recipient at construction. A future reviewed factory may select a different amount and recipient. Each launch starts with zero ETH backing and all fixed supply in curve inventory. The creator pays no liquidity contribution or initial purchase.

The factory rejects an insufficient payment and returns any excess to the paying creator. A failed refund rolls back the launch, mappings, fee credit and emitted evidence. The exact fee credits `creationFeesAccrued`, a separate accounting bucket. `claimCreationFees` accepts no recipient or amount parameter. Any caller can release the entire outstanding credit to the immutable operating recipient. The factory zeros the credit before payout and rolls back if the payout fails. Forced ETH creates no fee entitlement. No creation or payout path transfers project backing, curve fee credits, v4 fee credits, future reserve allocations or locked principal.

The creation receipt carries the existing `CurveCreated` event and a separate `CreationFeePaid` event bound to the same token, creator, fee, refund and recipient. Recovery validates transaction identity, value, factory scope and receipt evidence. A native refund needs its exact successful settlement trace. The indexer reads the immutable fee and recipient at the canonical creation block. Wallet intent is retained during provider delay without a replacement broadcast. The browser and index accept direct account-to-factory creation. The factory permits contract callers, so nested smart-account creations can exist onchain outside this review profile. A canonical nested creation can be skipped without blocking direct launch discovery.

## Migration authority

The initial curve remains V1. The factory pins the reviewed V2 deployer. The directory can publish an adjacent V3 or later template only after two distinct signers approve the exact deployer address, runtime hash and target version, followed by the two-day publication delay. The next template has a unique append-only pin and binds to its predecessor version. Supported versions are bounded through 32. Publication grants permission to prepare a candidate. It does not move any project's assets.

A separate project approval binds the creator's proposal, token, predecessor curve, successor address and exact runtime hash, source version, nonce, registry, chain and expiry. Two independent signers schedule that exact digest with a two-day notice. The creator can cancel and a failed execution leaves the original curve operational. A directory suspension blocks migration and new registration while normal trades and fee claims remain available. Already-graduated projects retain the original immutable NFT custody and do not migrate their LP assets.

The factory verifies adjacency and template identity and constructs the canonical candidate. The registry and original curve independently check project and candidate bindings. The predecessor closes, exact tracked ETH and inventory move, the successor accepts the same immutable commitments and reserve state, and the original ledger moves accrual authority. Factory and registry advance together. The token contract, fixed supply, holder balances and existing fee claims survive the change. Historical records identify the origin and each adjacent hop. Approval on an old curve is address-scoped and does not authorize a successor.

Reviewed runtime identity and governance are security assumptions. ABI getters can report expected values without proving behavior. Approve the actual successor bytecode, asset settlement, immutable bindings and absence of arbitrary withdrawal before template publication or project authorization. There is no proxy upgrade or unrestricted admin transfer. The append-only pin improves commitment stability and creates a liveness cost if an approved template is unsuitable. Independent review should assess future version admission, signer continuity and the consequences of losing the ability to migrate.

## Economics and v4 fees

The branch retains the fixed-supply virtual-reserve curve, 60% sold and 40% paired. The fixture keeps 1 ETH for regression. An alternate offline 4663 build uses 2 ETH backing and 4 ETH virtual ETH with the same allocations. This is the preferred independent-review case. A 4.20 ETH comparison remains available in the harness. The 1% curve fee and 90% project, 5% operating and 5% future RMT reserve shares remain provisional. [Integer economics and cost model](RMT_CURVE_TASK020_ECONOMICS.md)

The initial v4 position remains permanently locked. Collection uses a zero-liquidity change and a fixed ledger recipient. It checks the original NFT owner, full PoolKey, ticks, liquidity, allowances and exact earnings. Independent LPs receive their own share. Trades through a different pool earn no fees for the original position. The manual collection proposal uses a minimum **2× estimated-cost** threshold based on realizable fee value, including execution and parent-chain posting estimates. Treat the collector's costs and each beneficiary's own claim costs separately. No collection scheduler or principal-funded spend is included.

### Exact-source fork results

The three loopback profiles used Pocket for archive state and the official Robinhood RPC to corroborate block `113412054` and its hash `0x17252a232b68a4e9fc494caf0660cff722ac2da966ee5c62b40e20dbcfd32ea2`. The input hashes cover each profile's offline substitutions. All 16 tracked Solidity input hashes match the implementation at `014f93c45913887561331986315e7bd4a1eaf7d1`.

| Backing | Standard input SHA-256 | Graduation gas | Atomic graduation gas | 0.10 ETH opening buy shortfall |
| --- | --- | ---: | ---: | ---: |
| 1 ETH | `fe416b0860cd8171cd8e287fab54b45aa468e1e507744f6482ae7683eeb22312` | 1,523,110 | 1,739,948 | 9.34% |
| 2 ETH | `5bcd4ab1e266cad700c14ee67cb97668fe34f034e855f66cb8e21166ada06849` | 1,523,001 | 1,739,930 | 5.04% |
| 4.20 ETH | `f614827340309321365270a5fddd6b15c6a08bf83524923efd6344b89c4de084` | 1,523,075 | 1,739,912 | 2.62% |

The 2 ETH profile deposited 1.999999999999999952 ETH and 399,999.999999999999999652 tokens, with rounding dust recorded separately. Opening price was approximately 0.000005 ETH per token. The fork rejected interrupted funding and unauthorized NFT transfer. After retry, a 0.10 ETH official router buy received 18,993.189503262370814877 tokens. Selling half returned 0.050912822341918303 ETH. The original position's subsequent collection credited 0.000299999999999999 ETH and 28.489784254893556222 tokens, with principal and NFT custody verified. The 2 ETH V2→V3 receipt was `0x51b7259e28c33b7338d65cdc98d2417f926081845c428d46706b25da780d5ae7`. All hashes describe isolated simulated transactions.

The official RPC's read-only fee estimator at block `113589193` returned a 20,128,000 wei L2 base fee and nonzero poster estimates. Combining those observations with 2 ETH fork receipts gives a collection estimate of 0.000011290459424 ETH at 560,153 gas. Combined, native-only and token-only claims used 110,605, 42,932 and 68,957 gas. Their estimates were 0.000002237106432, 0.000000877379520 and 0.000001401210720 ETH. At that point sample, the proposed aggregate native-only collection trigger is about 0.00002258 ETH before beneficiary claims. Reprice against a current canonical block and use defensible token proceeds only. Poster quotes, token prices and trading volume can change.

## Reproduce and review

The stacked heads below identify the review inputs. They do not imply that their open pull requests are approved.

| Draft | Pinned head |
| --- | --- |
| #588 security readiness | `1035940e74436f6a07a966dfb0224adebeadefe1` |
| #587 asset migration and LP fee revenue | `5a164c56ef75396649a060d54756702513ad5464` |
| #586 curve engine | `453ba728f0620c60adfa2209f62aa03ad4274221` |
| #585 historical direct-launch data review | `2dc6d3fc7c88e72ea0752dc14a057931b8a947da` |

- Verify the source and pinned Uniswap, OpenZeppelin and compiler inputs from the emitted fork manifest. Solc 0.8.26 commit `8a97fa7a`, Cancun, via IR, optimizer runs 200 and IPFS metadata. The manifest records normalized input SHA-256, any offline chain and economic substitutions, and contract template SHA-256 values. The fork checks official PoolManager, PositionManager, Permit2, Quoter, StateView and Universal Router 2.1.2 runtime hashes at 4663 block `113412054`. [Pinned dependency installer](../packages/contracts/scripts/install-v4-deps.sh) · [Official Uniswap deployment identities](https://developers.uniswap.org/docs/protocols/v4/deployments#robinhood-chain-4663)
- Run the paid creation, directory, project registry, migration, curve, holder escrow and graduation suites with Foundry 1.7.1. Run the existing web typecheck, production build and launchpad tests. Use the [curve review workflow](../.github/workflows/launch-curve-review.yml) to replay the 1, 2 and 4.20 ETH cases and the exact-head browser fixture.
- Use the unchanged [Slither workflow](../.github/workflows/security-analysis.yml). The #588 baseline has 28 high-severity balance-check rows on curve graduation, funding, fee collection, migration and holder redemption. Carry forward its disposition matrix and exact test links. Review any current-head differences, the creation fee payout and refund boundaries, and the newly reachable adjacent migration calls. The separate legacy V1 and V2 funding IR gaps remain open. A failed security gate keeps release blocked. [Prior disposition matrix](RMT_CURVE_TASK020_AUDIT_HANDOFF.md#security-disposition)
- Independently reproduce immutable bindings, constructor inputs, creator and reviewer authorization, arbitrary-template rejection, failed destination rollback, fee conservation, fixed payout authority, NFT custody and fee-growth verification. Review exact pre/post balance assertions and the dependency call graph. Verify no governance role can redirect project assets, rewrite an existing ledger's entitlements or withdraw principal.

## Decisions before production

Approve the ETH creation fee and its operating treasury, graduation backing, trading terms and recipient addresses. Select independent signers and document key continuity, notice monitoring and incident ownership. Commission independent review of the exact source, compilation and deployment scope. Resolve the open Slither findings and legacy parser gaps. Approve verified archive and trace operations, Ethereum L1 finality, hosted indexing and routing for the exact full PoolKey, dependency disposition and physical wallet acceptance. This branch grants no production authorization.
