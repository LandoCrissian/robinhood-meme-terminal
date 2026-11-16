# Robinhood Chain production readiness

**BLOCKED_NO_BROADCAST.** This records public RPC and HTTP reads on 2026-11-16 UTC. The release review distinguishes live dependency infrastructure, the historical V6 feed, and the new fixed-supply engine.

## 4663 provider evidence

At **07:08:26.906 UTC**, the Robinhood official RPC, Pocket and Pinax returned chain `4663`, the same block **115,581,131** (`0xc153b46a24a8d8e5759c0f3fcd3ca2753fdf63d145e3c1ab02cb7a7e675af17f`), and all six runtime hashes in the checked-in probe. PositionManager, Quoter, StateView and Universal Router returned the expected PoolManager. PositionManager returned Permit2. The router matched the pinned PoolManager, PositionManager and Permit2 immutable byte offsets and its official creation receipt. The common block timestamp was **07:08:26.000 UTC**. The probe rechecked its hash after state reads. [Robinhood connection documentation](https://docs.robinhood.com/chain/connecting/) · [Uniswap v4 official addresses](https://developers.uniswap.org/docs/protocols/v4/deployments#robinhood-chain-4663) · [Router 2.1.2 official receipt reference](https://github.com/Uniswap/contracts/blob/main/deployments/4663.md#universal-router-v212).

| Probe | Official | Pocket | Pinax |
| --- | --- | --- | --- |
| Six current-block code pins and dependency bindings | Matched | Matched | Matched |
| Historical fork header at 113,412,054 and lookup by hash | Matched | Matched | Matched |
| All six dependency runtime hashes at the historical fork block | Unavailable, RPC `-32000` | Matched | Matched |
| Recorded V6 creation receipt and bounded matching log | Matched | Matched | Matched |
| One historical V6 transaction `debug_traceTransaction` with `callTracer` | Method unavailable, RPC `-32601` | Call root matched factory | Call root matched factory |

The archived fork block hash was `0x17252a232b68a4e9fc494caf0660cff722ac2da966ee5c62b40e20dbcfd32ea2`. All three reported L2 `safe` at 115,575,857 and `finalized` at 115,572,687. **Independent Ethereum L1 finality is UNVERIFIED.** The L2 tags and cross-provider agreement do not establish L1 inclusion and a finalized Ethereum anchor. The old loopback fixture factory address had empty code. The current probe observed Arbitrum maximum transaction gas of 32,000,000. A production deployer, final constructor inputs and exact transaction gas acceptance remain unverified. A successful trace on one old transaction establishes neither trace retention nor reliable independent native settlement at production load. Keep a bounded archive/trace fallback, validate receipt and trace provenance and fail closed on missing or disagreeing evidence. [Existing read-only probe](../rmt-task039/probe-robinhood-4663.mjs).

## Public website, indexing and routing

At **07:08:21.165 UTC**, production Netlify returned 200 on the homepage, creation information, historical RMT page and exact historical token page. The historical API returned four records with `coverage=v6-indexed`, `status=ready`, `future=prelaunch` and `finality=l1-unverified`. The checkpoint was **115,581,038**, hash `0xa684b0f35b9107cf22f3f1fd4d8c0aca517770afcd293d938f9ecf49ffead942`, indexed observation **07:08:19.578 UTC**. All three RPCs independently returned that same block hash at **07:13:32 UTC**. The exact-address API returned one record classified `retired`, and a missing address returned 404. The public execution config explicitly reported disabled. GET requests to the new-engine list, exact-address API and both private fixture endpoints returned 404. This checks the production HTTP surface once. Persistent new-engine ingestion, recovery, provider failover and authenticated worker behavior require their own operating evidence. [Live discovery API](https://www.rmtlaunch.fun/api/launchpad/launches) · [Public execution config](https://www.rmtlaunch.fun/api/launchpad/config).

Hosted **new-engine indexing and exact PoolKey routing are UNVERIFIED**. Uniswap documents chain 4663 and Router 2.1.2. The pinned official dependencies were observed above. External quotes and indexing need the actual deployed new token and guard, native/token currencies, pool fee, tick spacing, PoolManager and derived PoolId. A historical token address, official router deployment or synthetic fork quote cannot establish the hosted service's coverage for that pool. Leave the historical V6 feed in place and enable new-engine data only after verifying the reviewed factory and registry identities, bounded traces, replay, reorg handling and operating policy. [Uniswap chain and router support](https://developers.uniswap.org/docs/trading/swapping-api/supported-chains).

## Safe readiness and beneficiary status

At **07:12:46.628 UTC**, official, Pocket and Pinax all confirmed the same chain and block **115,581,131** before and after reads. The SafeL2 `VERSION()` returned **1.4.1** and ProxyFactory `proxyCreationCode()` gave Keccak-256 `0x1856e0ee08399d74e0ea0b03adca210aeade6f748969ac023cdcb4dd62dcaf5f`.

| Existing Safe component | Address | Observed runtime Keccak-256 |
| --- | --- | --- |
| SafeL2 singleton | `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` | `0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff` |
| SafeProxyFactory | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` | `0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317` |
| CompatibilityFallbackHandler | `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99` | `0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9` |

All three RPCs reported code `0x`, nonce 0 and 0 wei at both proposed CREATE2 addresses. The proposals are `0xAF9F10258b091719618c19D057F9cDAB72eFFd8b` for Operations and `0x8D44078642ce938Fd799b23087BcdD6114A302e5` for Reserve. The separate beneficiaries, final salts and release bindings remain unapproved. Live owner set, threshold, singleton, fallback handler, guard/modules and claim acceptance are **UNVERIFIED**. The Safe configuration API returned HTTP 200 with chain ID 4663 at 07:13:32 UTC. The Safe client gateway probe returned HTTP 403. This confirms a chain configuration entry and leaves live wallet and transaction-service acceptance open. The 2-of-3 multisig claims in the earlier fork are isolated proof. Directory V2's eligible EOA signers and Safe beneficiary owners operate at separate authorization boundaries. [Safe supported networks](https://docs.safe.global/advanced/smart-account-supported-networks) · [Safe chain configuration](https://safe-config.safe.global/api/v1/chains/4663/) · [Proposed separate initializers](../rmt-task046/treasury-safe-initializers.json) · [Prior synthetic Safe claims](../rmt-task046/4663-shared-owner-safe-rehearsal.json) · [Unassigned release bindings](../rmt-task047/treasury-live-bindings.json).

## Reproduce

Run `node docs/evidence/rmt-task039/probe-robinhood-4663.mjs 115581131` using the repository dependencies. Historical-state retention may alter which sources can replay the fixed block. For the Safe checks, pin a common block on the same three sources, use `eth_getCode` and Keccak-256 for the three listed runtimes, `eth_getCode`, `eth_getTransactionCount` and `eth_getBalance` for each proposed address, and `eth_call` with `0xffa1ad74` and `0x53e5d935` for the version and proxy creation code respectively. Recheck the block hash at the end. For hosted verification, use GET requests and compare the historical API checkpoint to an independent chain read. Report observation timestamps and unavailable results without converting them to a confirmed status.
