# Robinhood Chain launch discovery

This change targets the read-only Netlify website in [PR #595](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/595) at commit b33ae963c6423b105db38a3c4b6d50e4edaf7340. The website renders historical RMT registrations by chain and contract address. The new bonding-curve engine is in prelaunch. External tokens are outside the registry, and the previous fictional examples are removed. Token creation, wallet signing, trading, claims and governance remain disabled.

## Evidence and coverage

The snapshot records Robinhood Chain 4663 block **113899119**, hash **0x0a20d4db277fe2c689ffd68763710c54a59d833dab097f2994c6aa7937ccc10c**, observed onchain at **2026-11-14 04:26:14 UTC**. The public read-only verifier uses the official Robinhood RPC and Pocket for receipts, and the same pair for checkpoint state in the committed replay. An earlier verification used Pocket and PublicNode when the official provider could not supply checkpoint state. The pinned verifier uses EIP-1898 block-hash reads. Public provider support varies by method and block age. A repeat at the original block needs two providers still retaining its state. If public state is pruned, run without a block argument for a fresh checkpoint 20 blocks below the second available head, and compare all original receipt identities.

The verifier checks the factory, registry, and curve implementation code hashes and bindings. It matches successful receipt logs and their block hashes to each factory's stored registration, including the token, creator, curve, and reserved PoolId. It checks the curve's token and PoolId bindings and reads graduation flags at the same checkpoint. V4 had two registrations, V5 had zero, and V6 had two. V4 launch 0 is a deployment test and is available by exact address. V4 launch 1 and retired V6 launch 0 retain their separate contract identities. V6 launch 1 is the historical SEIS0 registration. Registry counts speak only for these pinned factories and checkpoint.

The archive records registration activity and the observed curve phase. A reserved PoolId is evidence of a reservation. The website has no evidence of a funded v4 pool or custody for these entries. An authenticated V6 index can add a verified historical liquidity-migration event when positive settlement is present. Current reserves, volume, trading status, and Ethereum L1 finality remain unverified. Indexer confirmation depth alone gives an L2 observation. [Robinhood Chain connection and archive guidance](https://docs.robinhood.com/chain/connecting/) · [Checkpoint in the Robinhood Chain explorer](https://robinhoodchain.blockscout.com/block/113899119)

Reproduce the committed snapshot from the repository root with Node 22 and pnpm 10.12.1. Review the resulting diff before committing an update. The generator fails on disagreement between providers that supply usable proof. A different block may change the counts, lifecycle evidence, provider availability or the completeness flag.

~~~powershell
pnpm install --frozen-lockfile --filter @rmt/launch-website...
pnpm --filter @rmt/launch-website exec tsx scripts/refresh-historical-launches.ts 113899119 |
  Set-Content -Encoding utf8 apps/launch-website/data/historical-launches-4663.json
git diff -- apps/launch-website/data/historical-launches-4663.json
~~~

## Netlify and persistent indexing

The existing Next.js app serves the same sanitized view through GET and HEAD at /api/launchpad/launches and /api/launchpad/launches/{token}. Hold the bearer token on the server. The queryless API returns explicit ready, stale, or unavailable states. Malformed queries are rejected. Exact addresses missing from verified coverage return 404, or 503 when there is no usable source. An unknown address can belong to an external token or to a registration outside current coverage.

The frontend initially works from the committed snapshot with a stale label. It makes no per-visitor RPC calls. A restored V6 worker can provide continuing data. Optional runtime variables in Netlify are RMT_LAUNCH_HISTORY_INDEXER_URL (exact HTTPS origin) and RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN (matching the worker's RMT_INDEXER_READ_TOKEN). Keep the credential out of builds, browser config and logs. The cached list is coalesced per server instance for 30 seconds, including brief failures. Any upstream read is bounded to three seconds and 64 KiB, and each instance permits up to four concurrent distinct exact-token reads when needed. V4 remains pinned snapshot evidence. Netlify handles page rendering and API requests. The polling worker and PostgreSQL stay separate from Netlify. [Netlify Next.js architecture](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/)

The legacy Railway service exists, but the most recent visible deployment failed and the configured /ready and /health return HTTP 404. The last listed deployment of its original PostgreSQL service is removed. Review archive used only public read-only endpoints. Continuous refresh requires an owner-approved restoration or existing compatible long-running worker, persistent PostgreSQL, an eligible archive RPC and an authenticated HTTPS read endpoint. No service or subscription was provisioned. Snapshot operation adds no ongoing RPC service, and dynamic Netlify invocations use the existing plan's usage allowance.

For a continuous feed, restore the existing database from a reviewed backup into an isolated instance first. The V6 start block is 10248855 and the minimum configured L2 confirmation depth is 20. Confirm the restored factory and deployment boundary, run canonical checkpoint and count reconciliation, compare the original receipt identities to the snapshot, and exercise restart and reorg recovery before configuring Netlify. Keep one active writer. The worker checks up to 64 recent checkpoint records for a common ancestor. A rollback requires both configured providers to confirm the mismatch, and deeper or disputed reorganizations stop the projection for operator review. The worker can fall back to an archive provider for registration scans with matching range-boundary hashes, plus receipt and checkpoint reads. General historical trade and fee scans keep the primary RPC and backoff. Save tested backups and observe checkpoint age, RPC failures and proof availability. A read-only endpoint or historical snapshot alone cannot verify Ethereum L1 finality. [Existing worker configuration](PRODUCTION_INDEXER_DEPLOYMENT.md) · [Historical worker read and recovery behavior](../apps/indexer/README.md#historical-launch-projection)

## Local review

~~~powershell
pnpm --filter @rmt/launch-website test:history
pnpm --filter @rmt/launch-website build
pnpm --filter @rmt/launch-website start --hostname 127.0.0.1 --port 3205
~~~

Run the browser suite in a second terminal with the repository's Playwright browsers installed. Set RMT_WEBSITE_BROWSER to chromium or webkit and RMT_WEBSITE_PREVIEW_ARTIFACTS to a separate directory for each run.

~~~powershell
node scripts/visual-qa/rmt-netlify-website.mjs
~~~

Checks and screenshots come from a local production-style build or the PR workflow. An emulated iPhone viewport provides layout evidence. The live Netlify deployment and domain from Task 028 remain in service. Review the PR and snapshot or continuous-feed operating choice before a separate website publication.
