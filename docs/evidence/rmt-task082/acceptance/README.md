# Task 082 actual Linux acceptance evidence

Validated implementation: `597f708cf6b3c7f729e8c786418ea05e89153b05`, stacked on Task 081 `4892d2af5ac09ae00975c2b799b66bec0d172779`. Later handoff-only files are distinct from this executed source. [Source preservation](source-preservation.json) binds the critical implementation/test bytes and proves 70/71 original tracked Solidity files unchanged. The single revised original source is the synthetic venue's private payer helper. No production configuration or dependency pin changed.

The [artifact manifest](artifact-manifest.json) binds unmodified downloaded CI JSON, eight screenshots and every separately classified raw scanner observation. The [integrity tests](review.test.mjs) verify those bytes, exact Windows/Linux high-ID parity, actual synthetic receipts, both browser/database journeys and individual public-identity bindings. Gzip files are retained raw JSON archives, not successful-response replacements. None contains a wallet private key or production credential.

| Executed scope | Actual evidence |
| --- | --- |
| Acquisition Foundry | 41 passed / 0 failed / 0 skipped; actual fuzz and invariant cases |
| Official Seaport Foundry | 17 passed / 0 failed / 0 skipped |
| Official Seaport RPC verifier | 8 cases, 32 synthetic receipts; ERC721, ERC1155, native, finite ERC20 approvals, ERC1271, cancellation, royalty substitution, outage and reorg recovery |
| Node acquisition/order/source/replay | 39 groups passed; five indexer evidence groups passed |
| Acquisition strict analysis | All 101 detectors, 47 observations, **22 High**, exit **1** |
| Chromium + WebKit | Both acquisition journeys passed against actual PostgreSQL **18.6**; six exact policy reviews per browser, Safe outer review, missing hash/trace, restart and reorg |

The browser acceptance JSON retains actual receipts/traces and database event/state rows. Restart preserves 22 observed events in each journey. A later synthetic reorg rolls back custody, payment recipients and database state, leaves recovery unavailable, and performs no automatic retry. Missing native trace remains pending until independently restored. The snapshot/API's execution flag remains false throughout.

The dedicated official Seaport receiver is a minimal chain-31337 test fixture, **not** a production project vault. First development execution revealed zero ETH being forwarded from prefunded custody; it failed rather than fabricating a fill. Commit `45e19adc` corrected exact native forwarding, and `3953f34b` added a regression. All three payment recipients, NFT ownership and remaining prefund are asserted. The subsequent actual RPC and 17-test Foundry results pass. No shipping core or treasury custody source changed.

Raw Gitleaks 8.30.1 on the selected uncompressed public CI artifacts returned **exit 1 / 206 observations**: public source-response hashes, synthetic NFT/token addresses and synthetic token runtime hashes. Every exact field/value/line is bound in the manifest and [original redacted report](raw-public-data-scan.json.gz); unknown observations would block archival. This is separate from the unchanged full-history raw five-finding scan and its exact immutable-source adjudicator. No scanner rule, severity or ignore entry changed, and neither scan grants financial clearance.

## Reproduction

Use the existing pinned toolchains and dependency lockfile. No new service, credential or funded transaction is required.

```sh
node --test docs/evidence/rmt-task082/acceptance/review.test.mjs
node --test packages/launchpad-common/seaport-order-verifier.test.mjs scripts/seaport-verification/*.test.mjs
forge test --root packages/contracts/nft-acquisition --use /pinned/solc-0.8.26 -vvv
node scripts/seaport-verification/fixture-compile.mjs --solc /pinned/solc-0.8.26 \
  --output packages/contracts/seaport-verification/official-artifacts.json
forge test --root packages/contracts/seaport-verification --use /pinned/solc-0.8.26 -vvv
node scripts/seaport-verification/fixture-run.mjs --anvil /pinned/anvil \
  --solc /pinned/solc-0.8.26 --output /outside/repository/fresh-seaport
node scripts/visual-qa/rmt-creator-integration.mjs --nft-acquisition-only \
  --anvil /pinned/anvil --solc /pinned/solc-0.8.26 \
  --pg-bin /isolated/postgres18.6/bin --browser webkit --output /outside/repository/fresh-nft
```

Repeat the final command with `--browser chromium`. The isolated harness uses no production writer/database or owner signature. [Exact offline compiler/source reproduction](../seaport-marketplace/README.md) and [read-only adapter boundaries](../seaport-adapter/README.md) remain separate.

## Screenshots

Actual desktop, portrait and landscape viewport captures preserve the existing RMT UI and show no overflow. These are **automated browser layouts, not physical-iPhone acceptance**. Touch/media properties are recorded before and after capture; none is altered for screenshots.

- [WebKit desktop](screenshots/webkit-desktop.png), [portrait](screenshots/webkit-portrait.png), [landscape](screenshots/webkit-landscape.png).
- [Chromium desktop](screenshots/chromium-desktop.png), [portrait](screenshots/chromium-portrait.png), [landscape](screenshots/chromium-landscape.png).
- [Exact direct-wallet cost review](screenshots/webkit-nft-direct-721-17-cost-viewport.png) and [Safe outer cost review](screenshots/webkit-nft-safe-outer-721-27-cost-viewport.png), before wallet confirmation.

**BLOCKED_NO_BROADCAST.** Production marketplace execution, own-token buybacks and financial activation remain unavailable. This is internal engineering evidence, not an independent audit.
