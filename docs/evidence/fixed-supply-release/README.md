# Fixed-supply release handoff

**BLOCKED_NO_BROADCAST.** Task 051 starts from #631 at `58638966db82cffe89db6df4e918f73eced8ad2b`. The deployable Solidity, 4663 compiler closure and dependency pins are identical to #631. The first RMT project in the unsigned bundle uses synthetic fixture identities. All production transaction inputs are unassigned.

- [Release manifest](release-manifest.json) binds the compiler, rehearsal and failed security analysis. Bootstrap limits measured against exact constructor encodings are 48,729 bytes of initcode with 423 bytes of margin and 23,843 bytes of factory runtime with 733 bytes of margin.
- [Unsigned fixture bundle](unsigned-bundle.json) records all five constructors in nonce order, three bootstrap children, the guard's CREATE2 salt and permission bits, materialized runtime hashes, gas observed on the fork and the first RMT token's CREATE2 address, full PoolKey and PoolId. The five raw unsigned constructor requests and the exact creation calldata are available in the linked fork report. For each constructor, concatenate the pinned compiler's creation bytecode with the stored `constructorData` (remove the suffix's `0x`). Verify its Keccak-256 before use in a fixture.
- [Production observations](production.md) capture current runtime and provider capabilities, the distinct V6 feed, one older independently corroborated Ethereum L1 batch and the vacancy of both proposed Safe addresses.

## Reproduce

Use the checksum-verified native solc 0.8.26 executable, Anvil 1.7.1, Node 22, pnpm 10.12.1 and the [pinned dependency setup](../../DEPLOYMENT.md#review-locally). Run from the repository root. Set `$solc` and `$anvil` to executable paths and `$forkEvidenceFile` to a fresh output file.

~~~powershell
pnpm test:release-evidence
node packages/contracts/scripts/verify-fixed-supply-bundle.mjs --solc $solc --fork docs/evidence/fixed-supply-release/fork-4663.json.gz --verify docs/evidence/fixed-supply-release/unsigned-bundle.json
pnpm test:fork-4663 --anvil $anvil --solc $solc --archive pocket --output $forkEvidenceFile
~~~

The verifier uses no RPC. AST output identifies immutable offsets. The canonical compiler input and bytecode templates retain their pinned hashes. The fork uses local receipts and test-only time advancement. A fresh run uses different synthetic governance signatures and may use a different provider after archive verification. To materialize its own fixture bundle, use the fresh report as `--fork` and a fresh file with `--output`.

## Security disposition

The exact 4663 closure was analyzed again with Slither 0.11.5 and crytic-compile 0.3.11. All 233 finding IDs matched the preserved report. The 18 active high findings and four dependency highs remain in the failing release gate. The [individual findings matrix](../fixed-supply-security/findings.md) maps each row to the affected operation, assets and existing hostile-interaction tests. [Exact full report](../fixed-supply-security/slither-4663.json.gz) · [Settlement and dependency reachability](settlement-traces.md).

- The six migration high rows concern pre-transfer token balances around three writes. For both funded RMT transitions the exact ordered call graph binds Token V2's inventory transfer, the original ledger's accrual-writer switch and the reviewed successor's acceptance of backing. Premature execution reverted. The holder balance, total supply, backing, inventory, committed economics and four fee-credit buckets reconciled after each transition. The interrupted acceptance and in-flight routing rollback regressions remain part of the Foundry suite. Independent disposition is still required for changes to the admitted runtime or downstream consumers.
- For the seven governance medium rows, the six Directory V2 equality findings retain their internal false-positive assessment under the current signed-message predicates. The Registry V3 settlement-order finding remains open. The real mutation trace shows one factory write beneath `executeMigration`. The eight post-return getter checks are static reads, with both canonical route barriers retained. The additional two-project funded regression covers committed migration, invalidation of the other project's old quorum, fresh proposal approval and notice, exact reserve handoff and entitlement isolation. [Governance matrix](../fixed-supply-security/findings.md#seven-governance-medium-findings) · [Funded regression](../../../packages/contracts/test/RMTLaunchMigrationReadiness.t.sol).

## Release blockers

| Action owner | Required evidence or decision |
| --- | --- |
| Independent reviewer | Disposition of the exact 18 engine highs, four dependency highs and seven governance mediums, including admitted successor runtimes, shared PoolManager accounting and Registry V3 transaction-wide behavior. The review gate remains failed. |
| RMT owner | Verify and approve separate deployed Operations and Reserve Safes, an approved deployer and fresh pending/confirmed nonce, the existing signer policy and incident ownership, first-project creator, metadata and treasury terms, and exact economics. The candidate still uses 0.0004 ETH creation, 2 ETH backing, 1% curve fee and 90/5/5 for review. |
| Indexer and infrastructure operators | Prove reliable archive and trace failover and retention, receipt-level Ethereum L1 verification, authenticated new-engine replay and recovery, and hosted routing for the deployed full guarded PoolKey. Historical V6 coverage remains separate. |
| RMT owner and release operator | Confirm supported physical wallets and recovery. Approve deployment, first funded acceptance and public execution separately after the applicable gates pass. |
