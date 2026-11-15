# RMT Launch project treasury and 4663 review

[Task 042 #612](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/612) resolves the treasury design gate for [Task 041 #611](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/611). The website and indexer changes build from #610 `fca8d04d2a9842cfc38e757d54109580ad40a418`. The separate review candidate keeps frozen contract source #592 `5fe80e04713cd0d72dedc087ede3a54ba2d6920d`, Solidity tree `e98de2eaedcf9d233bac0860094e7179db2ab562`. **Release status is blocked.** Contract deployments, already-committed fee terms and the live site's execution controls retain their existing configuration.

## Payout policy committed at creation

| Option | Creator | Independent project treasury | RMT allocations |
| --- | --- | --- | --- |
| No treasury or 0% project share | All project fees | No treasury address encoded | 5% operations, 5% future reserve |
| 25% of project share | 67.5% of all eligible fees before rounding | 22.5%, encoded as `2250` | 5% each |
| 50% of project share | 45% before rounding | 45%, encoded as `4500` | 5% each |
| 100% of project share | Zero, creator remains project identity | All project fees, encoded as `9000` | 5% each |

Each ledger applies the cumulative integer policy separately to each eligible currency. For a cumulative amount `A`, platform `P = floor(A / 10)`, project `Q = A − P`, treasury `T = floor(Q * treasuryShareBps / 9000)` and creator `Q − T`. Operations gets `floor(P / 2)` and future reserve gets the remainder. Repeated small accruals preserve totals, and a one-unit rounding remainder can favor a bucket. Curve dues are ETH. The post-graduation split applies to actual ETH and launch-token fees collected from the original permanently locked v4 position. Fees paid to independent LPs or another pool are outside this ledger. The creation fee is accounted for separately at the factory and belongs to the immutable operations address.

The creator form expresses the denominator as **project fees** and displays the effective encoded total-fee split before review. Conversion floors to an integer basis point of all fees. Small positive percentages that encode as zero are rejected when a treasury is selected. Old saved drafts preserve their encoded fee split. Old read-only review requests still use the old denominator unless they declare the project-percentage version. Signed transaction and recovery payloads retain their existing format. A prior transaction keeps its committed address and integer amount.

The local signing gate requires a separately specified nonzero treasury address for positive share. It checks the fixture chain and deployment first, then screens system, platform, unrecognized contract and unsupported Safe addresses. A code-empty address still requires the creator to verify control and claim capability. A test-only Safe classifier checks the exact canonical SafeL2 1.4.1 singleton/proxy, initialized owners and threshold, code identity, default or empty fallback handler, and absence of unreviewed guard/module controls. That classifier defines the exercised onboarding profile. Live application support for delegated EOA, smart-account bundlers, Safe modules and other account versions is unverified. Beneficiaries should confirm their access before launch. A mistyped or inaccessible immutable recipient can strand rewards.

## Claims and project spending

The curve fee ledger's `claim()` sends ETH to the initiating beneficiary. The original v4 position ledger's `claim()` pays both earned assets to the initiating beneficiary. `claimAsset(true)` claims ETH and `claimAsset(false)` claims the launch token. A failing native transfer rolls back that transaction, and an eligible recipient can still use the token-only LP method. Creator, treasury, RMT operations and reserve withdraw only their own credits. The registry's same-token migration moves the curve writer and backing while preserving the original fee ledger, the original recipients and existing claims. Graduation creates the bound LP fee ledger with the same immutable policy. Collection and claims cannot withdraw the position's liquidity or transfer its NFT.

The project controls spending after a claim. ETH or token transfer from a treasury to a project-authorized spending wallet is a distinct transaction. Track both addresses and use canonical transaction and token transfer evidence. For a later NFT purchase, attribute the holding to the verified receiving address. Development and community spending, token purchases, OpenSea royalties and RMT platform revenue are separate accounting flows. Existing RMT token economics and existing LAMMB royalties remain independent. No RMT custody or automatic purchases are introduced.

A simple EOA can claim directly with ordinary EVM wallet transactions. Use separately approved owners and threshold within an existing compatible smart account when multiple approvals are desired. The local app's own wallet submit and recovery paths require a direct EOA envelope. A supported external treasury may submit a single call through its own account. Fixture PostgreSQL admits a single post-graduation treasury claim only when the canonical receipt, bound trace and exact native/token proof agree with its prior credit, resulting state and position custody. The indexed payee is the treasury, even when a wallet owner submitted the outer transaction. Batches, indirect relay roots and missing evidence remain outside that proof path. Recovery reuses the original transaction identity and never broadcasts a replacement.

OpenSea lists Robinhood Chain and excludes multisig from its standard checkout. A compatible separate spending wallet is the supported architecture to consider for treasury-controlled spending. The wallet evidence includes read-only canonical 4663 Safe and Seaport identities and an unrelated historical Seaport settlement with ownership evidence. Direct Safe checkout remains unverified. [Wallet and marketplace evidence](RMT_CURVE_TASK042_WALLETS.md)

## Chain-bound contract profile and deployment implications

The named offline profile `rmt-curve-v1-4663-treasury-review-v1` is separate from the shipping 31337 fixture. The frozen factory has two 31337 gates and the frozen graduation engine is chain-bound. The checksum-pinned compiler helper transforms only those three occurrences for 4663 and selects the already documented 2 ETH review constants and commitment. The registry is mandatory in the resulting chain profile. It reuses the same 4663 compiler input that earlier work independently reproduced. The original 31337 input and its bytecode remain historical regression evidence.

[Machine-readable 4663 candidate](evidence/rmt-task042/4663-treasury-review-manifest.json) contains the new named profile, exact transformations, underlying source and harness pins, input SHA-256 and all six external runtime identities. `BLOCKED_NO_BROADCAST` is explicit. The verifier rejects production assignments in this fixture manifest and checks dependency contents, 14 binary templates, exact ABI fixture constructor encoding, CREATE/CREATE2 hook derivation and size limits. The historical fixture uses 48,894 bootstrap bytes, leaving 258 under EIP-3860. The 23,980-byte factory runtime leaves 596 under EIP-170. The earlier fixture bootstrap consumed 9,951,309 L2 gas. This is a local measured amount. Future constructor values can change calldata gas, derived addresses and immutable runtime hashes.

Use [offline verifier](evidence/rmt-task042/verify-4663-treasury-review.mjs) with the pristine #594 checkout, installed pinned dependencies and native checksum-verified Solidity 0.8.26. It performs no network reads, signing or broadcasting.

```sh
node docs/evidence/rmt-task042/verify-4663-treasury-review.mjs "$PINNED_594" "$PINNED_SOLC"
```

For #611, freeze production inputs only after explicitly approving the operating and reserve addresses, three independent directory EOA signers, deployer identity and nonce, and final provisional terms. Recompute the directory, registry, V2 successor deployer and bootstrap sequence. Predict and verify reciprocal bindings and the CREATE2 hook whose permission bits are `0x2000`. Then derive and review V3 template and publish the exact approved factory pin using directory quorum and notice. The handoff stores the earlier unsigned fixture encode/hash evidence. Production constructor bytes and signatures are unassigned. Canonical runtime and receipt checks must precede either public discovery or execution. Wallet, site rollback, indexer deployment and database approvals remain separate.

## How to verify the treasury matrix

Stage the [treasury test](evidence/rmt-task042/foundry/RMTLaunchTreasuryReview.t.sol) in the `test/` directory of an isolated, exact frozen #592 or #594 Foundry worktree. Use Forge 1.7.1 and the pinned compiler. That proof uses real frozen ledgers and a synthetic project recipient under local test conditions. It covers 0/25/50/100% project share, fractional native and token accounting, creator-only and separate EOA, a project-controlled account, rejected native payout, token-only recovery, empty repeat claim and authorized ETH/token transfer to a distinct spending wallet.

```sh
forge test --offline --use "$PINNED_SOLC" --match-contract '^RMTLaunchTreasuryReviewTest$' -vv
pnpm --filter @rmt/launch-website test:history
pnpm --filter indexer test:resilience
```

Use the [existing same-app browser workflow](RMT_CURVE_TASK038_V4_SETTLEMENT.md#reproduce) for the 31337 create/settlement journey and isolated PostgreSQL. The public build remains read-only. In that workflow, public v2 review of 100% project share encodes 9,000 bps without producing transaction calldata. The synthetic browser commits the 25% project share and verifies its encoding and immutable beneficiary from receipt and index.

## Measured release evidence

| Scope | Observed result |
| --- | --- |
| Isolated ledger tests | **4 passed, 0 failed, 0 skipped**. The synthetic project account demonstrated independent execution, both ledgers, native rejection, asset-only recovery and authorized funding of a separate spending address. This account fixture is outside the release build. [Foundry log](evidence/rmt-task042/foundry/treasury-ledger-results.txt) |
| Same website on Anvil 31337 + PostgreSQL | Browser created a launch with an independent EOA treasury at **25% of project fees**, encoded as **2,250 bps**, verified against the original request, receipt, registry, fee ledger and database. Tested account/chain change, wallet rejection, missing hash, missing native trace, process restart, claims and reorg. The synthetic wallet signed 15 total lifecycle transactions, including one creation. [Receipt and index extract](evidence/rmt-task042/31337-creator-and-treasury.json) |
| Frozen 4663 profile on Anvil | Original anchor replays hit Pinax 429, dRPC pruned state and an empty Pocket response. The fresh corroborated **114549452** anchor, hash `0xf9a8ca5d8e26ebb426ebd2e663ad82afc878c16d8bba5f5542f6341890cf7710`, passed on Pinax. This loopback run uses creator-only payout and real v4 protocol code. It covers V1→V2→V3 with unchanged assets and credits, initialization protection, graduation, native and token swaps, fee collection and claims, outside liquidity, and permanent principal. [Fresh receipts](evidence/rmt-task042/fork/4663-lifecycle.json) |
| 4663 gas observations | Fresh fork bootstrap **9,951,309 gas**; creation **3,334,259**; standalone graduation **1,545,085**; Router 2.1.2 buy **115,380**, sell **127,443**; LP harvest **560,271**. These are receipt gas units on local Anvil. Additional provider fees and future actual calldata affect costs. [Fresh receipts](evidence/rmt-task042/fork/4663-lifecycle.json) |
| Read-only current network | Official and Pinax corroborated **114558828** and matched all six published v4 dependencies. Official max transaction gas read was **32M**. Pocket matched the code hashes and lacked a completed corroboration of the block. Historical trace and archive access vary. A read-only Safe 1.4.1 acceptance classification and historical Seaport settlement are separate evidence. [Uniswap network read](evidence/rmt-task042/4663-public-probe.json) · [Wallet evidence](RMT_CURVE_TASK042_WALLETS.md) |
| Web and indexer | **45 website unit tests** passed, including old draft fee conversion and account screening. Website typecheck and production-style build, indexer typecheck/build/RPC resilience and repository check passed. Chromium and WebKit public-boundary tests passed on desktop and emulated iPhone portrait and landscape, with **99 denied requests per engine** and no wallet calls. [Chromium](evidence/rmt-task042/chromium-read-only-checks.json) · [WebKit](evidence/rmt-task042/webkit-read-only-checks.json) |
| Static analysis | Slither 0.11.5 on the exact 4663 closure re-reported **18 active highs plus four dependency highs**, 215 total, no emitted parser gaps and exit **255**. The 24-high full-tree baseline includes six separately scoped escrow findings. None of those findings were closed by this work. [Static analysis provenance](RMT_CURVE_TASK040_STATIC.md) |
| Full frozen-source Windows Foundry tree | **603 passed, 1 failed, 4 skipped.** Historical `RMTUniswapV3FeeExecutorV2ProposedPackageTest.testProposedOwnerAuthorizationPackageIsExact` mismatched legacy creation-bytecode hash `0x931e…7ce2` vs `0x4aad…9a02`; it also failed in a fresh LF-only checkout. This historical test is outside the curve source closure and remains intact. The other four were explicit legacy opt-ins for Terminal V4, guarded V2, direct launch and Growth Vault. [Historical Linux candidate evidence](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/43511947877/job/132184136532) |

For the fresh fork, use a disposable #594 worktree with the pinned dependencies and compiler. Apply the [anchor-only replay patch](evidence/rmt-task042/fork/reanchor.patch) within that scratch checkout. The patch changes the block, hash, state root and public RPC pacing in the old rehearsal harness. It preserves the network allowlist and zero-write upstream check. Run from the scratch checkout:

```sh
git apply "$REVIEW/docs/evidence/rmt-task042/fork/reanchor.patch"
node packages/contracts/scripts/validate-curve-graduation-4663.mjs \
  --anvil "$PINNED_ANVIL" --solc "$PINNED_SOLC" --archive pinax --backing-wei 2000000000000000000
```

The receipt projection uses `projectAsset` for public asset identifiers and path/hash pairs for source hashes. It records the raw report digest. The RPC harness corroborates the anchor with the official endpoint, checks six dependency runtimes and requires the read-only upstream proxy to reject a write probe. Anvil receipts belong to local simulation only. Provider-reported finalized tags do not independently establish L1 finality.

Exact Safe transfer and claim execution through the RMT app is unverified. The fixture receipt code recognizes a single Safe `execTransaction` CALL with zero refund fields to the committed LP ledger. Evidence must include the matching direct nested call with exact calldata, payout and state. Different outer relay paths, batched calls and multiple credit changes in the same block remain unavailable. The public profile has no transaction execution routes enabled. No physical-wallet run or live marketplace checkout occurred.

## Outstanding release decisions

1. Approve exact operating treasury, distinct future reserve address, deployer, independent signer quorum, backup/incident operators and the draft creation fee, threshold, supply, trading and position fee terms. Each project separately selects and verifies a payout address.
2. Close the known 18 active high observations and migration-ordering questions for the exact approved build. The separate closure also retains four dependency highs. Full-tree escrow and historical parser findings remain recorded. No gate or severity was weakened.
3. Establish dependable production archive/trace and Ethereum L1 finality evidence, durable indexing and restore, exact-pool hosted routing, and physical wallet acceptance for the supported profiles.
4. Independently approve the deployment artifact with real approved constructor inputs, then separately approve funded owner acceptance and public activation. The current profile remains **blocked from broadcast**.
