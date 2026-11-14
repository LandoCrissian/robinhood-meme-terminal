# RMT Launch creator integration on chain 31337

Task 036 starts from [draft #601](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/601) at `bc6898a94137d4e4be59562b4ee20f2c1ba5fcfb`. The transaction fixture uses [#594](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/594) `8dca5773cbd4dc98f52a45616f420bce96b000f0` and the [#592](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/592) Solidity tree `e98de2eaedcf9d233bac0860094e7179db2ab562`. Task 036 changes no Solidity or audit gates.

## Run the connected test

Use Node 22, pnpm 10.12.1, Anvil 1.7.1, PostgreSQL 18 client and server binaries, and the candidate's [checksum-pinned solc 0.8.26](RMT_CURVE_TASK026_OWNER_ACCEPTANCE.md). The script requires an existing clean #594 worktree with its pinned Foundry dependencies, and the currently reviewed `apps/launch-website` and indexer builds. From this branch run the equivalent commands for your local paths.

```sh
pnpm install --frozen-lockfile
pnpm --filter @rmt/launch-website build
pnpm --filter indexer build
node scripts/visual-qa/rmt-creator-integration.mjs --candidate /path/to/pinned-594-worktree --anvil /path/to/anvil --solc /path/to/solc-0.8.26 --pg-bin /path/to/postgresql/bin --output /path/to/new-evidence-directory
```

The launcher checks candidate and Solidity tree, compiler checksum, compiler input hash and the Base Sepolia read-only fork anchor `57648300` / `0x5bb29976ce80ddede79f192c61eba8fe9d96f499f8bfa11e0820d11820e91d20`. It deploys the 2 ETH profile only on its own loopback Anvil chain 31337 and creates an isolated temporary PostgreSQL 18 cluster with its own database marker. All signing keys and assets are ephemeral fixture material. The public site's runtime, Railway worker, historical volume and Netlify deploys are outside the test path.

## Evidence boundaries

- The **new** `apps/launch-website` form separately validates the draft, prepares the test transaction, independently encodes the reviewed values in the browser, and checks the wallet against the bound factory deployment block before an explicit request. It commits the request identity locally before calling the wallet. Recovery only reads the original request, known hash and exact factory intent. Ambiguous, interrupted or revised evidence cannot trigger another signature.
- The candidate binds the project URI in successful creation calldata and the canonical creation event. It has no separate URI storage getter. The harness checks the calldata, canonical event and contract getters available at the creation block for identity, treasury terms, supply and opening curve balances. Description and artwork remain browser-local. The fixture never fetches or uploads creator metadata.
- The test creation path requires exactly `400000000000000` wei. It accepts no overpayment. The dormant 4663 verifier remains separate. Registration proof of value plus a fee event does not prove a native refund. Any later overpayment feature must retain the exact transfer-trace verification in #594 and wait if that evidence is missing.
- The worker keeps one PostgreSQL writer lease. It records chain, factory, deployment block hash, token, canonical block, transaction and log index in fixture-only tables. Confirmed state is atomic with its checkpoint. Reorg rollback removes receipts tied to invalidated blocks, and reads fail closed before the replacement range is available. The local worker supports candidate direct-call creations. Hosted completeness, nested smart-wallet routing, production archive/trace operations and Ethereum L1 finality require separate evidence.
- Public site tests run the same application without fixture configuration. The test API, new-engine read API, signing and runtime deployment details stay blocked. A hosted runtime, bad manifest, unbound host, or nonloopback address cannot activate the creation API. The active V4/V6 client and snapshot fallback remain separate.

## Before activation

Keep the 18 active-engine Slither high findings, migration warnings and historical parser limitations visible in the [independent review package](RMT_CURVE_TASK025_VERIFICATION.md). The task does not approve economics, governance, deployment bytecode, signed production transactions or database migrations. A production release still needs independent disposition, explicit economic and governance approval, deployment/runtime and full PoolKey provenance, durable provider/recovery and finality evidence, and physical-wallet acceptance. The previous [creator journey handoff](RMT_CURVE_TASK035_CREATOR_JOURNEY.md) records the detailed terms and supporting loopback trading, V1/V2/V3, graduation and custody evidence.
