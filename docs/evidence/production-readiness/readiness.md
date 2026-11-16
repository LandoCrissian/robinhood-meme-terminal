# Production acceptance and deployment checklist

**BLOCKED_NO_BROADCAST.** The fixed-supply Factory V2 and Registry V3 contract candidate still matches #633 at `7733ed293ebcb16699ef22412298fbe40bb52725`. The first RMT project remains a fixture. Earlier V4 and V6 token addresses have separate identities.

## Run the checks

Use Node 22 and the pinned pnpm 10.12.1 install. The tests and archived fixture command work offline. The live command uses fixed public endpoints, bounded JSON responses and immediate reporting of missing or conflicting evidence. It requires no private credentials. [Timestamped observations](acceptance-observations.json.gz) · [Independent review packet](independent-review.md)

~~~sh
pnpm install --frozen-lockfile
pnpm test:production-readiness
pnpm probe:production-readiness --fixture
pnpm probe:production-readiness --live --output production-readiness.json
~~~

The pull request CI runs deterministic tests and the archived fixture. The manual [public observation workflow](../../../.github/workflows/production-readiness.yml) can capture the live report when the workflow is available on the default branch. Its artifact has the same schema as the local live output.

| Boundary | Evidence and remaining work |
| --- | --- |
| Historical discovery and authorization | The Netlify listing contains two V4 archived receipts and two indexed V6 receipts. The probe corroborates each registration and the past and current checkpoint headers across independent Robinhood providers. It checks the exact-address route, invalid or absent bearer denial at Railway, and disabled execution and fixture routes. A successful V6 read through Netlify is observed. A successful direct authenticated Railway read remains unverified. |
| Reorg, recovery and new-engine ingestion | The 31337 browser and PostgreSQL lifecycle exercises restart, duplicate rejection, delayed or missing receipts and reorg rollback. The production probe reads both checkpoint anchors and exact receipts. Production outage, restart and rollback remain unverified. A deployed factory/registry binding and authorized new-engine worker/read integration are prerequisites for hosted ingestion verification. |
| Archive and native traces | The official RPC's unavailable historical code/trace responses were followed by matching bounded Pocket and Pinax observations. The historical callTracer sample binds the receipt, block, sender, factory, calldata hash and value. Automation still needs operational coverage, archive retention and failover under sustained load before launch. [Robinhood providers](https://docs.robinhood.com/chain/connecting/) |
| Ethereum L1 finality | The probe joins the L2 NodeInterface batch mapping to a successful receipt and matching canonical SequencerInbox log on two Ethereum providers, then checks a corroborated Ethereum finalized height. The older sample proved finalized L1 posting. This trust model relies on L2 RPC for batch membership. Continuous finality for actual new-engine receipts remains unverified. [Robinhood finality](https://docs.robinhood.com/chain/transaction-finality/) · [Sequencer Inbox](https://docs.robinhood.com/chain/protocol-contracts/) |
| Exact v4 route | Live reads match all six dependencies, including Universal Router 2.1.2. The archive binds both swap receipts to the full guarded PoolKey, PoolId, trace settlement, positive liquidity and position custody. For production acceptance derive the key from the verified deployed token and engine, verify canonical funding and custody, check StateView and both Quoter directions, and observe a supported hosted route for that exact hook. [Official Uniswap deployment pins](https://developers.uniswap.org/docs/protocols/v4/deployments#robinhood-chain-4663) |

## Observed on 16 November 2026, 15:22–15:23 UTC

The live historical checkpoint was **115,862,833** at **15:22:40 UTC**. All three providers corroborated it and the four registration receipts. Railway's read-only control plane showed the V6 worker and original PostgreSQL each online with one replica and no recent failures. The worker's active deployment was `77fc2159-a433-4177-9912-2c8534c26739`. Its public readiness and health checks returned 200. [Railway project](https://railway.com/project/19587a6e-6f02-4cfa-b7db-f308934f697b) · [Netlify historical feed](https://www.rmtlaunch.fun/api/launchpad/launches)

The official RPC returned `-32000` for all six runtime pins at archive block **114,549,452** and `-32601` for the sample trace. Pocket served both requests and Pinax corroborated them. Ethereum PublicNode and Flashbots agreed that historical batch **396507** posted at block **26,428,122**, at or below their common finalized height of **26,428,377**. Only Pocket mapped the newly sampled hosted checkpoint to a batch. Its L1 finality stays unverified.

## Safe and execution inputs

Both proposals use the same three existing Rabby owners and **2-of-3** threshold on Robinhood Chain 4663. The pinned SafeL2 1.4.1 singleton is `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762`, the factory is `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`, and the initializer Keccak-256 is `0x151a0612bf013560eaf16129615ae6262a6889db13410623ddcb49f2a8506ac2`. Exact initializer bytes and unsigned `createProxyWithNonce` calldata are included in the observed output. The setup fixes the pinned fallback handler, no setup delegatecall, no payment, no modules or guard. [Binding policy and full owner addresses](../rmt-task045/operations-safe-policy.json) · [Safe factory reference](https://docs.safe.global/reference-smart-account/deployment/SafeProxyFactory)

| Role | Predicted address | Proposed salt nonce |
| --- | --- | --- |
| Operations | `0xAF9F10258b091719618c19D057F9cDAB72eFFd8b` | `0x8094029c8a767b073fdbe606186b138b416682f2584ca87d38b3eaaa7af16cc2` |
| Reserve | `0x8D44078642ce938Fd799b23087BcdD6114A302e5` | `0xe0e8b0060b79275b10d83a2573dfc2e48e749a76e0a2efea0ffe422a30b89a87` |

RMT-GOV-01 `0xC447A378cFd8460Febc2eef67501D7a5473B9001` is the proposed gas payer for estimation. The RPC simulates each exact request and confirms the predicted address, then checks `eth_estimateGas` and Nitro's L2 execution and L1 poster estimates. Refresh at the authorized transaction review. This payer is separate from the unassigned protocol deployment account. [Nitro estimate components](https://docs.arbitrum.io/arbitrum-essentials/how-to-estimate-gas)

The dated Safe estimate used block **115,863,151** at **15:23:12 UTC**. Both proposals were vacant, and the exact unsigned simulations returned their predicted addresses. Each estimate was **313,391 gas** and **0.000006444572524 ETH**, or **0.000012889145048 ETH** combined at **20,564,000 wei/gas**. Nitro reported zero additional L1 poster gas for this observation. The quote excludes future claims and Factory V2 deployment and must be refreshed.

After separately approved creation, use `pnpm probe:production-readiness --safe-receipt HASH --safe-role RMT-OPERATIONS --approved-payer ADDRESS` for the matching role. It binds the successful direct transaction and exact Safe factory event to two canonical L2 reads, verifies the proxy and pinned runtime identities, and checks Safe owners, threshold, nonce, modules, guard and fallback at the receipt block. Record L1 finality and an independently accepted claim before binding a beneficiary. The verifier keeps beneficiary fields empty.

| Release decision | State |
| --- | --- |
| Independent security disposition | The exact report still fails on 18 engine plus four dependency highs. Review all seven governance mediums and remaining assumptions. [Review scope and reproduction](independent-review.md) |
| Treasury setup approval | Both proposed addresses remain unassigned live beneficiaries. Separately approve the two existing salt choices and gas payer, then verify their exact receipts, independent custody and claims. |
| Deployment input approval | Dedicated deployer EOA and confirmed/pending nonce, Operations and Reserve verified addresses, first RMT creator and project metadata/treasury fields, governance continuity and incident roles remain unbound. Confirm the existing three owners. The provisional review terms are 0.0004 ETH creation, 2 ETH graduation, 1 billion with 18 decimals, 600M/400M, 1% curve fee, and 90/5/5. [Unsigned bundle and unset production fields](../fixed-supply-release/unsigned-bundle.json) |
| Activation approvals | Keep deployment, first funded acceptance and public execution as separate approvals. Hosted new-engine routing, durable authenticated recovery, receipt-level finality and physical-wallet recovery remain outstanding. |
