# RMT Launch v4 settlement on chain 31337

This branch starts from [#604](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/604) at `21ab2649e4280ba0358c94859d220378408f6164`. The same `apps/launch-website` token page presents the verified graduated pool, exact-input swaps, separately reviewed finite approvals, permissionless collection, and each beneficiary’s own fee credit.

The automated browser uses the clean [#594](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/594) reference at `8dca5773cbd4dc98f52a45616f420bce96b000f0`, Solidity tree `e98de2eaedcf9d233bac0860094e7179db2ab562` from #592, and the SHA-256 pinned Solidity 0.8.26 compiler. The compiler input is `992dc7cf86dbd3a6d2cc305422a6f667a2f2624538259145505c2e9703cbbc9f`. The synthetic chain 31337 fixture forks read-only Base Sepolia block 57648300, hash `0x5bb29976ce80ddede79f192c61eba8fe9d96f499f8bfa11e0820d11820e91d20`.

## Reproduce

Use Node 22, pnpm 10.12.1, Anvil 1.7.1, PostgreSQL, the pinned compiler, and the clean reference worktree with its dependencies. The existing [fixture setup](RMT_CURVE_TASK037_LIFECYCLE.md) identifies the exact inputs and repository workflow.

```sh
pnpm install --frozen-lockfile
pnpm --filter @rmt/launch-website build
pnpm --filter indexer build
pnpm exec playwright install chromium
node scripts/visual-qa/rmt-creator-integration.mjs --candidate /path/to/exact-594 --anvil /path/to/anvil --solc /path/to/pinned-solc --pg-bin /path/to/postgresql/bin --output /path/to/new-evidence
```

## Review boundaries

- The fixture pins Universal Router 2.1.2, Permit2, Quoter, PoolManager, PositionManager, StateView and the candidate initialization guard/runtime. Each swap uses the full verified PoolKey, exact input, per-hop price floor, minimum output and deadline. The wallet journals the intent before sending and verifies the same account, nonce and blocks on recovery.
- The isolated writer verifies canonical receipts, token transfers and native movement before publication. Checkpoint rollback removes orphaned proof rows. Tests interrupt receipt, trace and RPC reads and replace chain history locally. Historical V4/V6 storage and public reads retain the production schema and source provenance.
- The UI shows pool-fee estimates in the input asset. Uncollected fees are observations of the original locked position. Collection credits the bound ledger. Claims pay only the selected account’s verified credit. The connected test checks principal and owner before and after swaps, collection, claims and restart.
- The loopback fixture accepts direct EOA transactions and bounds receipt recovery/history. Smart wallet paths, arbitrary router calldata and full external pool history require separate evidence. Public Netlify production and deploy previews remain read-only. No contracts, prices, custody, fees or production services are changed.
- Funded activation remains gated by independent disposition of the 18 active-engine Slither highs and migration warnings, exact 4663 deployment/runtime provenance, economics and signer approval, production traces and L1 finality, hosted routing/indexing and physical-wallet acceptance.
