The production adapters completed a continuous chain-4663 economic lifecycle on a verified loopback Anvil fork of the exact deployed contracts. The fork created only **Synthetic Adapter Project / SYN092**. No production transaction, signature, deployment or governance execution occurred.

`evm-acceptance.json.gz` is the complete, unmodified successful run. It records all eight trading operations, all six claim operations, exact quotes/calldata/receipts, canonical authenticated PostgreSQL activity through the actual production indexer, and lost-hash recovery for every trade. A 2 ETH gross buy and a 4 ETH gross buy preserve the approved **2 ETH backing** graduation threshold; the latter refunds the excess. Claims retain `l1Finality: unverified`. A human review spanning twelve additional canonical blocks revalidated the unchanged request against fresh native fee evidence without raising its fee ceiling.

The same leased PostgreSQL writer persisted 52 events across a connection/indexer restart, rejected a competing writer, and removed an actual `evm_revert` orphan. The old transaction became unavailable and was never rebroadcast. A separate typed pruned-state fault affected only token/ledger creation-height code reads; the complete source-bound constructor/runtime proof recovered them. Factory deployment recovery used the actual canonical bootstrap transaction rather than an archived-code replacement.

`evm-attempts.json` preserves the status, failure and SHA-256 of all nineteen raw attempts. All raw files remain outside the checkout. The accepted run's initial/completion hashes show unchanged source and `sourceStableDuringRun: true`. Earlier failed runs and the intermediate successes remain listed, including a stopped local PostgreSQL instance and earlier assumptions corrected by real runtime observations.

Separate sender regressions reproduce and fix a nonce rewind after a previously consumed trade/claim/creation receipt. Active and archived receipts retain a durable per-account maximum consumed nonce; a reverted receipt also consumes it. A candidate at or below that floor is blocked before any wallet method, while a higher fresh nonce remains usable. Capacity/storage failures preserve the original request. One shared production financial mutex serializes all accounts' floor/index writes, preventing a two-tab lost update; per-Safe authorization locks remain in place.

This is isolated economic and recovery evidence. Two logical readers observe one local EVM. Anvil uses explicitly synthetic, value/calldata-specific C8 estimates and native ArbGasInfo zero-poster measurements. The execution, header, native and RPC fee observations remain distinct, and the reviewed ceiling covers their maximum. Separate real two-provider native-policy observations are in `../operations/nitro-zero-poster-native-verified.json`; this rehearsal does **not** accept a live mainnet transaction or clear owner wallet/financial activation gates.

The actual production worker first ran two bounded cold passes from its true deployment cursor without a manual seed. It correctly remained unavailable while behind. Only then did the isolated test restore a clearly labeled synthetic empty checkpoint at the fork block for the complete economic journey. That checkpoint is not a production backup. A full pre-fork historical backfill was not observed here; the test intentionally avoids a broad public historical scan. Production backup/restore evidence and hosted full catch-up remain owner rollout gates.

Reproduce from `apps/launch-website` with an isolated PostgreSQL server already running on loopback:

```powershell
npx tsx ../../scripts/production-adapters/run.mts --anvil <absolute-anvil-path> --output <fresh-json-path> --pg-port <isolated-port> --latest
```

The runner admits only the existing official/Pocket public read origins and checks loopback host, Anvil version and chain 4663 before every local mutation. It uses no production credentials. Financial routes remain disabled by default.
