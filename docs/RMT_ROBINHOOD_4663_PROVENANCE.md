# Robinhood Chain 4663 deployment provenance

Read-only review input for frozen launch source `69cfaa392e488f475b8b1e15a34c0ac986abd24e`. RMT Launch remains gated to loopback chain 31337. Robinhood Chain 4663 uses ETH as its gas token. Its documented public RPC is `https://rpc.mainnet.chain.robinhood.com/`. [Robinhood network and RPC documentation](https://docs.robinhood.com/chain/connecting/), [RMT core audit handoff](RMT_LAUNCH_RELEASE_CANDIDATE.md)

## Observed dependency identities

On November 12, 2026, the official RPC returned chain ID `0x1237` and block `112799078` (`0x6b92d66`) with hash `0x8173eff0ae01b292656848b50e5ffd29b50864fc5b97eac4031c8f1647f1ace5` and timestamp `2026-11-12T20:13:38Z`. All hashes below are Ethereum Keccak-256 of runtime bytes from `eth_getCode` at that block. The block hash was unchanged on immediate reread. The Robinhood-listed Pinax archive endpoint returned the same chain ID, block hash and nine runtime hashes. This was a recent-head observation. A release manifest must establish canonicality and finality for its chosen review anchor. [Official Uniswap 4663 addresses](https://developers.uniswap.org/docs/protocols/v4/deployments#robinhood-chain-4663), [Robinhood-listed providers](https://docs.robinhood.com/chain/connecting/)

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

- PositionManager, Quoter, StateView and both router addresses returned the published PoolManager from `poolManager()`. PositionManager returned the published Permit2 and PositionDescriptor from `permit2()` and `tokenDescriptor()`. The 2.1.2 Router's `permit2()` and `PERMIT2()` probes reverted. Before approval, decode its immutable Permit2 binding from verified source, build and constructor evidence. [Universal Router 2.1.2 source](https://github.com/Uniswap/universal-router/tree/2.1.2)
- PositionDescriptor's EIP-1967 implementation slot returned `0xc1514adf9caed7ab2cf2dd7b3225761df61f03a8`, whose runtime hash is `0xbeab06ab5e9c62ebde72d025ee6dad81f3ce57348ab73cff399ef545398ad255`. The admin slot returned `0x525b4bd46d3a33f16ac815b4a303b3110fb9d10b` and the beacon slot was zero. Recheck these slots and the implementation when verifying metadata provenance. [EIP-1967 proxy slots](https://eips.ethereum.org/EIPS/eip-1967)
- The six hashes already in the repository's 4663 fixture agree at the new observation block. The fixture anchors a separate terminal fork at block `112197589`, hash `0xb69522b1ffeb5f44f221534f6f8eb07def30ea0225b984bb09caba3f85ec106e`. The published 2.1.2 address is prospective for a separately reviewed launch build. The hosted Trading API lists 2.1.2 on 4663 and rejects requests for 2.0 on that chain. [Frozen deployment fixture](../packages/contracts/test/fixtures/rmt-v4-deployment-identities.json), [Uniswap API supported chains and versions](https://developers.uniswap.org/docs/trading/swapping-api/supported-chains)

Read-only reproduction with the pinned toolchain and an archive RPC:

```sh
archive_rpc=https://robinhood.rpc.pinax.network
block=112799078
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

## Release evidence still required

- [ ] **Authorize the exact target-chain build and audit.** Approve chain 4663 and the proposed economics. Pin the source commit, dependencies, compiler, creation/runtime hashes, constructor arguments and immutable bindings for that build. Review `RMTV4LaunchDeploymentV2`, `RMTV4InitializationGuard`, `RMTV4LaunchFactoryV2` and `RMTV4LongevityLedger` together. Review deployer nonce, expected factory, CREATE2 salt, guard address and `BEFORE_INITIALIZE` flag. Match the authorized deployment receipt, canonical block, runtime hashes and reciprocal guard/factory/PoolManager bindings before activation. [Frozen audit checklist](RMT_LAUNCH_RELEASE_CANDIDATE.md#provenance-and-production-build-delta), [Uniswap hook permissions](https://developers.uniswap.org/docs/protocols/v4/concepts/hooks)
- [ ] **Bind the complete pool identity.** Carry chain ID, PoolManager, factory and `PoolKey(currency0,currency1,uint24 fee,int24 tickSpacing,address hooks)` from `LaunchCreated` and the manager's initialization and funding logs through quotes, approvals, swaps, recovery and every REST/MCP read. Require `PoolId = keccak256(abi.encode(PoolKey))`, ordered currency addresses, zero address for native ETH where applicable, the exact hook and the recorded fee and spacing. Reconcile the PositionManager NFT owner, custody, tick range and actual liquidity. Confirm protocol fee state for the exact pool. [Pool key and identifier](https://developers.uniswap.org/docs/ecosystem/subgraphs/concepts/v4/entities), [RMT launch record](../apps/web/lib/launchpad/launch-record.ts)
- [ ] **Prove quote, wallet and settlement binding.** Use the approved Quoter and router version for the exact key. Review both swap directions, positive per-hop price floor, minimum output, deadline, exact input settlement, account, recipient and spender. Verify transaction and receipt chain, block number and hash. Require transaction-level native call traces for the sell recipient and fail closed on missing or ambiguous evidence. The official public RPC returned method-unavailable error `-32601` for `debug_traceTransaction`. Pinax returned a nested `callTracer` result for the already archived CannaCat sale `0x3c5b142f2fcf2bad01a154b1b84754bd4e4c32281aa14c06641fa70f2221a522`. This is one method observation. Approve and test trace retention, canonicality, limits and failure behavior. [RMT direct-v4 settlement](../apps/web/lib/launchpad/direct-v4.ts), [Uniswap Trading API integration](https://developers.uniswap.org/docs/trading/overview)
- [ ] **Establish durable indexing and recovery.** Verify an approved archive RPC can backfill bounded log ranges, read historical state and fetch receipts at the deployment anchor. Start at the reviewed factory deployment block. Persist canonical checkpoints and idempotent receipt/event records with chain, manager, factory, block hash, transaction hash and log index. Exercise restart, replay, reorg rollback, rate limits, backups and recovery before serving finalized records. The official public RPC returned historical-state-unavailable errors for both a finalized historical block and the existing terminal fork anchor. Approve production storage, finality policy, service quotas and recovery separately. [Robinhood archive endpoint guidance](https://docs.robinhood.com/chain/connecting/), [RMT indexer](../apps/web/scripts/new-launchpad-indexer.ts)
- [ ] **Observe hosted support for the exact authorized pool.** After separate deployment authorization, query the hosted pool data with the chain and exact v4 PoolId. Compare currency addresses, fee, spacing and hook, then record timestamp and source. Verify each hosted quote or calldata selects the same guarded pool and reviewed router. Hosted indexing and routing for a future pool remain unknown until observed. [Uniswap pool lookup](https://developers.uniswap.org/docs/api-reference/pool_info), [Uniswap API version and chain support](https://developers.uniswap.org/docs/trading/swapping-api/supported-chains)

Owner approval is required for the target-chain build, review, deployment provenance, archive and trace operations, and release. Growth Vault remains fixture-only under its separate release decision. [Core and Growth release checklist](RMT_LAUNCH_RELEASE_CANDIDATE.md#release-checklist)
