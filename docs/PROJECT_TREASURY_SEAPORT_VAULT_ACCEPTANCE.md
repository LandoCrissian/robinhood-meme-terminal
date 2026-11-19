# Project Treasury Seaport acquisition V2 acceptance

**Task 083 · BLOCKED_NO_BROADCAST · production purchasing NO-GO.**

This separate candidate starts from [Task 082 PR #676](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/676), exact source `50e278401ef6e0e66a5f38045295b97cf6b5d930`, under the [owner's Task 083 instruction](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/676#issuecomment-7015918714). It adds isolated execution and verification, not production authority. All existing Solidity, deployments, original beneficiary credits, economics, production data and services remain unchanged. Reclaim remains the frozen permanent-surrender trial; own-token buybacks remain separately NO-GO.

## Candidate and funding boundary

`RMTSeaportAcquisitionVaultV2` is a new immutable, chain-31337-only custody candidate. It does not retrofit Project Treasury V1 or the synthetic signed-venue acquisition V1. The creator deploys it for an exact core/project/original curve and chooses its controller. The controller deliberately funds segregated native ETH or the single constructor-bound ERC20; no claim against another ledger, royalty redirection, automatic fee entitlement transfer, forced purchase, swap, lending or RMT principal access exists.

The constructor creates an immutable `SeaportAcquisitionChecksV2` view helper. It holds no assets, approvals, mutable authority, fulfillment function or arbitrary executor. Typed static checks are separated to respect EIP-170 rather than waiving size limits. The vault pins that helper's runtime, Seaport, controller dependency, core/project and payment identities. A matching runtime alone does not establish honest semantics or proxy upgrade policy.

Pinned solc **0.8.26**, Cancun, viaIR, optimizer 200 produces the [exact four-source closure and compiler manifest](evidence/rmt-task083/security/compiler-manifest.json): three new production roots and the unchanged narrow account library. Input SHA-256 is **`3fbc55312a027e5f69b16fb927c8549efcc6674bab509c792efdc0104083c5f5`**. Vault runtime is **24,071 bytes** (505 bytes below EIP-170); creation template is 38,180 bytes and encoded constructor is **38,532 bytes** (10,620 bytes below EIP-3860). The checker runtime is 9,880 bytes. Constructor-bound identities must be materialized for each actual deployment; template hashes are not deployed addresses.

Direct deployment requires `msg.sender == creator`. An EOA creator may choose a genuine supported Safe as controller. A Safe that is itself the project creator cannot use an ordinary Safe CALL to CREATE the vault; a reviewed CreateCall/factory path is not supplied by this candidate. Nothing silently substitutes another creator or beneficiary.

## Exact supported order and custody

- Only typed Seaport 1.6 `fulfillAdvancedOrder`, exact pinned runtime, `FULL_OPEN`, one static ERC721 or ERC1155 sell offer, fraction 1/1, zero zone/zone hash, zero offerer and fulfiller conduit, empty criteria and extra data. Criteria, restricted/partial/dynamic orders, tips, arbitrary API calldata and generic routers are unsupported.
- The exact signed order hash, EIP-712 domain, current counter, cancellation/fill status, signature, collection runtime/standard/ID/quantity and controller/policy epochs are bound before spending. ERC721 quantity is one; ERC1155 quantity is bounded at 20. Completed status, counter, signature and dependencies are checked after fulfillment.
- Every original consideration item must be present, static, positive, in one permitted currency, with a unique exact recipient. Seller consideration is first. Admitted nonroyalty fee recipients have explicit controller-set per-recipient ceilings. Current ERC2981 is checked against the **all-in consideration** as an RMT admission policy; Seaport does not guarantee that royalty policy. The contract permits at most ten items; the preserved read-only adapter's narrower eight-item subset remains a route limitation.
- Native ETH is prefunded and forwarded in the exact all-in amount. ERC20 approval starts at zero, equals only the exact purchase total, and is revoked to zero afterwards. Standard exact-debit/credit assets only: unsupported return formats, transfer taxes, rebasing and unreviewed proxies are not implicitly admitted.
- Genuine Seaport ERC721 delivery uses `transferFrom`, without a safe callback. The new vault verifies actual token ownership and seller/vault balance changes and credits its own inventory after successful settlement. ERC1155 requires the exact expected collection, seller, operator, ID and quantity in its receive window, plus final balances. Old V1 is not relabeled compatible.
- Complete recipient deltas and exact vault debit are required. A failed call, unexpected refund, forwarding payee, incorrect NFT delivery, stale authority or changed royalty/signature reverts the whole operation. Endpoint-forwarding recipients are a disclosed liveness limitation. Unsolicited unsafe NFT/native gifts do not acquire credited withdrawal rights and may be stranded.

All mutable entry points use the guard. Purchase state and budget consumption occur before mutable settlement calls; exact postconditions are retained. The view helper cannot reenter mutable vault state under static context. These safeguards and finite tests are not proof that a deliberately malicious admitted token or NFT cannot lie about its own state; source/implementation admission remains independent.

## Creator authority and Safe scope

Purchasing starts **OFF**. Explicit enabling gives any caller standing authority only within the creator's collection/ID, currency, all-in price, lifetime, fixed **UTC calendar-day** budget, cooldown and deadline. The caller pays network gas; accounted vault funds pay consideration. Caps are not valuations or price guarantees. A mined disable increments the policy epoch; a purchase mined first can still settle. No keeper or background purchase is activated.

Only the current supported controller configures policies, admits collections/fee recipients, funds assets and schedules exits. Purchased NFTs and funded assets can leave only under exact recipient/quantity notices with **two days' delay and a bounded seven-day execution window**. Controller rotation requires notice and incoming acceptance, disables purchases and invalidates old epochs without resetting spend. No RMT administrator, sweep, arbitrary call, proxy upgrade or locked-LP withdrawal exists.

The unchanged account profile admits EOAs, its exact delegated-account binding and canonical SafeL2 **1.4.1**, three distinct EOA owners, threshold two, known singleton/handler, no modules or guard. Generic ERC1271/proxy accounts are unsupported. Genuine Safe tests use real synthetic owner signatures, including the SafeMessage-wrapped Seaport digest, one-owner rejection and replay checks.

The new website form supports direct synthetic EOA review and EOA keeper execution under the onchain policy. Safe policy administration is separately exercised through genuine contract execution; a full Safe proposal/signature-collection web workflow is not claimed here. Safe seller and controller settlement proofs admit only independently checked canonical proxy/singleton/handler and stable pre/post authority. Unknown delegations, access lists, batches and same-block authority changes remain unsupported/pending rather than guessed.

## Marketplace, source and payment verdict

[Fresh read-only marketplace/source qualification](evidence/rmt-task083/marketplace/README.md) corroborates block **118385295**, hash `0x29b23e1a937c0c78dfcbc7d9b00c4844118d2c96b85b3a7d7af58cc9062cfd00`, through the official and Pocket providers. Seaport's complete runtime and twelve immutable bindings reproduce. Original controller/conduit CBOR compiler inputs remain qualified rather than fully reproduced.

The wrapped-native proxy itself independently reproduces with solc 0.8.16. The implementation and ProxyAdmin executable bytes correspond, but original metadata inputs are incomplete. ProxyAdmin's published partial source record says solc 0.8.19 while actual CBOR identifies 0.8.16; both reproduced executable bytes, neither reconstructs the original metadata. ProxyAdmin itself has owner-only upgrade powers without an inherent timelock; the actual owner's complete quorum/continuity/upgrade policy is unestablished. **Wrapped-native production payment is not admitted.** Synthetic immutable ERC20 and native ETH tests are distinct from that asset.

The bounded current-order adapter uses one documented public endpoint, no credentials/cookies/redirects or alternate backend, a streamed response ceiling and timeout, freshness, exact identity and reconstructed cryptography/onchain state. Mocked transport tests do not establish real service-schema compatibility. Actual unauthenticated listing access returns **HTTP401**. Public-source research did not establish an independently verified executable current order. A collection URL is identification, and historical transactions remain historical. No access restriction was bypassed or current listing invented.

## Isolated execution and indexing boundary

The independent local fixture uses source-derived genuine Seaport with synthetic assets and the reviewed one-billion-token core fixture on its existing pinned Base Sepolia dependency fork. The Robinhood mode instead forks actual 4663 Seaport runtime/state and explicitly uses a synthetic project-binding stub; it does not silently transplant incompatible core-chain pins. Both execute only on loopback **chain31337**.

On the Robinhood fork, Seaport derives the local chain31337 domain. Test orders are newly signed by generated test keys for that domain; real 4663 listing signatures are not transplanted or broadcast. Actual core 4663 release/lifecycle regressions remain separate evidence. A fork result is not hosted routing, current listing admission or Ethereum L1 finality.

The [retained successful Robinhood fork run](evidence/rmt-task083/marketplace/fork-success-manifest.json), source `b928ce2219dbef8c2c252a481ed06629d6a8cc1e`, anchors actual 4663 block **118403040**, hash `0xbea5dc56b7e529c0d4667333882fad49603c3f365c1d7c3900c70ad95f76bdb1`. All **11 cases passed**, including native/ERC20 ERC721/ERC1155 custody, cancellation, failed delivery rollback, mined disable, orphan rollback, outage, genuine two-owner Safe seller and same-block attribution. Of 63 retained local receipts, **62 remain canonical locally** (54 success, eight revert) and one is deliberately orphaned. Six canonical purchases are proven. The unrelated same-block fee and reverted third transaction are excluded from the valid purchase's exact recipient accounting. Synthetic `gasUsed` is retained; it is not a live fee quote.

The new same-app local page is `/my-launches/treasury/seaport-purchases`. Exact review shows asset, complete consideration, gas payer/cost, policy, nonce, chain and custody. Editing or switching wallet context invalidates unsubmitted review. Submitted identities remain in bounded, deployment/account-qualified recovery journals. Recovery never signs or broadcasts again.

A separate local indexer/read model requires PostgreSQL **18.6**, an isolated database prefix, exact manifest and one authoritative writer lease. It stores canonical block/receipt/event/order/project/vault identities and exact transaction traces. Missing trace remains pending; restart is idempotent; reorg rollback removes only private V2 observations and rebuilds bounded history. Same-block attribution uses each transaction's call tree and transfer logs, not net block balances. This is a single-vault fixture worker, not a production database migration or proven exactly-once blockchain executor.

Public builds return **404/no-store** from the new API and hide the local page at the server boundary. The proof RPC is loopback-only and read-method allowlisted; local Anvil administration remains inside the harness. No production financial endpoint, credential or RPC is exposed.

## Security and verification

[All new High observations, exact compiler/AST/source boundaries, regressions and limitations](evidence/rmt-task083/security/REVIEW.md). Actual Linux Foundry passed **48 tests**, including genuine Safe, 512-case fuzz tests and a 128-run/4096-call stateful invariant. Windows and Linux full-closure Slither agree: **101 detectors / 48 observations / 23 High**, strict exit **1**. Twenty-two balance-baseline observations and one pinned native-fulfillment observation remain unresolved. Four postcompile Forge source-display diagnostics are retained; Solc compilation succeeded, all 48 tests executed and all four production-closure sources were independently analyzed. No warning is suppressed or waived.

The old 22 acquisition, 22 core/dependency, six Treasury V1, seven active Reclaim V2 and four rejected historical Reclaim V1 Highs remain in their separate reports/gates. Historical Foundry opt-in distinctions remain separate. Source verification, passing tests and internal analysis are not an independent audit or production clearance.

The initial fork completed ERC721 settlement before an unchanged local clock hit the cooldown on the next fill. The fixture now advances only its private clock for eligible fills. A later fork completed all four native/ERC20 modes; its genuine Safe approval succeeded but a wrong event ABI hid `ExecutionSuccess`. The indexed event decoder was corrected without dropping the success/digest/payment assertions. [Original failures and transaction evidence](evidence/rmt-task083/marketplace/README.md).

**Connected browser, final fork, database, final-head CI and screenshots are pending at this document's initial preparation.** They will be recorded from actual completed runs, not inferred from the Foundry or older V1 journey. The production website and every financial release hold remain unchanged.

## Remaining acceptance stages

### Reproduce isolated review

The pinned workflow [seaport-acquisition.yml](../.github/workflows/seaport-acquisition.yml) installs the existing lockfile, pins solc 0.8.26, Foundry 1.7.1 and PostgreSQL 18.6, and verifies the recorded compiler/PostgreSQL checksums. Its exact dependency preparation and compiler arguments are review inputs, not a request to change the owner's machine. On a prepared Linux review runner:

```sh
node --test scripts/seaport-acquisition/*.test.mjs packages/launchpad-common/seaport-vault-*.test.mjs
node --test docs/evidence/rmt-task083/security/integrity.test.mjs
forge test --root packages/contracts/seaport-acquisition --use <verified-solc-path> -vvv
node scripts/seaport-acquisition/fixture-run.mjs --anvil <anvil-path> --solc <verified-solc-path> --fork-robinhood --output <fresh-fork-output>
pnpm --filter @rmt/launch-website build
pnpm --filter indexer build
node scripts/seaport-acquisition/browser-run.mjs --anvil <anvil-path> --solc <verified-solc-path> --pg-bin <postgres-18.6-bin> --browser chromium --output <fresh-chromium-output>
node scripts/seaport-acquisition/browser-run.mjs --anvil <anvil-path> --solc <verified-solc-path> --pg-bin <postgres-18.6-bin> --browser webkit --output <fresh-webkit-output>
```

Every execution CLI owns its loopback Anvil and generated test keys; it accepts no public transaction endpoint or production key. Each browser command owns a separate PostgreSQL instance, database, indexer and existing Next app. Use a fresh output path for each run. This is automated Chromium/WebKit acceptance, not a physical iPhone test or a hosted purchasing preview.

1. Complete isolated V2 receipt, custody, database, restart/reorg and browser acceptance with exact source/evidence hashes.
2. Admit real current-order transport/schema, relevant original source/payment implementation/upgrade policy and supported wallet profiles; resolve or explicitly disposition plausible material loss paths without changing detector gates.
3. Separately review any production-chain build, constructor inputs, deployment/custody costs, operators, trace/archive providers, durable indexing and independent L1 finality.
4. Obtain separate owner authorization for deployment, funding and public purchasing. No such approval is requested or inferred by Task 083.

The next narrow engineering recommendation is to close whichever exact connected-admission gap remains after the completed runs; it is not permission to activate buying, own-token buybacks or Reclaim.
