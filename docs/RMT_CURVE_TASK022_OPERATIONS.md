# RMT Launch production-readiness handoff

The independent-review candidate is [draft #589](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/589) at `b611ca0d1b4a8122cfc6ebbbc02b04bbe1d40a6b`. Its full `packages/contracts` tree is `02c70f417a256853fa37099f1b3ee32c36e6ea30`, the Solidity source tree is `7541e6ee5129630111fd0cee61055040add9a924`, and the Slither workflow blob is `c1f29e7731ddfe671d4ad408f811fd9bc813bda5`. The Task 022 branch adds read-only operations tooling, local backup recovery and a separate dependency commit. The 4663 executable remains an offline review build. The web curve runtime remains restricted to chain 31337 and loopback.

## RPC and Ethereum evidence

Run from `apps/web` with the pinned Node and pnpm environment:

```sh
node --import tsx scripts/probe-robinhood-launch-readiness.ts > robinhood-readiness.json
```

The probe uses fixed public endpoints, a fixed historical anchor, a fixed unrelated router transaction and a read-method allowlist. It bounds calls and responses, emits no keys, raw traces or calldata, and records each capability separately. Successful process exit means it emitted a report. The status of each read is in the report.

The pinned 4663 block is `113412054`, hash `0x17252a232b68a4e9fc494caf0660cff722ac2da966ee5c62b40e20dbcfd32ea2`. All four public RPCs returned the anchor and agreed on the receipt and PoolManager swap log for the sample Router 2.1.2 sell at block `113614472`. Pocket, dRPC and Pinax returned a normalized `callTracer` with the same direct PoolManager-to-sender payout of `12061233538253827` wei. This is a capability sample using an existing transaction. The fork and archive probe have different state-read requirements. [Public sample receipt](https://robinhoodchain.blockscout.com/tx/0xed20008784b2087a543cdc046622046e9713fdfc7feac8381e5416874d153af2)

| Endpoint | Historical code by height | Historical canonical code and call by hash | Sample trace |
| --- | --- | --- | --- |
| Robinhood public | Historical state unavailable | Historical state unavailable | Method unavailable |
| Pocket public | Observed | Mixed historical-state results between method and run | Observed |
| dRPC public | Observed | Observed | Observed |
| Pinax public | Observed | Observed | Observed |
| Existing authenticated Alchemy app | Historical router manager call by height observed | Canonical block-object behavior untested through connector | Trace entitlement unverified |

The authenticated app was already configured for Robinhood Mainnet and returned chain ID 4663 and the expected Router 2.1.2 manager at the anchor. The connector exposes block numbers for that call. Its trace tool requires a paid plan, so this check used public traces and created no app or paid usage commitment. Point observations do not establish retention, operational independence, quota or uptime. Pocket has returned missing state in hosted CI, Pinax has hit 429 and dRPC has previously returned unknown state. [Robinhood provider and public RPC guidance](https://docs.robinhood.com/chain/connecting/) · [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898) · [Prior fork limitations](RMT_ROBINHOOD_4663_FORK_VALIDATION.md#canonical-fork-and-dependencies)

Approve a primary archive and independently operated witness. Require full deployment-to-head history for logs, receipts and historical contract reads, and trace retention covering the longest supported wallet recovery interval. Exercise exact hash-based canonical calls, bounded log and response sizes, burst quota and backoff from the intended host. Verify positive and reverted traces, deep and oversized traces, stale history, 429 and disagreement. Missing exact native payout evidence stays pending. A failover starts with chain, runtime, anchor and canonical receipt reconciliation against the same branch. Keep user intents and hashes through incidents.

All four L2 endpoints returned Nitro batch hint `391069` for the anchor. On Ethereum chain 1, PublicNode located a successful SequencerInbox delivery in block `26406539`, hash `0x8bc1088d10536ceed6c57a9847bb9c4f0acca84e1f4021d6e573cc57ada75e52`. dRPC corroborated the delivery by direct receipt lookup and both endpoints agreed on the finalized header and published Rollup/Bridge/SequencerInbox bindings. The delivery transaction references three blob hashes. 1RPC did not corroborate the delivery in this probe. Blob data and exact L2 history were not replayed. Keep three distinct states in the release runbook:

1. **L2 observed** requires exact canonical block, transaction and log identity and any applicable settlement proof.
2. **Ethereum batch delivery observed** requires a successful receipt at the pinned SequencerInbox and independent confirmation of the delivery block on the finalized Ethereum chain. A Nitro batch number is a locator.
3. **Exact L2 history verified from Ethereum** requires independently obtaining and validating the batch data or using a separately operated verified Nitro replay to bind the precise L2 block and hash to that finalized delivery. An assertion confirmation and withdrawal readiness are separate if shown. Missing data, a reorg, an implementation change or disagreement keeps the existing `l1Finality: unverified` state. No runtime verifier is enabled.

Record L2 block/hash, batch number and inclusion, L1 block/hash and finalized checkpoint, inbox and implementation identity, blob commitments or other data location, evidence provenance and observed time. Pin implementation and governance changes, authenticate backup evidence, and test orphaned L1 delivery, missing blobs and contradictory replay before using the result. [Robinhood protocol contracts](https://docs.robinhood.com/chain/protocol-contracts/) · [Robinhood transaction finality](https://docs.robinhood.com/chain/transaction-finality/) · [Nitro batch data](https://docs.arbitrum.io/run-a-node/data-availability) · [Observed Ethereum delivery](https://etherscan.io/tx/0xd3f4083c48e97fccfc93e1a43562fbf3ca189315fd1bc71f8a443b11e17a6fde)

## Indexing, backups and incident response

The curve route currently advances a request-driven SQLite WAL index, with a **128-block range, 80-event cap, 24 retained checkpoints and 60 requests/minute per scope**. It verifies the deployment anchor, canonical receipts and the observed range, then atomically updates rows and checkpoints. Duplicate ingestion is idempotent. Missing provider data or stale ancestry delays service. Delivered ranges above 80 events now bisect before receipt reads. An oversized single block or an RPC log query that fails before returning results leaves the cursor in place. Requests against a long backlog return delayed while ranges advance. The curve path has no dedicated continuously running worker, persisted production settlement proof store or independent witness. The existing guarded direct-launch worker and the five REST/MCP reads use a separate store and schema. Their limits and backup command apply to that historical path. A curve-backed production read integration remains open. [Curve index](../apps/web/lib/server/curve-launch-index.ts) · [Direct-launch data handoff](RMT_LAUNCH_PRODUCTION_DATA_READINESS.md)

The new local curve backup command snapshots the committed SQLite state with the Online Backup API. It checks schema scope, deployment anchor and latest checkpoint, then publishes to a fresh destination and returns SHA-256. Restore verifies the recorded checksum before opening SQLite, rejects an incorrect scope and uses a fresh destination. It does not establish chain canonicality. Scope inputs are the existing local `RMT_CURVE_*` pins. Commands run from `apps/web`:

```sh
node --import tsx scripts/curve-launch-backup.ts backup /absolute/new-snapshot.sqlite
node --import tsx scripts/curve-launch-backup.ts restore /absolute/new-snapshot.sqlite /absolute/new-recovery.sqlite <recorded-sha256>
```

Keep one active writer on persistent local storage with SQLite locking, supported atomic hard links and sufficient DB/WAL/snapshot headroom. Encrypt off-host backups and keep the digest, source scope, anchor, checkpoint and timestamp in a separate authenticated inventory. Test restore to a new file and canonical replay before routing readers to it. Preserve the old DB on deep reorg, ambiguous state or integrity failure. Rebuild from the pinned deployment anchor into a new store if no trusted checkpoint survives. Do not copy a live SQLite database file alone. The CLI backed up and restored the retained #589 browser fixture to a fresh file at checkpoint 57648343 with matching SHA-256 and anchor. That offline file test is separate from the deterministic provider/replay drill. [SQLite Online Backup](https://www.sqlite.org/backup.html)

Before activation, demonstrate sustained catch-up with a dedicated writer or separately reviewed equivalent, the single-block overflow policy under real traffic, independent reconciliation of log completeness, authenticated off-host backup and a measured restore. Assign retention and RPO/RTO, observability and on-call ownership. The local backup and replay test exercises checksum and scope rejection, reopen, provider outage and orphan removal.

| Monitor | Operator response |
| --- | --- |
| Head age, cursor lag and growth, events per block/range, 503/429 and retry rate | Keep affected reads delayed. Verify anchor and method quotas. Replay bounded ranges. Investigate single-block over-cap cases before restarting. |
| Header, receipt, trace or finality disagreement | Preserve both sanitized observations. Keep settlement pending. Reconcile at the last verified common checkpoint before enabling normal reads. |
| DB lock failures, disk/WAL growth, backup age, checksum and restore duration | Stop competing writers. Protect the original. Restore a known snapshot into a fresh location, replay and compare the canonical cursor before cutover. |
| Wallet recovery age or increased unsettled requests | Preserve the original wallet request and any hash. Disable new submissions in the affected surface through separately reviewed controls. Reconcile receipts without rebroadcasting. |
| Routing or indexing evidence expiration, reverted quotes, runtime pin changes | Mark external status unknown or unavailable. Suspend that route until exact provenance and compatibility are confirmed again. |

Telemetry should contain chain, operation, safe outcome, latency and permitted identifiers. Keep credentials, wallet sessions, raw traces and customer transaction drafts out of operational logs. Test alert delivery and rotation before approval.

## Hosted routing

Uniswap lists Robinhood 4663 and Universal Router 2.1.2. The candidate's offline fork proved this router with its exact guarded PoolKey. A public unrelated swap demonstrates public router use and does not establish hosted availability for this factory. Hosted routing and indexing for the RMT deployment remain **unknown**. Once a separately authorized deployment exists, capture both directions through supported read-only quote/route interfaces and query an independent indexer. Match chain 4663, manager, currency pair and order, fee, spacing, hook, PoolId, evidence block and freshness. Verify executable quote shape, actual router runtime, exact input/recipient, per-hop bounds and deadline in read-only simulation. An empty quote, different pool, missing hook support or unsupported chain is an observed outcome. No live trade is needed for this read acceptance. [Supported chains and routers](https://developers.uniswap.org/docs/trading/swapping-api/supported-chains) · [Hosted quote](https://developers.uniswap.org/docs/api-reference/aggregator_quote) · [Offline capture verifier](../scripts/verify-hosted-v4-observation.mjs)

## Wallet compatibility and physical iPhone

| Operation | Current compatibility and boundary |
| --- | --- |
| Connect and review | Injected EIP-1193 via EIP-6963 or one `window.ethereum` fallback. Requires events, an available Web Locks API and writable storage. Chain ID alone is insufficient. Wallet and app must agree on the reviewed block hash. No WalletConnect session in this curve flow. |
| Create, trade, graduate and claim | Direct `eth_sendTransaction` with a recoverable transaction hash. Verify receipt and transaction `from`, target, calldata and value, canonical block, exact allowances and applicable payout trace. Curve trade, v4 approval and swap remain separate requests. The browser supports recipient curve and LP claims. Factory creation-fee payout is an operator/permissionless contract call to the fixed treasury. |
| Project migration | UI reads version, notice and history. There is no browser migration submission/reviewer workflow. The local acceptance harness uses separate creator calls and 2-of-3 EIP-712 signatures. The frozen registry uses ECDSA recovery for reviewers, so Safe/ERC-1271 contract signatures cannot substitute for those keys. A contract creator may call the registry from its own address outside the current wallet interface. |
| Safe, ERC-4337 and EIP-5792 | No batch, bundler, Safe transaction hash or UserOperation receipt handling. An outer EntryPoint/multisig transaction or a batch ID does not satisfy the direct binding. Canonical nested factory creations can exist onchain and are skipped by discovery. A delegated EOA retaining exact top-level direct transaction semantics is untested. Recovery must never reinterpret a batch identifier as a confirmed transaction. |

MetaMask documents custom networks on Mobile. That leaves exact custom RPC behavior, secure browser storage and 31337 switching to be established on the device. No device evidence was collected. [MetaMask custom networks](https://support.metamask.io/configure/networks/how-to-add-a-custom-network-rpc/) · [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) · [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) · [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792)

Physical acceptance requires an approved phone-reachable isolated fixture with test assets, a trusted secure origin and an exact compatible authenticated wallet RPC for chain 31337. The pinned local curve browser runtime and router client assume direct loopback. A phone-accessible gateway/profile therefore needs separate review and compatibility testing. No phone infrastructure is provisioned in this task.

1. Record candidate commit, device/iOS and MetaMask versions, network ID and nonsecret fixture ID. Use a fresh test-only EOA. Open the wallet's in-app browser, verify the exact trusted origin and add/switch to the isolated chain using only operator-supplied fixture settings. Check `isSecureContext`, `navigator.locks`, durable storage and wallet/app block-hash agreement. Reject the switch first, then complete it. No seed phrase or RPC credentials in evidence.
2. Review a launch, verify exact 0.0004 ETH plus gas and recipient, reject once and confirm once. After wallet approval interrupt the return path, recover the original hash from wallet activity and reopen the app. Check that the pending request prevents resubmission and that the indexed receipt shows the exact fee.
3. Buy and sell on the curve with exact allowances and bounded output. Test wrong account/network, insufficient balance, expired review and a revert. Recover a historical trade after the operator performs an authorized **fixture-only** V1→V2→V3 migration. Verify notice, current version and original token address.
4. Graduate with fixture assets, verify original position custody, test v4 buy/sell and fee collection/claims. Delay the receipt or trace and confirm pending status until the same hash reconciles. Record account/chain changes and expected errors. Repeat layout checks in portrait and landscape.
5. If testing a smart account, record its exact submission method and returned identifier separately. A completed nested call may leave an unindexed onchain creation, so use only isolated assets. Record unsupported paths and leave product support unverified.

## Owner approval manifest

| Decision | Proposed or unresolved |
| --- | --- |
| Candidate / production chain | `b611ca0d1b4a8122cfc6ebbbc02b04bbe1d40a6b` / 4663. Exact production artifact, constructor inputs, deployment authority and release approval unresolved. |
| Creation | **0.0004 ETH** fixed per factory plus gas, illustrative $1 at $2,500/ETH. Initial creator liquidity or purchase is unnecessary. Production fee approval unresolved. |
| Graduation and supply | **2 ETH** real backing, 4 ETH virtual ETH for this review profile, **60% sold / 40% paired**, original liquidity permanently locked. 1/10/100 million fixed-supply presets are review inputs. Production approvals unresolved. |
| Curve fees | **1%** of gross ETH, **90%** creator/project per committed policy, **5%** operations, **5%** future RMT reserve. Draft. |
| LP fees | Draft v4 pool fee **0.30%**, proceeds only from the original locked position. Collect manually when safely realizable receipts are **at least 2×** estimated execution plus posting costs. Include the payer's own claim cost where applicable. Approve payer, budget and policy. |
| Operating treasury | **Unresolved address.** Frozen factory uses this same immutable address for creation fees and the operating allocation. Verify authorization and ability to receive ETH before selecting it. |
| Future reserve and project beneficiaries | **Unresolved production reserve address.** Creator and optional project treasury are per launch, with explicit share. Verify distinct operating/reserve addresses and exact fixed ledger bindings. |
| Governance | **Unresolved signer A/B/C addresses and operators.** Assign independent 2-of-3 signers, notice monitoring, key continuity and recovery. Assign incident lead, backup custodian, release operator and emergency governance owners. Existing authority suspends discovery and migration through the directory, with no principal withdrawal. |
| Infrastructure and acceptance | **Unresolved.** Approve read providers, independence, budgets/quotas, storage, retention, incident response, L1 policy and physical-wallet profile. Require exact-pool external evidence and separate deployment approval. |

## Independent review boundary

Use the [Task 021 audit handoff](RMT_CURVE_TASK021_AUDIT_HANDOFF.md) and its pinned compiler inputs, [exact fork artifacts](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/43490513880/artifacts/14070655337), and the [disposition matrix](RMT_CURVE_TASK020_AUDIT_HANDOFF.md#security-disposition). The [exact Slither job](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/43490514015/job/132110152632) failed with 28 `reentrancy-balance` rows covering funding (12), curve graduation (3), migration (6), holder redemption (6) and LP collection (1). Two factory migration `reentrancy-no-eth` observations also require review. Historical direct-launch V1 funding IR failure and the separate scoped V2 deadline-cast funding gap remain. Frozen-source evidence includes 598 Foundry passes and four default opt-in skips, which were exercised separately. Any fix to the candidate needs a new exact commit, refreshed manifest and tests, and renewed independent scope.
