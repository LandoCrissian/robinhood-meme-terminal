# Token trading and graduation

The approved bonding curve sells 600 million tokens from a one billion fixed supply and graduates with 2 ETH of real backing. The token page reads net sales and backing at the same confirmed block. A sell can reverse both figures. Reaching the target shows “Graduation pending”. A matching graduation receipt and on-chain pool identity are required to show the completed Uniswap v4 position. [Published factory](https://robinhoodchain.blockscout.com/address/0x7281e1F9D8764Ae6533b374DFd08AB2ECbC273c3) · [Deployed economics and creator disclosures](../graduation-economics/README.md)

**Hosted preview** — Select “Opening”, “Curve buy 4”, “Curve sell 4” or “Atomic graduation” to inspect the transition. The quote panel uses contract quotes recorded at the selected block. Wallet execution is disabled on this host. The public website remains on Netlify production deployment `6b029787efaaf7bc868d68e4`. [Open the trading preview](https://6b02b785902df208e890e377--eclectic-valkyrie-16cb92.netlify.app/review/trading) · [Desktop Chromium](desktop.png) · [Mobile WebKit](mobile.png)

| Hosted artifact | Identity |
| --- | --- |
| Preview deployment | `6b02b785902df208e890e377` |
| Application commit | `55ac66fc1f1f0970db984883fa9cee5acf07114a` |
| Linux CI bundle SHA-256 | `20a91fd0a95817029b3394103d68d73af49ea86ca34673cf0fea31b39e7df617` |
| Hosted server function SHA-256 | `191d4616291fb2679ece070b7c24620d6b4f272d7843f222486fa6a5eb8b9474` |

The Linux release artifact passed source, archive, financial-route and edge-rule checks. Netlify returned the matching server function hash. The review also serves the previously published three-file People snapshot whose hashes are in the verification record. Desktop Chromium and WebKit verified the hosted chart, price and FDV, order quotes and slippage, empty history, sellback, graduation and refresh. The 375 px WebKit viewport accepted the chart pinch and held its layout. Both engines restored a creator draft and showed the exact graduation disclosure. [Hosted and production responses](verification.json) · [Exact Linux build](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/45007543150)

## Contract and price evidence

Two isolated Anvil forks used the actual deployed Robinhood Chain contracts at block **120526594**, hash `0x44c1060d862e1e81519a2871f2035d5dc3d2f30494d5142cb073087c57010ed5`. Robinhood and Pocket served the upstream reads. All simulated transactions used an impersonated local ECON account on loopback. Each fork produced **54 canonical receipts and 35 fills**. Both returned the same quotes, state and candles at all 36 checkpoints. [Transaction receipts and block hashes](receipts.json) · [Checkpoint states, executable-size quotes and OHLCV](market-replay.json)

| Checkpoint | Net tokens sold | Real ETH on curve | Verified observation |
| --- | ---: | ---: | --- |
| Opening | 0 | 0 | No candles |
| Curve buy 4 | 219,111,189.179694 | 0.554400 | Confirmed buy |
| Curve sell 4 | 207,111,189.179694 | 0.520089507246990511 | A 12 million token sale reversed progress |
| Alternate final buy | 600,000,000 | 2 | Standalone graduation succeeded on this branch, then the local fork rolled back |
| Atomic final buy | 600,000,000 | 0 | The curve funded its locked v4 position with 1.999999999999998463 ETH |

Pre-graduation candles use amounts actually paid or received in the factory-bound curve's trade logs. Buy volume excludes refunds, sell volume deducts the curve fee, and both exclude gas. Pool candles use signed currency deltas at the pinned PoolManager for the exact graduated PoolId. This rehearsal's pool was `0xa189305d0cfd8018b06d615a7968b68f4113522eea153d09f09722efc2d21816`. Both trade directions settled before and after graduation. An underfunded final buy and a v4 buy outside its slippage limit reverted without changing the tested state.

The final one-minute chart has 20 occupied buckets and **2.872190433439506865 ETH of turnover**. Turnover can exceed the 2 ETH backing target. Each candle uses the first, highest, lowest and last fill in canonical transaction-log order. An independent receipt-word decoder rederived the prices and exact native volume at all five intervals. The website displays gwei per whole token and ETH fully diluted valuation at the fixed supply. It does not publish a USD quote. [Price and volume checks](../../../apps/launch-website/lib/server/token-market.test.ts)

A fresh repeat on both providers at block **120535468** matched all 36 state and quote comparisons. Its minute OHLCV values and exact wei volumes matched after accounting for the new block times. [Repeat block, checks and file digests](verification.json)

## Indexer and wallet checks

The indexer serves cached-history reads from its existing activity tables and checks the state against both RPCs. The database test compared all **180 checkpoint/interval combinations**, exercised pre-existing rows without cached block times, paged older candles, replaced an orphaned branch, and rejected a lagging cursor or conflicting header. A disconnected page labels the previous checkpoint stale. With no prior verified read it omits the progress figure. [PostgreSQL test](../../../apps/indexer/src/market-postgres-smoke.ts) · [Chromium and WebKit outage test](../../../scripts/economics/review-market-outage.mjs)

The website confirmation component was exercised with isolated browser wallets on desktop Chromium and mobile WebKit. Editing the input invalidated a prior quote. After a rejected request and a lost wallet response, refresh recovered the original transaction without resubmission. The atomic purchase required both the trade and graduation evidence before settlement. Local checks passed all 451 website tests, both browser wallet runs and the PostgreSQL 16.15 integration. Physical MetaMask trading and organic production fills have not been observed.

## Release decision

**Ready for website and indexer review. Financial activation remains on hold.** The production HTTP checks returned disabled configuration and 404/unavailable for creation, trading and claims. Deploying the authenticated indexer reader and website, verifying their production checkpoint together, and obtaining separate financial approval are outstanding.

The Railway standalone image initially omitted the replay file from its Docker context. The corrected image passed its Linux build, startup, read-only runtime and restart checks. The repository's file-usage gate also found four standalone economics tools without declared entry points. The package now registers those exact CLI programs with Knip, and the local repository check passes. [Railway container check](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/45008023347)

Gitleaks retained **361** historical matches. Its existing classifier recognized 322. Independent CREATE2 derivation reproduced all **39** remaining findings as public ERC-20 contract addresses at their exact Git commits and lines. The scanner and synthetic canary still reject unclassified values. Its red merge gate remains open for independent review. [Raw scanner run](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/45007543159) · [Read-only proof verifier](../../../scripts/economics/verify-public-market-addresses.mjs) · [PR checks](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/689/checks)

## Reproduce

From the repository root, `pnpm --filter @rmt/launch-website test:history` runs website and independent OHLCV checks against the recorded receipts offline. Run `node scripts/economics/review-market-outage.mjs` after installing the Playwright Chromium and WebKit engines. To repeat both forks, run `pnpm --filter @rmt/launch-website exec tsx ../../scripts/economics/replay-market.mts <absolute-anvil-executable> <absolute-empty-output-directory>`. The default selects a new common confirmed block. Appending `recorded` pins the published block and hash and requires historical state from both providers. An attempted subsequent pinned rerun returned RPC error `-32000 historical state is not available`. [Fork runner](../../../scripts/economics/replay-market.mts) · [CI database suite](../../../.github/scripts/run-task092-postgres.sh)
