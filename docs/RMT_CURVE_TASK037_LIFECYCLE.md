# RMT Launch same-app lifecycle

This review branch starts from [#602 at 1ebd2270](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/602). It extends the creator journey in `apps/launch-website` with exact-in curve purchases and sales, a separately confirmed finite token approval, permissionless graduation, and a verified v4 handoff. It uses the reviewed [#594 fixture](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/594) at `8dca5773cbd4dc98f52a45616f420bce96b000f0`. The fixture compiles the [#592 candidate](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/592) Solidity tree `e98de2eaedcf9d233bac0860094e7179db2ab562` with the pinned Solidity 0.8.26 executable and normalized compiler input SHA-256 `992dc7cf86dbd3a6d2cc305422a6f667a2f2624538259145505c2e9703cbbc9f`. The reviewed 2 ETH profile runs on a local Anvil fork of Base Sepolia block 57648300, hash `0x5bb29976ce80ddede79f192c61eba8fe9d96f499f8bfa11e0820d11820e91d20`. The fixture chain ID is **31337**, and all wallet operations use synthetic assets.

## Reproduce the connected browser run

Use Node 22, pnpm 10.12.1, Anvil 1.7.1, PostgreSQL client and server binaries, Chromium from the pinned Playwright package, and a clean, detached #594 worktree prepared with its pinned dependencies. The [Task 036 guide](RMT_CURVE_TASK036_CREATOR_INTEGRATION.md) records the same compiler inputs. The `isolated-lifecycle` GitHub Actions job installs and checks the required inputs.

```sh
pnpm install --frozen-lockfile
pnpm --filter @rmt/launch-website build
pnpm --filter indexer build
pnpm exec playwright install chromium
node scripts/visual-qa/rmt-creator-integration.mjs --candidate /path/to/exact-594 --anvil /path/to/anvil --solc /path/to/pinned-solc --pg-bin /path/to/postgresql/bin --output /path/to/new-evidence
```

The program makes a dedicated loopback PostgreSQL cluster with a random name and temporary read credentials. It starts its own loopback Anvil, Next.js and worker. It refuses a different contract tree, compiler checksum or deployment anchor. Use a fresh result directory. Share only the generated JSON proof and screenshots. They contain fixture addresses and hashes. The database, runtime logs and credential files are outside the artifact upload.

The [pinned #594 verification](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/8dca5773cbd4dc98f52a45616f420bce96b000f0/docs/RMT_CURVE_TASK025_VERIFICATION.md) covers its own Foundry, independent v4 trades and claims. Repeat the old application browser against its own loopback deployment for those regressions. Its test results are separate from this website's lifecycle.

## Evidence and activation boundaries

- Review binds the account, chain, factory, exact calldata and value, wallet nonce, quote block, deadline, and minimum output. A fresh quote and simulation, plus an explicit wallet action, are required to sign. The browser records the original envelope before calling the wallet. A lost hash can be recovered from the exact canonical account nonce. The original request cannot be replayed by the app. ERC-20 approval authorizes only the reviewed sale amount to the bound curve.
- The isolated worker writes canonical curve events, graduation and observed state to the same dedicated PostgreSQL database that tracks creation. It independently verifies the token movement and ledger credits, and requires exact transfer traces for proceeds/refunds. Reorgs remove orphaned receipts and phase observations in the same checkpoint rollback. An absent proof withholds the lifecycle response. The private worker key is server-only. Existing V4/V6 tables, worker and current historical feed are outside this change.
- Buys close at the 2 ETH backing and 60% sold threshold. The candidate still permits selling before graduation, which can reopen buying. A separate graduation transaction closes both curve paths. The confirmed detail page shows the full PoolKey, custody owner, original LP position and principal, initial deposits, dust and StateView observations. Swaps and LP claims remain regression-only in #594.
- This fixture supports direct EOA transactions on the pinned V1 curve. Smart wallets and migrated engines are outside the admitted lifecycle profile. The read API keeps bounded history and uses a two-block synthetic checkpoint. Ethereum L1 finality stays unverified. Netlify's public and preview builds retain read-only execution routes and the historical feed.
- Production remains gated by independent disposition of the 18 active-engine Slither highs and migration warnings, approved economics and signers, exact 4663 deployment/runtime provenance, production archive/trace and finality evidence, hosted routing and indexing, and physical-wallet acceptance. This branch makes no changes to the reviewed Solidity, security gate, hosting or economics.
