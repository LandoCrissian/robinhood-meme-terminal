# Robinhood Chain 4663 deployment provenance

Review input for frozen launch source `69cfaa392e488f475b8b1e15a34c0ac986abd24e` and the isolated 4663 compile. The repository's normal launch and wallet paths remain gated to loopback chain 31337. Robinhood Chain 4663 uses ETH as its gas token. Its documented public RPC is `https://rpc.mainnet.chain.robinhood.com/`. [Robinhood network and RPC documentation](https://docs.robinhood.com/chain/connecting/), [RMT core audit handoff](RMT_LAUNCH_RELEASE_CANDIDATE.md)

## Observed dependency identities

On November 13, 2026, the official RPC and Robinhood-listed Pinax archive RPC both returned chain ID `0x1237` and block `113418080` with hash `0x03bc9fc6685dd861f5004754ad82135707460f4bf3668c40454dcd0b0982d6e1` and timestamp `2026-11-13T14:18:09Z`. Runtime hashes below are Ethereum Keccak-256 of `eth_getCode` results. Both providers returned the same nine hashes at that block. Both reported block `113412054` (`0x17252a232b68a4e9fc494caf0660cff722ac2da966ee5c62b40e20dbcfd32ea2`) as `finalized` during the check. Pinax also reproduced the nine hashes at that finalized block (timestamp 2026-11-13T14:08:02Z) and at the November 12 observation `112799078`. The public endpoint returned historical-state-unavailable at both older anchors. The release operator must confirm canonicality, finality and provider behavior for the actual deployment anchor. [Official Uniswap 4663 addresses](https://developers.uniswap.org/docs/protocols/v4/deployments#robinhood-chain-4663), [Robinhood RPC providers](https://docs.robinhood.com/chain/connecting/), [Robinhood finality](https://docs.robinhood.com/chain/transaction-finality/)

| Contract | Published address | Runtime bytes | Observed runtime hash |
| --- | --- | ---: | --- |
| PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | 24009 | `0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626` |
| PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7` | 23877 | `0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2` |
| V4 Quoter | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` | 6118 | `0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6` |
| StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` | 3531 | `0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | 9152 | `0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca` |
| Universal Router 2.1.2 | `0x204FAca1764B154221e35c0d20aBb3c525710498` | 24380 | `0x76b92a5bba2dd32019a64eb421f1750e78c6ba044dbfa6840b722eb5ac63d296` |
| Unversioned Universal Router entry, historical fork pin | `0x8876789976decbfcbbbe364623c63652db8c0904` | 24546 | `0x2ce6aaaf9f4151f5e1cbf774668772f17f532ae11b15e9284fd0a072a8b0fbde` |
| PositionDescriptor proxy, auxiliary | `0x9639443158e8c5efa35bd45287bf2effd3d8dc06` | 752 | `0x09d3b199609b46e8921e47c5d0d98ae083e70d2d3b63a6099dc7e947b2f58b20` |
| ReservesLens, auxiliary | `0x0000001b173C3bbF3984D417d8614E3eed34865B` | 14142 | `0x157a3174cbad65b8ff57b8fbf94253b58be07398593d7d677e4fd6051e16ca91` |

- The November 12 read verified that PositionManager, Quoter, StateView and both router addresses return the published PoolManager from `poolManager()`. PositionManager returned the published Permit2 and PositionDescriptor from `permit2()` and `tokenDescriptor()`. Router 2.1.2's Permit2 getter probes reverted. On November 13, both RPCs returned its successful creation receipt and transaction `0xf669b9a4b8c322f5992788f737ee5fd2a1a73fd44f17546c5ac8b2211b6da339` in block `65727895` with block hash `0x34b52ae62932a3b93c9a1a053d30409909c805c98b730dae59279b39fd414001`. All ten constructor words match the official 2.1.2 Robinhood parameters and Blockscout's verified ABI. Sourcify reports a partial creation and runtime match. Its onchain runtime exactly matches the RPC bytecode, and all recorded immutable offsets for Permit2 (3), PoolManager (11) and PositionManager (2) contain the reviewed values. [Uniswap 2.1.2 release](https://github.com/Uniswap/universal-router/releases/tag/2.1.2), [official Robinhood constructor parameters](https://github.com/Uniswap/universal-router/blob/2.1.2/script/deployParameters/DeployRobinhood.s.sol), [Verified Blockscout constructor](https://robinhoodchain.blockscout.com/api/v2/smart-contracts/0x204FAca1764B154221e35c0d20aBb3c525710498), [Sourcify runtime and creation evidence](https://sourcify.dev/server/v2/contract/4663/0x204FAca1764B154221e35c0d20aBb3c525710498?fields=deployment,creationBytecode.transformationValues,runtimeBytecode.transformationValues)
- PositionDescriptor's EIP-1967 implementation slot returned `0xc1514adf9caed7ab2cf2dd7b3225761df61f03a8`, whose runtime hash is `0xbeab06ab5e9c62ebde72d025ee6dad81f3ce57348ab73cff399ef545398ad255`. The admin slot returned `0x525b4bd46d3a33f16ac815b4a303b3110fb9d10b` and the beacon slot was zero. Recheck these slots and the implementation when verifying metadata provenance. [EIP-1967 proxy slots](https://eips.ethereum.org/EIPS/eip-1967)
- The six hashes already in the repository's 4663 fixture agree at the new observation block. The fixture anchors a separate terminal fork at block `112197589`, hash `0xb69522b1ffeb5f44f221534f6f8eb07def30ea0225b984bb09caba3f85ec106e`. The published 2.1.2 address is prospective for a separately reviewed launch build. Uniswap's hosted Trading API lists 2.1.2 on 4663 and records the October 21, 2026 sunset of 2.0 and 2.1.1 support. This does not establish support for the eventual guarded pool. [Frozen deployment fixture](../packages/contracts/test/fixtures/rmt-v4-deployment-identities.json), [Uniswap API supported chains and versions](https://developers.uniswap.org/docs/trading/swapping-api/supported-chains)

Read-only reproduction with the pinned toolchain and an archive RPC:

```sh
archive_rpc=https://robinhood.rpc.pinax.network
block=113412054
router=0x204FAca1764B154221e35c0d20aBb3c525710498
cast chain-id --rpc-url "$archive_rpc"
cast block "$block" --rpc-url "$archive_rpc" --field hash
bytecode=$(cast code "$router" --block "$block" --rpc-url "$archive_rpc")
test -n "$bytecode" && test "$bytecode" != 0x
cast keccak "$bytecode"
cast call "$router" 'poolManager()(address)' --block "$block" --rpc-url "$archive_rpc"
cast block "$block" --rpc-url "$archive_rpc" --field hash
```

Repeat the code and hash check for each selected contract. Preserve chain ID, block number, block hash, timestamp, provider, runtime and binding observations with the reviewed dependency manifest.

## Offline review build

Use Node 22 and the pinned [v4 dependency installer](../packages/contracts/scripts/install-v4-deps.sh) with Foundry 1.7.1. Obtain the official native Solidity `0.8.26+commit.8a97fa7a` compiler for your platform. The script verifies the executable SHA-256 before running it and verifies every dependency source file against the review input manifest. The compiler receives complete standard JSON with imports disabled. The compile opens no network connection and emits only JSON hashes, sizes, ABI digests and runtime immutable references. [Official compiler builds](https://binaries.soliditylang.org/), [Source and dependency inputs](../packages/contracts/scripts/launch-4663-review-inputs.json)

```sh
cd packages/contracts
bash scripts/install-v4-deps.sh
node scripts/build-launch-4663-review.mjs --solc /absolute/path/to/solc-0.8.26 > /tmp/robinhood-4663-launch-review.json
```

An already prepared dependency directory can be selected with `--lib`. The [CI workflow](../.github/workflows/robinhood-4663-launch-review.yml) runs the compile twice and compares the complete JSON before uploading the manifest.

The two profiles share Solidity 0.8.26, Cancun EVM, 200 optimizer runs, via-IR and IPFS CBOR metadata. The 31337 profile recompiles the frozen source through the same standard JSON settings. Its hashes are comparison inputs for this compile and make no claim about historical Foundry metadata. The 4663 profile changes `RMTV4LaunchDeploymentV2`'s constructor chain check and `RMTV4LongevityLedger`'s shared chain constant. The latter controls V2 launch, fee collection and withdrawal. The V2 deployer's creation bytes change, and the V2 factory's creation and executable runtime change. The deployer runtime change is metadata only. The V1 factory, fixed-supply token and initialization guard remain byte-identical in this comparison. V1 remains bound to 31337. Growth Vault is outside the target compile.

Two Windows compiles returned identical manifests. The V2 templates had these SHA-256 values.

| Contract | 4663 creation bytes and SHA-256 | 4663 runtime template bytes and SHA-256 |
| --- | --- | --- |
| V2 deployment | 20,084, `47db9801cdd296c65e52e32288209e900834ae6821b7cd20d9f316a216ede5ef` | 234, `a409627aed782ce31045679ac53e2c27cc23d014c7e6fc1d924ce6e8b273472f` |
| V2 factory | 18,273, `b6d9f3aa2d366588953d008e3a04ab99cc72358005f515fe09264454c5099139` | 17,002, `3890c7d9c550ec9f3302b45c05c531d8399aea7b3048b11437117c83f7e6ef03` |

The manifest reports SHA-256 of compiled templates before constructor immutables are filled. The runtime hashes in the dependency table are Keccak-256 of deployed code. The two kinds of hashes serve different checks. The target templates still require reviewed immutable addresses, guard salt, expected deployer and factory addresses and a separate deployment procedure. Audit and validate the exact approved 4663 build on an isolated fork before considering production.

## Release evidence still required

- [ ] **Authorize the exact target-chain build and audit.** Approve chain 4663 and the proposed economics. Use the isolated compile manifest to review the chain-specific source delta, compiler, dependencies and creation and runtime template hashes. Approve the actual constructor inputs and immutable bindings separately. Review `RMTV4LaunchDeploymentV2`, `RMTV4InitializationGuard`, `RMTV4LaunchFactoryV2` and `RMTV4LongevityLedger` together. Review deployer nonce, expected factory, CREATE2 salt, guard address and `BEFORE_INITIALIZE` flag. Match the authorized deployment receipt, canonical block, runtime hashes and reciprocal guard/factory/PoolManager bindings before activation. [Frozen audit checklist](RMT_LAUNCH_RELEASE_CANDIDATE.md#provenance-and-production-build-delta), [Uniswap hook permissions](https://developers.uniswap.org/docs/protocols/v4/concepts/hooks)
- [ ] **Bind the complete pool identity.** Carry chain ID, PoolManager, factory and `PoolKey(currency0,currency1,uint24 fee,int24 tickSpacing,address hooks)` from `LaunchCreated` and the manager's initialization and funding logs through quotes, approvals, swaps, recovery and every REST/MCP read. Require `PoolId = keccak256(abi.encode(PoolKey))`, ordered currency addresses, zero address for native ETH where applicable, the exact hook and the recorded fee and spacing. Reconcile the PositionManager NFT owner, custody, tick range and actual liquidity. Confirm protocol fee state for the exact pool. [Pool key and identifier](https://developers.uniswap.org/docs/ecosystem/subgraphs/concepts/v4/entities), [RMT launch record](../apps/web/lib/launchpad/launch-record.ts)
- [ ] **Prove quote, wallet and settlement binding.** Use the approved Quoter and router version for the exact key. Review both swap directions, positive per-hop price floor, minimum output, deadline, exact input settlement, account, recipient and spender. Verify transaction and receipt chain, block number and hash. Require transaction-level native call traces for the sell recipient and fail closed on missing or ambiguous evidence. The official public RPC returned method-unavailable error `-32601` for `debug_traceTransaction`. On November 13, Pinax returned a `CREATE` trace for the already deployed Router 2.1.2 transaction above. That confirms one historical method observation. Exact native sell settlement for the future guarded pool still needs dedicated evidence. Approve and test trace retention, canonicality, limits and failure behavior. [RMT direct-v4 settlement](../apps/web/lib/launchpad/direct-v4.ts), [Uniswap Trading API integration](https://developers.uniswap.org/docs/trading/overview)
- [ ] **Establish durable indexing and recovery.** Verify an approved archive RPC can backfill bounded log ranges, read historical state and fetch receipts at the deployment anchor. Start at the reviewed factory deployment block. Record sequencer observation separately from L1 inclusion and finality. Use the reviewed L2 checkpoint and L1 finality anchor instead of inferring finality from a fixed number of fast L2 blocks. Persist canonical checkpoints and idempotent receipt/event records with chain, manager, factory, block hash, transaction hash and log index. Exercise restart, replay, reorg rollback, rate limits, backups and recovery before serving finalized records. The official public RPC returned historical-state-unavailable errors for older anchors including `112799078` and the existing terminal fork anchor. Approve production storage, finality policy, service quotas and recovery separately. [Robinhood archive endpoint guidance](https://docs.robinhood.com/chain/connecting/), [RMT indexer](../apps/web/scripts/new-launchpad-indexer.ts)
- [ ] **Observe hosted support for the exact authorized pool.** After separate deployment authorization, query the hosted pool data with the chain and exact v4 PoolId. Compare currency addresses, fee, spacing and hook, then record timestamp and source. Verify each hosted quote or calldata selects the same guarded pool and reviewed router. Hosted indexing and routing for a future pool remain unknown until observed. [Uniswap pool lookup](https://developers.uniswap.org/docs/api-reference/pool_info), [Uniswap API version and chain support](https://developers.uniswap.org/docs/trading/swapping-api/supported-chains)

Owner approval is required for the target-chain build, review, deployment provenance, archive and trace operations, and release. Growth Vault remains fixture-only under its separate release decision. [Core and Growth release checklist](RMT_LAUNCH_RELEASE_CANDIDATE.md#release-checklist)
