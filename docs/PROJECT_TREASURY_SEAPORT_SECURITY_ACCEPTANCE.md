# Project Treasury: Seaport verification and acquisition security

**Task 082 · BLOCKED_NO_BROADCAST · production NFT purchasing NO-GO.**

This work is stacked on Task 081 PR #675 at `4892d2af5ac09ae00975c2b799b66bec0d172779`, under the [exact owner instruction](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/675#issuecomment-7012761362). It changes the new acquisition module and isolated verification only. It does not authorize deployment, owner signing, funding, royalty changes, governance, production data/configuration or token issuance. Reclaim remains the frozen permanent-surrender trial.

## Security disposition

The [23-row register](evidence/rmt-task082/security/findings.json) retains every original finding ID, source/AST boundary, asset, precondition, callback path, applicable regression, mitigation and uncertainty. [Human matrix](evidence/rmt-task082/security/FINDINGS.md) · [Exact review and compiler evidence](evidence/rmt-task082/security/REVIEW.md).

The private synthetic-venue payment helper now derives its ERC-20 payer directly from `msg.sender`, removing its redundant `from` parameter. The original caller already enforced `msg.sender == order.vault`; this is capability narrowing, not a demonstrated baseline loss exploit. ABI, signed orders, amounts, recipients and exact balance checks remain unchanged. The venue runtime decreases from 4,688 to 4,639 bytes. Vault and Factory bytecode templates remain identical; constructor-bound runtime identities are still separately verified.

The fresh Windows and Linux Slither 0.11.5 / Crytic Compile 0.3.11 runs use **all 101 detectors** and report **47 observations / 22 High / 1 Medium / 15 Low / 9 Informational**, strict exit **1**, with identical high IDs. One arbitrary-send-ERC20 observation disappeared. Twenty original high IDs remain identical and two venue balance IDs are explicitly mapped after their source/signature relocation. They are not counted as eliminated. The 21 exact-balance warnings and one fixed-venue native-payment warning remain uncleared.

The revised production compiler input SHA-256 is `147be8aec26e3d2577b8b2812f2d779d3fc6b39024fd05b7c40397ffddefe6e1`, using pinned solc 0.8.26, Cancun, optimizer 200 and viaIR. There is no detector suppression, severity downgrade, relaxed balance assertion, unrestricted approval, arbitrary executor, proxy, principal exit or new administrator authority. The old 22 core/dependency, six Treasury V1, seven active Reclaim V2 and four rejected historical Reclaim V1 highs remain separate release evidence.

The new Foundry scope contains 41 tests: the original 30 plus 11 cases for native/token/NFT callbacks, forwarding recipients, mature-notice reentry, false venue completion, interrupted fills, over-pull rollback and mined disable. The native/NFT endpoint checks deliberately reject immediate forwarding recipients; that is a liveness limitation. Runtime hashing proves identity, not honest semantics of a maliciously admitted implementation. Source, code, order and settlement evidence remain necessary. Passing tests do not constitute an independent audit or clear residual warnings.

## Standing authority and immutable funding

Purchasing is OFF by default. When a creator enables a policy, **any caller** can trigger a permitted seller order within the on-chain collection/ID/currency/price/lifetime/day/cooldown limits. The existing dashboard prepares actions only for its controller profile; that UI restriction is not the contract's authority model. The final wallet review now restates exact proposed caps and this standing authority. The trigger pays network gas; the vault pays consideration. A cap is not an NFT valuation. A disable takes effect when mined; a permitted purchase mined before it can settle. No background keeper is activated.

Treasury V1 and committed beneficiary credits cannot be reassigned by this work. Acquisition funds are deliberately supplied from settled assets to the segregated vault. Creator earnings, own-token buybacks and Reclaim funding remain separate. Fixed 1B supply, 600M/400M allocation, 1% curve fee, 90/5/5 entitlements and original locked 0.30% v4 position are unchanged. Safe 1.4.1 2-of-3 and pinned EIP-7702 profiles retain their existing restrictions. No LAMMB purchase or royalty authority follows.

## Actual Robinhood Chain source and route evidence

OpenSea advertises Robinhood Chain support, and actual Seaport 1.6/conduit state is observable. Explorer 403 was not treated as proof that source verification was impossible: the public Sourcify v2 endpoint returned original compiler inputs and output.

Independent recompilation used exact solc 0.8.24 for Seaport and 0.8.14 for ConduitController, with checksum-pinned portable binaries. Seaport's complete runtime and all 12 constructor-bound immutable values matched both providers at block **118311199**, hash `0x34328dc4ce9c3d49debc95a21b2827a217165be696e466e2f0a70af61e07d8c3`, observed **2026-11-19 15:10:16 UTC**. Seaport runtime is 23,981 bytes, hash `0x95809b70c9659c30188db5fdd87103e24b1a55379af8c851fca393aba0224a00`.

The controller/conduit executable bytes also reproduce. Two original 53-byte CBOR metadata records require explicitly recorded replacement with observed metadata; their original metadata inputs were not independently recovered. This is qualified correspondence, not a claim that every original metadata byte was freshly generated from complete original sources. [Exact source manifests, transformations, licenses, provider evidence and limits](evidence/rmt-task082/seaport-marketplace/README.md).

The chain's observed wrapped-native address is an upgradeable proxy. Pinning its proxy runtime alone does not verify implementation behavior or upgrade authority. Current implementation/admin observations are retained, but this verifier rejects proxy payment assets pending a separately reviewed implementation/authority policy. No production token pin was changed.

The available historical transaction is a restricted, partial **WETH bid** with criteria, a signed zone and extra data. It is outside the admitted static FULL_OPEN NFT-sell subset. The actual archive counter, EIP-712 signature, order hash, canonical receipt, NFT transfer, three WETH transfer logs and four conduit transfer calls are independently reconstructed. These are historical execution observations, without archival before/after asset balances, qualified proxy policy or L1 finality; they are not complete independent payment settlement or a current listing. Current OpenSea listing access remains unavailable without suitable access, and no current executable order is invented. [Exact replay and limitations](evidence/rmt-task082/seaport-marketplace/README.md#actual-historical-protocol-replay).

## Read-only exact-order verifier

[Portable implementation](../packages/launchpad-common/seaport-order-verifier.mjs) · [API and limitations](evidence/rmt-task082/seaport-adapter/README.md).

The verifier accepts bounded structured fields, not arbitrary API calldata or URL execution targets. It reconstructs Seaport EIP-712 domain/components/hash and requires current counter/status, canonical fresh numbered-block evidence, source/runtime pins, collection standard, actual seller ownership/approval, known operator/conduit/channel, exact all-in consideration and reviewed recipients, native or admitted immutable ERC-20 payment, reserve and exact approval observations. It supports canonical EOA signatures, EIP-2098, or a separately pinned immutable ERC-1271 seller. Unknown/delegated seller profiles, criteria, partial/restricted orders, extra consideration/tips, dynamic prices, unknown zones/conduits and unverified proxies fail closed.

For the known acquisition V1, budget evidence also reads actual collection admission, token ID eligibility, controller/project/epochs, accounted/reserved assets, spend and cooldown. These reads do not make it Seaport-compatible. The verifier may internally construct a bounded `fulfillAdvancedOrder` **eth_call**, with no criteria/extraData/tips, numerator/denominator 1/1, zero fulfiller conduit and exact receiver/value. That simulation cannot prove authorization by the vault or credit its custody ledger.

On 4663, two distinct supplied read providers must corroborate the same numbered state and canonical block. Caller/API declarations and a response hash do not establish a verified current listing. Unsupported current-listing provenance stays unavailable, with order cryptography separated from listing, custody, route, settlement and finality. Every purchasing/execution capability remains false. Future HTTP integrations must cap bytes before parsing and supply bounded, cancellable transports; distinct client objects alone do not prove independent operators. No public verification endpoint is activated.

## Why no asset-bearing Seaport candidate is admitted

The existing vault's typed `purchase` calls its pinned synthetic venue and credits its own inventory. It cannot execute arbitrary Seaport calldata. Actual Seaport ERC-721 fulfillment uses `transferFrom`; an unsolicited transfer could arrive without its safe-receiver hook or inventory credit and become stranded. ERC-1155 uses a safe callback, which the old vault rejects outside its own expected purchase window. A receiver interface or a successful direct Seaport simulation is therefore insufficient.

The genuine Seaport tests use a minimal **test-only chain-31337 receiver**, not a project budget vault or production custody candidate. Real source execution, correct NFT transfer and payment are tested independently of project authorization. A new asset-bearing implementation would require a separately reviewed accounting/custody design and its own release evidence. It is not smuggled into the existing vault by a metadata flag.

## Verification status

The complete implemented-source CI run at **`597f708cf6b3c7f729e8c786418ea05e89153b05`** finished with **22 jobs: 16 passed, six failed, zero pending**. [Exact job records](evidence/rmt-task082/acceptance/ci-results.json) · [Retained raw artifacts, receipts, database rows, screenshots and reproduction](evidence/rmt-task082/acceptance/README.md). Subsequent commit `85ad49a4` adds only an offline historical transfer-reconciliation test and its limitations; all ten source/replay tests pass locally. Later handoff/evidence files do not change execution bytecode.

| Scope | Actual result |
| --- | --- |
| Acquisition Foundry | 41 passed / zero failed or skipped; fuzz and stateful invariant included |
| Official Seaport Foundry | 17 passed / zero failed or skipped |
| Genuine local Seaport RPC | Eight cases, 32 synthetic receipts, actual native/ERC20/ERC721/ERC1155/ERC1271 settlement and reorg/outage behavior |
| Acquisition/order/source/indexer units | 39 groups plus five indexer evidence groups passed on Linux; later historical assertion passed locally |
| Core Foundry | 112 passed / zero failed or skipped in the current profile; historical opt-in distinctions remain retained |
| Treasury V1 / historical Reclaim V1 / active Reclaim V2 | 23 / 37 / 55 tests passed respectively |
| Browser and PostgreSQL | Chromium and WebKit acquisition, previous lifecycle, claim/Safe, Treasury and frozen Reclaim journeys passed with isolated PostgreSQL 18.6 |
| Public website / deployment packaging | Linux Next.js build, public 404/zero-wallet negatives, read-only review and deployment packages passed; nothing published |
| Dependencies / repository / indexer | Frozen-lockfile audit reported no known production vulnerabilities; Linux repository and indexer checks passed |
| Firebase | Existing isolated emulator suite passed; no production records changed |

The six failed jobs are **retained security gates**: acquisition (22 highs), exact core 4663 closure (22 highs), Treasury V1 (six), historical Reclaim V1 (four), active Reclaim V2 (seven), and repository-scoped Slither (85 contracts, all 101 detectors, 95 observations, exit 255). The repository CLI does not emit a severity aggregate JSON; its unchanged historical path filters are distinct from exact compiler-closure reports. Do not infer a severity count or complete coverage from that CLI summary. The exact 4663 unsigned reconstruction and offline Blockscout export succeeded despite the separately failed analysis step. No finding is waived by those successes.

Actual Windows `pnpm check:repo` failed in the OXC parser before completing: **`RangeError: Array buffer allocation failed`**. The same implementation's Linux repository job passed; no check, dependency or assertion was changed to hide the local memory limitation. The five new archived-evidence integrity tests pass locally. [Environment boundary](evidence/rmt-task082/acceptance/windows-check-limitation.json).

The [history review](evidence/rmt-task082/history/README.md) keeps raw Gitleaks exit 1 and its original reports. An exact immutable-source adjudicator recognizes only five proven public identities: one conduit identifier, two captured synthetic contract addresses and two SHA-256 values of archived public source responses. Unknown/changed/missing observations fail. Scanner rules and the existing historical ignore file are unchanged; a runtime-generated unrelated key-shaped canary is actually detected and rejected. A successful adjudication is not a clean raw scan or financial/security clearance.

## Separate acceptance decisions

1. **Isolated engineering review:** exact source/compiler/report identities, real local/fork/replay receipts, database/browser checks, disclosed limitations and residual warnings. No owner signing or spending is needed for this task.
2. **Production source/order admission:** complete relevant source/metadata/implementation authority, trusted current listing transport, supported exact order/zone/conduit/payment subset, and live ownership/status evidence. Historical fills and proxy addresses are insufficient.
3. **New custody build:** separately reviewed source-bound Seaport accounting, principal/funding boundaries, native/token payment and NFT delivery proof, budgets, controller/Safe authority and recovery. The current vault remains unsupported.
4. **Deployment, funding and public activation:** separate owner approvals, current wallets/provider/indexing/finality acceptance and disposition of plausible material loss paths. No paid reviewer or new service is commissioned.

Production remains unchanged. No live signature, transaction, purchase, fee activation, token creation, hosting upgrade, database migration or governance execution occurred.

The next narrow task should establish trusted current-listing transport, resolve relevant controller/source and payment-implementation admission, then specify a separately reviewed Seaport custody/accounting build. Do not activate the synthetic V1 or treat the read-only verifier as that build. No owner key, paid plan or financial approval is needed to review this draft; any later deployment, funding or public activation requires its own authorization.
