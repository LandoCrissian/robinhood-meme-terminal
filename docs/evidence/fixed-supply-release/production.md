# 4663 production readiness evidence

**BLOCKED_NO_BROADCAST.** These are public read-only observations from 2026-11-16 UTC for the #631 base at `58638966db82cffe89db6df4e918f73eced8ad2b`. Isolated Anvil evidence and hosted V6 history have separate provenance. [Previous production observations](../fixed-supply-security/production.md).

## Official runtimes, archive and traces

Robinhood's official RPC, Pocket and Pinax agreed on chain **4663** and common block **115,833,472** at 14:32:47 UTC, hash `0x6544fc218b8187728a442a08707ea3dc6c09f4feef92f9ec21062b39c2d1d689`. All six runtime pins matched on each source. PositionManager, Quoter, StateView and Universal Router 2.1.2 returned the pinned PoolManager. PositionManager returned the pinned Permit2. The router's runtime immutables and canonical creation receipt matched. The read-only quote/routing dependencies are live. [Robinhood providers](https://docs.robinhood.com/chain/connecting/) · [Official Uniswap v4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments#robinhood-chain-4663) · [Pinned read-only probe](../rmt-task039/probe-robinhood-4663.mjs).

| Read | Robinhood | Pocket | Pinax |
| --- | --- | --- | --- |
| All six runtimes at common current block | Matched | Matched | Matched |
| #631 fork header 114,549,452 at 14:36:14.945 UTC | Matched | Matched | Matched |
| All six runtimes at #631 fork block | Unavailable, `-32000` | Matched | Matched |
| Bounded historical V6 receipt and registration log | Matched | Matched | Matched |
| Historical V6 `callTracer` root | Unavailable, `-32601` | Factory matched | Factory matched |

The #631 fork anchor hash is `0xf9a8ca5d8e26ebb426ebd2e663ad82afc878c16d8bba5f5542f6341890cf7710`. The older probe anchor 113,412,054 gave the same historical-state result. All three reported an Arbitrum maximum transaction gas of 32,000,000. Verified archive state and a single matching trace demonstrate bounded read capability. Production retention, trace shape under failure, provider capacity and automatic failover remain **UNVERIFIED** for the new engine. [#631 fork evidence](../fixed-supply-security/release-manifest.json).

## Ethereum L1 finality

L2 RPC finality tags agreed on **115,822,919**, hash `0xb495cfc7f8ea324d9bd7edc88c985ea7c8fc280fbd07481f141b0e9dca2d5650`. Pocket's `safe` tag was ahead of the others in the sampled calls. At 14:34:03 UTC all three L2 Nitro NodeInterfaces mapped 115,822,919 to batch **396507**. Separately, Ethereum PublicNode and Flashbots matched the successful `SequencerBatchDelivered` log/receipt for that exact batch at Robinhood's official L1 Sequencer Inbox, block **26,428,122**. Both independently returned finalized Ethereum block **26,428,154** with the same hash. This independently corroborates finalized L1 posting for one prior L2 batch, with L2-to-batch membership reported by the L2 NodeInterfaces. [Robinhood L1 contracts](https://docs.robinhood.com/chain/protocol-contracts/) · [Nitro NodeInterface](https://docs.arbitrum.io/arbitrum-essentials/nodeinterface/reference) · [Exact L1 and L2 sample](l1-batches.json).

For the 14:32 hosted checkpoint, Pocket returned batch **396557** and the other two NodeInterface reads were unavailable. Its matching L1 Inbox event was confirmed by PublicNode and Flashbots at block **26,428,218**, above the observed finalized Ethereum head. The later hosted checkpoint remains `l1-unverified`. Continuous production L1 verification for new-engine receipts is **UNVERIFIED**. No blob replay or independent reconstruction of L2 blocks from Ethereum data was performed. A release-time finality gate still needs a defined trust model, bounded retry, and canonical L1 receipt/block reconciliation. [Robinhood transaction finality](https://docs.robinhood.com/chain/transaction-finality/).

## Hosted discovery and exact PoolKey

At 14:32:47 UTC the Netlify homepage, creation information and historical token pages returned 200. The public API returned **four** records with `coverage=v6-indexed` at checkpoint **115,833,396** and the exact-address request returned one record. The missing-address request returned 404. At 14:35:50 UTC the API had advanced to **115,835,122**, hash `0x192b3c414357e1767e7b87ec1ac0843e1954458885281d20d8359164b4f16aa6` and indexed observation 14:35:48.799 UTC. All three chain sources matched both checkpoint hashes. Execution configuration reported `disabled`. The public new-engine list, exact lookup and both private fixture paths returned 404. [Live historical feed](https://www.rmtlaunch.fun/api/launchpad/launches) · [Execution configuration](https://www.rmtlaunch.fun/api/launchpad/config).

Railway's authenticated read-only status for the `robust-ambition` production environment showed one running replica for each of the V6 worker and original Postgres service, zero recent failures in the default eight-hour window and the original `postgres-volume` attached. The active worker deployment was `77fc2159-a433-4177-9912-2c8534c26739`. An environment deployment operation was still applying at inspection. [Railway project](https://railway.com/project/19587a6e-6f02-4cfa-b7db-f308934f697b).

The read-only public observations verify V6 feed progress. Production Railway recovery, replay and authenticated new-engine ingestion were **UNVERIFIED** and no outage or restart was induced. Hosted new-engine indexing and real new-engine exact-PoolKey routing are **UNVERIFIED**. The full key requires the actual launch token, native currency, fee, spacing and deployed guard at the pinned PoolManager. The corresponding PoolId and external route can be verified after an authorized deployment. Official Router 2.1.2 support for 4663 and the synthetic fork route establish separate facts. [Uniswap routing support](https://developers.uniswap.org/docs/trading/swapping-api/supported-chains) · [Indexer run boundaries](../../../apps/indexer/README.md).

## Safe runtime and live beneficiary vacancy

At 14:34:03.054 UTC, the same three 4663 providers matched SafeL2 1.4.1, SafeProxyFactory and CompatibilityFallbackHandler bytecode hashes at block **115,833,472**. Each returned `VERSION() = 1.4.1` and `proxyCreationCode()` Keccak-256 `0x1856e0ee08399d74e0ea0b03adca210aeade6f748969ac023cdcb4dd62dcaf5f`. All three returned empty code, nonce 0 and zero balance for each counterfactual address. [Pinned Safe contracts and initializers](../rmt-task046/treasury-safe-initializers.json).

| Proposed role | Address | Release status |
| --- | --- | --- |
| RMT Operations | `0xAF9F10258b091719618c19D057F9cDAB72eFFd8b` | Vacant at observation. Unassigned live beneficiary. |
| RMT Reserve | `0x8D44078642ce938Fd799b23087BcdD6114A302e5` | Vacant at observation. Unassigned live beneficiary. |

Safe's public configuration returned HTTP 200 with chain ID 4663 and the client gateway probe returned HTTP 403. Live Safe wallet and hosted transaction-service operation, the deployed beneficiary addresses, exact owners, threshold, modules/guard and successful live claims are **UNVERIFIED**. The prior 2-of-3 Safe claims were exercised on isolated forks. Directory V2's three proposed governance EOAs are a separate signer boundary. [Safe chain configuration](https://safe-config.safe.global/api/v1/chains/4663/) · [Prior Safe fork](../rmt-task046/4663-shared-owner-safe-rehearsal.json) · [Unset live bindings](../rmt-task047/treasury-live-bindings.json).
