# RMT infrastructure efficiency and Alchemy preflight

Date: 2026-09-30. Authorized and inspected main: `41cbc27029dfffad07ee71e97c3052d9d5d0cabb`. Scope: read-only infrastructure/source audit, safe repository deployment scopes, tests and documentation. **No production mutation, infrastructure provisioning, RPC switch or financial action.** PR553 remains separate and untouched.

The [master authority map](RMT_SERVICE_AUTHORITY_MAP_2026_09_30.md) is the responsibility contract. All capability and price observations are dated, not permanent promises. Source defaults below are distinguished from inaccessible production variable values. All call estimates exclude retries unless stated and are estimates, not telemetry or invoices.

## Evidence and access boundaries

| Evidence | What was actually inspected | What it cannot establish |
| --- | --- | --- |
| SOURCE | Actual Viem/helper calls, config, worker loops, readers, route consumers and manifests at authorized main | Actual traffic or secret-bearing production URL values |
| READ_ONLY_RAILWAY | Project `robust-ambition`, production config/source/deployment metadata and variable names; [sanitized scope snapshot](evidence/2026-09-30/railway-live-scope.json) | Secret values and configured interval overrides; deployment SUCCESS is not complete backfill |
| READ_ONLY_VERCEL | Existing RMT project production env metadata: RPC variables PRESENT where listed, values inaccessible; no identity/browser RPC override names present | Hidden endpoint contents/credentials, billing invoices or provider account entitlements |
| READ_ONLY_PUBLIC_RPC | 21 HTTP requests / 22 logical JSON-RPC calls, fixed contract/block evidence; [results](evidence/2026-09-30/public-rpc-probe.json) | Railway's private endpoint, Alchemy performance, production browser timings or quote/settlement acceptance |
| PUBLISHED_OFFICIAL_DOCS | Current chain-specific Alchemy table, Robinhood/Nitro docs and provider pricing/API docs | Successful calls with the owner's particular credential, plan or region |
| CONTROLLED_TEST | 29 source-scope tests, invoked by the existing indexer CI job | Deployed Railway adoption of new patterns |

Main indexer deployment `b968752a-93ff-4292-81e1-7adfcee975d4` and market indexer `b5519e05-2e62-42d7-8153-3e614625a68e` report SUCCESS at authorized main. Ownership indexer `e250dc6b-8010-4857-a4ca-f340d543f58d` reports SUCCESS at `d0b3237db2c0716e9d8fc1802b755967801fe2ce`. Marketplace service has no returned deployment and lacks the OpenSea key variable. These are observations, not authorization to redeploy/activate anything.

No owner Alchemy Robinhood Mainnet credential was accessible through the current authorized environment. Local current-task configuration contained none; Vercel secret values were not returned, and Railway OAuth returns redacted values. This does **not** assert that no Alchemy URL is configured anywhere. Live Alchemy equivalence, account quotas and archive depth remain NOT_TESTED. No demo key, borrowed account or guessed credential was used.

## 1. Runtime RPC consumers

`getBytecode` maps to `eth_getCode`; `readContract`/`multicall` map to `eth_call`, not HTTP JSON-RPC batching. `getTransaction`/`getTransactionReceipt` map to the corresponding by-hash/receipt methods. The [call-site inventory](evidence/2026-09-30/rpc-source-calls.json) records source locations, including dormant branches and generic `.call` false positives; the tables below interpret the active paths. It is not a claim that every matching helper is a runtime RPC request.

### Persistent services

| Service and source | RPC variable / transport | Actual methods | Cadence, batching, finality and archive | Nature / event fit |
| --- | --- | --- | --- | --- |
| Main V6 indexer: `apps/indexer/src/index.ts`, `rpc-config.ts` | `RMT_RPC_URL`; `RMT_ARCHIVE_RPC_URL` secondary client for source history, falling back to primary; HTTP 12s, 3 retries/1s delay | blockNumber, blockByNumber, getCode, getLogs, eth_call | Default 10s after work; 2,000-block ranges; address sets ≤100 per log call; no explicit HTTP batching. Default 20-block lag; persistent checkpoints/rollback. **Historical code before/at factory deployment required at startup.** | RMT-specific launch/event/economic evidence. WS could wake the same durable range replay; cannot replace it. |
| Market indexer: `apps/market-indexer/src/{worker,token-identity-index,up-enrichment}.ts` | `MARKET_INDEXER_RPC_URL`; HTTP 15s, 2 retries/500ms delay | chainId, blockNumber, blockByNumber, getCode, getLogs, receipt, eth_call | Default 5s after work; ≤5,000-block/source range, seven reviewed sources. Default lag20 (minimum12). Historical source-code probes before/at deployment use the same URL; failures are unavailable evidence, conflicts are distinct. Metadata uses five-token multicalls, concurrency2; failure can fall back to four individual calls/token. Identity catalog rescan15min. | Mostly generic venue observations plus RMT source/identity provenance. RPC history is needed; archive state benefits source proof. WS later; enrichment fanout is the larger budget. |
| NFT ownership: `apps/nft-indexer/src/{worker,source-verification,technical-verification-live}.ts` | `NFT_INDEXER_RPC_URL`; Viem HTTP, no explicit JSON-RPC batch option | chainId, blockNumber, blockByNumber, getCode, getLogs, receipt, eth_call; request boundary in worker adapts calls | Default5s; 2,000-block ranges, max16 batches/source/cycle; three sources. `NFT_INDEXER_FINALITY_DEPTH` required, production value redacted. Double range-boundary/checkpoint hashes, reorg/replay and durable projection. Historical logs/receipts required; current URI/interface/TBA calls and source proof have their own scope. | RMT-specific completeness-aware ownership authority. WS hints later; HTTP replay/checkpoints remain primary. |
| NFT marketplace: `apps/nft-marketplace-indexer/src/worker.ts` | `NFT_MARKETPLACE_RPC_URL`; Viem HTTP | **chainId only at startup**; marketplace observations use OpenSea HTTPS | Default60s provider poll; CCFF00 only. No recurring RPC calls or archive requirement from this worker. Provider timestamps/cursors/coverage, not chain finality. | Provider observation/provenance persistence. Chain WS is not useful for OpenSea listing changes. |
| External-origin indexer: `apps/external-origin-indexer/src/{index,server,store}.ts` | No active RPC client in production service source | None in active worker | No RPC polling. DB/API foundation and activation-locked source registry; `shadow/` contains evidence work, not a production ingest loop. Not present as a deployed application in the inspected Railway project. | RELEASE-LOCKED FUTURE; no new event/RPC infrastructure needed now. |

Production variable names include polling/chunk/confirmation settings in some services; their values were redacted. The table and models use **source defaults**, not invented current production overrides. Worker sleeps occur after work; busy/backoff cycles can be slower than `3600 / interval`.

### Web: active public consumer families

Precedence is left-to-right; `default` means `https://rpc.mainnet.chain.robinhood.com/` from the chain config. Server/client precedence differs today. This audit documents it without consolidating or changing production endpoints.

| Files / consumer | Endpoint selection | Actual read methods / purpose | Cadence, archive and expected amplification |
| --- | --- | --- | --- |
| `app/wallet-config.ts`; `vnext/use-vnext-wallet-assets.ts`, `spend-balance.tsx` | `NEXT_PUBLIC_RMT_RPC_URL → default`; selected wallet signing provider remains separate | balance, eth_call/multicall for balances and missing units | Visible balance60s, discovery300s; initial read and optional enrichment reread. Current state; native + bounded ERC20 batches per wallet. Per-asset unavailable/zero/stale distinctions retained. |
| `wallet-transfer-dialog.tsx`; `vnext/vnext-wallet-review.tsx`, `use-vnext-execution-recovery.ts` | Configured Wagmi public client and explicitly selected wallet provider | chainId, tx, receipt, block, transactionCount, balance, gasPrice; gas estimation in existing wallet paths | On demand/reconciliation; open withdrawal balance10s; receipt polling via Wagmi/Viem. Historical tx/receipt needed, not full archive state. Unknown requests retain originating-account tracking. No financial method exercised in this audit. |
| `server/vnext-zero-x-firm-quote-verifier.ts`: `estimateApprovalGas` | `RMT_RPC_URL → RMT_MAINNET_RPC_URL → ROBINHOOD_MAINNET_RPC_URL → NEXT_PUBLIC_RMT_RPC_URL → default` | Raw HTTP `eth_estimateGas` for the exact ERC20 AllowanceHolder approval | Only when the firm provider response requires approval; one individual request, 8s deadline, no application retry, no archive. Native input does not invoke it. This estimates approval gas, not swap route/runtime/simulation re-proof. |
| `server/universal-market-resolver.ts`; `vnext-asset-identity.ts` and unit consumers | `RMT_MAINNET_RPC_URL → ROBINHOOD_MAINNET_RPC_URL → NEXT_PUBLIC_RMT_RPC_URL → default` | code, eth_call and multicall metadata/pool identity | Demand-driven bounded readers/cache. Display resolver HTTP batch100/wait0; execution/unit reader uses **individual** framing, 8s timeout/2 retries. Native18 units built in; unknown ERC20 input units read correctly. Output enrichment is optional. |
| `server/project-identity-admission.ts` | `RMT_MAINNET_RPC_URL → ROBINHOOD_MAINNET_RPC_URL → default` | multicall name/symbol/decimals/supply plus independent project evidence | 2s timeout/no retry; bounded identity cache/positive conflicts. Current state; no archive requirement. Quarantine is positive identity conflict, not arbitrary market admission. |
| `server/rmt-curated-market-registry.ts` | `RMT_RPC_URL → ROBINHOOD_MAINNET_RPC_URL → NEXT_PUBLIC_RMT_RPC_URL → default` | code, eth_call factory/pair/assets/fee/tick-spacing/slot0 | Fresh5min, stale1h; bounded reviewed entries. Presentation/curation only, no ordinary-swap permission. |
| `api/markets/external/route.ts`; `circus-curve-feed.ts`, `lemon-launch-feed.ts`, `pons-v2-launch-feed.ts`, `stonkbrokers-safe-launch-feed.ts`, `pons-project-metadata.ts`, `noxa-project-metadata.ts` | Route client `RMT_RPC_URL → NEXT_PUBLIC_RMT_RPC_URL → default`; client passed to source helpers | code and eth_call of actual source/factory/token/curve/metadata functions | Broad discovery snapshot caching/coalescing; visible directory300s. Bounded source inputs; source optional failures cannot remove independent identity or block 0x. No full archive state required for current calls. |
| `server/launch-feed.ts`, `indexed-launch-feed.ts`; `lib/use-launch-record.ts` | Active chain `RMT_RPC_URL → NEXT_PUBLIC_RMT_RPC_URL → default` | blockNumber, code, eth_call; multicall live balances/reserves beside indexed records | Legacy V6 presentation/data reads, demand and cache driven. DB history preferred; optional reads scale with returned page, not the whole chain. Creator launch execution remains separately controlled. |
| `server/external-uniswap-market.ts`, `external-uniswap-v4-market.ts` | V2/V3: `RMT_RPC_URL → NEXT_PUBLIC_RMT_RPC_URL → default`; V4 adds `ROBINHOOD_MAINNET_RPC_URL` before public override | code, eth_call pool identity/state; V4 getLogs | Optional pool presentation; bounded lookup/lookback and provider cache. Read-only venue evidence does not activate a direct executor. Historical logs may be needed for V4 pool lookup. |
| `server/vnext-ecosystem-intelligence.ts` | `RMT_VNEXT_UP_RPC_URL → RMT_MAINNET_RPC_URL → ROBINHOOD_MAINNET_RPC_URL → default` | block, code, eth_call factory/pool/gauge/fee relationships | HTTP batch64/wait0, 5s/1retry; directory300s/client, bounded server snapshot. Optional intelligence; no swap authority. |
| `server/system-health.ts` | `RMT_RPC_URL → NEXT_PUBLIC_RMT_RPC_URL → default` | chainId, blockNumber, block | Cached15s health snapshot;3 chain/head/block calls on miss plus curated snapshot dependencies. Share across users, not wallet-specific. |
| `server/token-risk-evidence.ts` | `RMT_RPC_URL → NEXT_PUBLIC_RMT_RPC_URL → default` | eth_call and block, contract-rule observation; explorer HTTP separate | Fresh5min/stale30min, on demand; optional enrichment, no quote gate. |
| `server/registered-liquidity-position.ts`; legacy `market-panel.tsx`, `lib/use-trade-fee-estimate.ts` | Existing chain client / `RMT_RPC_URL → NEXT_PUBLIC_RMT_RPC_URL → default` | code, eth_call registered positions/owner/approval; blockNumber/gasPrice/estimateGas in legacy UI | Demand-driven existing legacy surfaces; not public provider-native route verification. No reactivation/change. |
| `server/vnext-wallet-request-discovery.ts` | `RMT_RPC_URL → RMT_MAINNET_RPC_URL → ROBINHOOD_MAINNET_RPC_URL → default` | chainId, blockNumber, blockByNumber with transactions | Authenticated bounded recent-block recovery scan only when needed. Historical block/tx retention needed; do not make it a per-user whole-chain poll. |
| `api/vnext/native-settlement-trace/route.ts`; `server/vnext-settlement-trace-client.ts` | Route: `RMT_RPC_URL → RMT_MAINNET_RPC_URL → ROBINHOOD_MAINNET_RPC_URL → NEXT_PUBLIC_RMT_RPC_URL → default`; trace: **`RMT_SETTLEMENT_TRACE_RPC_URL` required** | chainId, tx, receipt; trace client debug_traceTransaction(callTracer) and receipt consistency reread | On-demand authenticated settlement accounting; trace deadline8s, no retry, bounded response. Trace access needed for exact native-flow reconciliation, not for quoting/preparing a swap. Configured trace secret PRESENT; its host/value not accessible. |
| `server/nft-mint-radar.ts`; `lib/nft/collection-verification.ts` | `NFT_MINT_RADAR_RPC_URL → RMT_MAINNET_RPC_URL → ROBINHOOD_MAINNET_RPC_URL → default` for Radar; explicit client for collection verification | chainId, code, eth_call ERC165/SeaDrop allowed tokens/stage | Bounded candidates; stale threshold15min, provider/onchain evidence separate. Discovery authority; mint execution remains disabled. No effect on token trading. |

The NFT item/collection readers consume the authenticated NFT backend over HTTP. Their URI/TBA reads are implemented in `apps/nft-indexer/src/worker.ts`, not a second browser ownership indexer. Marketplace reads similarly consume its dedicated reader.

Dormant consumers include `vnext-authorization-time.ts`, all direct fee-executor/Uniswap/up/Sushi verification modules, NFT mint preflight/receipt execution, Distribution readiness and creator/testnet rehearsal verifiers. The public 0x verify/authorize branches do **not** call the old authorization clock, route decoder, deployment registry or local simulation. `rmt-trade-identity.ts` contains creator contract readers, but ordinary `requireAuthenticatedTradeWallet` uses Privy identity/linked-wallet validation, not those RPC calls. Generic Firebase `.call`, HTTP heartbeat `.request` and Web Locks `.request` in the machine inventory are not JSON-RPC.

No persistent worker currently uses a WebSocket transport. Wallet/account reads require current state, final receipts require canonical binding, and indexer lag/checkpoint rules remain independent of provider transport. No method was inferred solely from a comment.

## 2. Method-level Alchemy preflight

The current chain-specific [Alchemy support table](https://www.alchemy.com/docs/reference/feature-support-by-chain) advertises Robinhood Mainnet read methods. The [Robinhood overview](https://www.alchemy.com/docs/robinhood-chain/robinhood-chain-api-overview) and [Robinhood connection guide](https://docs.robinhood.com/chain/connecting/) identify the HTTP/WS provider and archive use. [Published support snapshot](evidence/2026-09-30/alchemy-published-support.json) records the exact network `ROBINHOOD_MAINNET`; its internal table index is not chainId. All Alchemy results below mean **DOCUMENTED / NOT LIVE TESTED**, not EQUIVALENT.

| Method | Current public provider result / latency ms | Alchemy | Equivalent | Archive relevance | RMT consumers / migration risk |
| --- | --- | --- | --- | --- | --- |
| eth_chainId | 4663 /175 | Documented | NOT_ESTABLISHED | None | All startup/wallet checks; wrong chain must block config acceptance |
| eth_blockNumber | Success /83 | Documented | NOT_ESTABLISHED | None | Main/market/NFT heads; compare skew without demanding simultaneous equal latest head |
| eth_getBlockByNumber | Pinned success /79 | Documented | NOT_ESTABLISHED | Historical blocks | Checkpoints, reorg/recovery; compare exact number/hash |
| eth_getBlockByHash | Same pinned block/hash /78 | Documented | NOT_ESTABLISHED | Historical blocks | Canonical correlation/control; field/null semantics |
| eth_getCode | SHCAT current1764 bytes /71; deployment history **-32000** /77–78 | Documented | NOT_ESTABLISHED | **Historical state required** | Main startup/source checks; do not equate current-code success with archive compatibility |
| eth_call | Pinned SHCAT decimals success /77; historical ERC721 interface **-32000** /77 | Documented | NOT_ESTABLISHED | Historical state when block-qualified | Units, balances, source metadata; ABI/error parity and multicall gas/body limits |
| eth_getLogs | CCFF00 creation +5 blocks:5 logs /77 | Documented | NOT_ESTABLISHED | Retained historical logs | All persistent event workers; **plan range restriction is a migration blocker** |
| eth_getTransactionByHash | CCFF00 deployment transaction /75 | Documented | NOT_ESTABLISHED | Historical transaction | Source proof/recovery; null/pruning behavior |
| eth_getTransactionReceipt | Deployment receipt, status1 /81 | Documented | NOT_ESTABLISHED | Historical receipt | Source proof/settlement; reorg consistency |
| eth_getBalance | Current /104; historical **-32000** /74 | Documented | NOT_ESTABLISHED | Historical state if requested | Exact-wallet balances; never translate unavailable into zero |
| eth_getTransactionCount | Success /79 | Documented | NOT_ESTABLISHED | Current or historical nonce | Originating-wallet recovery; pending/latest tag semantics |
| eth_gasPrice | Success /77 | Documented | NOT_ESTABLISHED | None | Wallet gas display/handling; not route re-proof |
| eth_feeHistory | Success /67 | Documented | NOT_ESTABLISHED | Recent fee/block history | Wallet fee estimates; Nitro field consistency |
| eth_estimateGas | Read-only interface call success /73 | Documented | NOT_ESTABLISHED | Usually current | Wallet/native transfer handling and exact ERC20 approval gas; approval payload was not probed. **Not an independent swap-simulation gate.** |
| eth_maxPriorityFeePerGas | Not probed | Documented | NOT_ESTABLISHED | None | Viem fee helper may use it; provider/Nitro fee semantics |
| debug_traceTransaction | **-32601** /74 | Documented debug support | NOT_ESTABLISHED | Historical execution tracing | Existing dedicated native-settlement trace endpoint; tracer/response bounds must be compared there |
| HTTP JSON-RPC batch | Two reads, ID-correlated success /86 | [Documented batching](https://www.alchemy.com/docs/reference/batch-requests) | NOT_ESTABLISHED | Depends on each call | Display readers may batch; repaired units reader remains individual. Batch is not a CU discount. |
| Invalid block tag | **-32602** /71 | Not probed | NOT_ESTABLISHED | None | Preserve typed transient/invalid distinction; no raw error exports |
| eth_subscribe / unsubscribe | Not probed | Documented WS support | NOT_ESTABLISHED | Replay still HTTP | Candidate head/log hints; disconnect/replay/reorg tests required |

Alchemy latency is NOT_MEASURED for every row. Samples above are one bounded read per operation, not p50/p95 or a reliability SLA. Requests had an 8s abort deadline; no natural timeout occurred. No write/sign/send method was called. Fixed evidence: SHCAT `0x14c51bb55592372eac7141a1d0527d1dd7fbd42f`; CCFF00 `0x505a22ffed8d37ebe580ffd98d2cdb0021189146`, deployment10929152 and exact reviewed deployment transaction in the JSON. Current reads shared block `0x4938e67`; deployment probes deliberately use historical block10929152/10929151. Independent current and historical observations are not compared as if from the same state.

**ARCHIVE_EQUIVALENCE: NOT_ESTABLISHED.** Historical blocks/logs/receipts succeeded while state-at-deployment failed on the public endpoint. The generic -32000 code is retained without inventing its backend cause. The main indexer's configured archive endpoint was not accessible for probing. Before any later switch, compare code before/at deployment, exact block-qualified eth_call/balance, historical logs/receipts and reorg/checkpoint hashes on both actual endpoints using the same tags. Test a known revert/malformed ABI separately from transport timeout; never mark RPC unavailability as invalid contract evidence.

Alchemy's [Robinhood eth_getLogs page](https://www.alchemy.com/docs/chains/robinhood-chain/robinhood-chain-api-endpoints/eth-get-logs) currently specifies **Free:10 blocks; PAYG/Enterprise:unlimited range**, with a150MB response cap. Existing RMT2,000/5,000-block chunks therefore are not compatible with Free as configured. Published method support is insufficient for a migration decision. No chunk change, paid-plan purchase or provider switch is performed here.

## 3. Nitro awareness and event-driven recommendation

Robinhood's [connection guide](https://docs.robinhood.com/chain/connecting/) publishes the mainnet sequencer, a WS sequencer feed and a delayed backup feed (~500ms delay); its [full-node guide](https://docs.robinhood.com/chain/run-a-full-node/) documents Nitro node operation. These feeds are not generic JSON-RPC subscriptions. L2 block lag is not Ethereum settlement finality.

| Capability | Classification | RMT implication |
| --- | --- | --- |
| Nitro-compatible ABI/RPC/checkpoint tooling | USE_NOW | Existing Viem reads and durable range replay already fit; preserve chain4663 and exact source evidence. |
| RPC WS newHeads/logs | EVALUATE_LATER | A wakeup hint can reduce empty cycles/latency. Coalesce bursts; re-read finalized ranges/checkpoints and retain polling watchdog. Do not make WS delivery ownership authority. |
| Sequencer feed | NOT_NEEDED now | Adds binary/feed protocol, ordering, reconnect and node-like ingestion complexity without a current product need. No extra feed consumer. |
| Delayed backup feed | EVALUATE_LATER only with a demonstrated feed requirement | Useful backup timing property, not an economic-finality signal or deterministic replacement for DB replay. |
| Self-hosted Nitro node | NOT_NEEDED | Operational/storage/archive burden unjustified before proving provider limits. No provisioning. |
| Canonical Ethereum↔Robinhood bridge primitives | EVALUATE_LATER | [Arbitrum bridge concepts](https://docs.arbitrum.io/how-arbitrum-works/deep-dives/token-bridging) explain gateways/messaging; verify Robinhood-specific deployed contracts, token mapping, settlement and exits in a separately authorized funding task. No bridge activation. |

### Source-default polling budget

Let S=7 market sources; A=number of sources with a new range this cycle; N=identity tokens selected (≤250); U0/Ug=up pools refreshed without/with gauge (combined≤25); B=main-indexer ranges processed; M/F/G=main market/splitter/graduation address counts. Calls are logical RPC requests; multicall aggregates multiple contract reads into one eth_call, while HTTP batch aggregates transport only.

| Service | Calls/cycle estimate | Default cycles/h | Approx calls/h / day | Recommendation |
| --- | --- | --- | --- | --- |
| Main indexer | Idle~2; ranges: `2 + B*(2 + ceil(M/100)+ceil(F/100)+ceil(G/100)) + event-specific reads` | 360 | Idle720 /17,280; illustrative one-range M=1,F=1,G=0:2,160 /51,840 | RETAIN POLLING now. Later WS coalesced-head wakeup, HTTP finalized replay + watchdog; startup archive remains necessary. |
| Market indexer | Base `2+S+2A`; enrichment `3U0+8Ug+ceil(N/5)`; fallback up to4N extra calls | 720 | Idle6,480 /155,520; all seven advance16,560 /397,440; illustrative25 gauged pools +250 identity tokens:196,560 /4,717,440 before fallback | RETAIN POLLING now. Measure enrichment selections/retry fanout first; WS cannot solve repeated per-pool metadata reads. |
| NFT ownership | `1 + C + 3R` for C=3 sources, total processed ranges R≤48 | 720 | Idle2,880 /69,120; one range/source9,360 /224,640; max48ranges106,560 /2,557,440 | RETAIN POLLING now; WS later as hints. Metadata/TBA/item reads are extra on-demand requests, not included. |
| NFT marketplace | Recurring chain RPC0; OpenSea `1+L+O+Sales+K` per CCFF00 cycle (each page count1..8, candidates0..8) | 60 | Chain RPC0; provider minimum240/h5,760/day, maximum1,980/h47,520/day, before up to3-attempt HTTP retries | RETAIN scoped OpenSea polling; evaluate Stream only after legitimate credential/quota and cursor/replay tests. No chain WS replacement. |
| External-origin |0 |0 |0 /0 | NOT_NEEDED; separately release activation before designing production ingestion. |

Main backfill is not capped to one range/cycle; its loop can run to safe head. Reorg searches can read up to the retained checkpoint ancestor window; startup probes, API reads, RPC retries, provider errors and DB time add work beyond these healthy-cycle formulas. Market multicall fallback can add up to1,000 reads at N250; the sample enrichment maximum is not observed steady production traffic.

Any event-driven implementation must retain durable cursors/checkpoints, source validation, replay from last committed range after reconnect, removed-log/reorg handling, bounded overlap, idempotent event keys, finalized-head lag and an outage watchdog. Duplicate webhook/log delivery is expected. Triggering every Nitro head could increase load versus the current5s poll; coalesce to existing bounded work. No cadence or finality change in this PR.

## 4. Alchemy Data API / webhook fit on4663

The [chain-specific support table](https://www.alchemy.com/docs/reference/feature-support-by-chain) advertises the following on `ROBINHOOD_MAINNET`; [Robinhood API overview](https://www.alchemy.com/docs/robinhood-chain/robinhood-chain-api-overview) provides chain-specific API context. Endpoint success/coverage and account entitlements remain untested.

| Capability | Published4663 support | Classification / intended use |
| --- | --- | --- |
| Token API | Yes | USE_FOR_PORTFOLIO: candidate batch balance/units observation; no trading metadata prerequisite. |
| Transfers API | Yes | USE_FOR_PORTFOLIO: candidate paginated history; receipt/log and gap/reorg checks still needed for cost basis/economics. |
| NFT API | Yes | DUPLICATES_EXISTING_RMT_AUTHORITY for deterministic participating-project ownership; optional generic holdings observation later. |
| Address Activity webhooks | Yes | USE_FOR_PORTFOLIO / USE_FOR_AGENTS_LATER: wake reconciliation, authenticate/deduplicate delivery, replay gaps. |
| Custom webhooks | Yes | USE_FOR_PROOF_OF_HOLDING as observation hints later; no replacement of RMT deterministic eligibility. |
| WebSockets | Yes | USE_NOW as a preflight candidate, not integration; subsequent worker optimization requires reconnect/replay evidence. |
| Debug traceTransaction/call/block | Yes | USE_NOW for read-only capability comparison of the existing settlement trace consumer once credential is available. |
| Parity Trace / Arbitrum Trace APIs | **No in this table** | NOT_SUPPORTED_ON_4663; debug availability does not imply these APIs. |
| Bundler | Yes | NOT_NEEDED: existing Privy/EOA AllowanceHolder flow does not require ERC4337 infrastructure. |
| Gas Manager | Yes | NOT_NEEDED: no sponsorship/delegation/paymaster activation or paid funding change. |

API availability does not prove complete old history, webhook custom-query compatibility, NFT spam policy or finality. Those are later acceptance dimensions, not grounds to create a competing ownership authority today.

## 5. 0x capability audit — execution unchanged

Source: `vnext-zero-x-adapter.ts`, `vnext-zero-x-firm-quote-verifier.ts`, `vnext-zero-x-firm-quote-commitment.ts`, `vnext-execution-eligibility.ts`, quote/verify/authorize routes and existing wallet/recovery consumers.

| Capability | Classification | Finding |
| --- | --- | --- |
| Swap API v2 price/quote | ALREADY_USED | Official `api.0x.org/swap/allowance-holder/{price,quote}`, server-only key and v2 header. Price is indicative; firm response supplies immutable transaction/terms. |
| AllowanceHolder | ALREADY_USED | Exact provider spender, exact ERC20 approval only when required; native ETH no approval. No approval of Settler/transaction target. |
| Integrator fee | ALREADY_USED |25bps and existing treasury; direction-aware selector preserved: base/base input, elseUSDG when either legUSDG, else nativeETH when either legnativeETH, else sell. |
| Multiple fee recipients | PROJECT_ECONOMICS_LATER / DISTRIBUTION_LATER | [Documented multi-fee support](https://docs.0x.org/evm/0x-swap-api/additional-topics/multi-fee-support) accepts matched comma-separated recipients/BPS/token fields and `integratorFees`. RMT currently uses one recipient; adopting multiple needs explicit economics/consumer review, not this PR. |
| Trade Analytics | ANALYTICS_LATER | [API introduction](https://docs.0x.org/evm/trade-analytics-api/introduction): application-attributed trades, transaction references and reported economics. Updates~15min; provider reports become final after48h; reread preceding2days. Could replace custom report scraping, **not independent settlement/revenue verification**. Credential/app attribution and4663 result coverage must be proven in a pilot. |
| Liquidity-source disclosure | ALREADY_USED, diagnostic only | Provider route/source fields may inform UI, never permission to route. Unknown DEX/hook/action remains acceptable. |
| Token/market APIs | NOT_NEEDED for market presentation | [API overview](https://docs.0x.org/api-reference/api-overview) covers execution, analytics and supporting token/source data; no reason to move charts/art/holders away from existing Gecko/RPC. Price/source/token reference data is not a new project authority. |
| Gasless, Cross-Chain, Permit2 | NOT_NEEDED | Gasless public dispatch/waits/ranking/errors are absent; no alternate executor/funding integration activated. |
| Rate limits / request coalescing | USE_NOW as capacity planning | [Free tier~5RPS shared across endpoints, fixed1s windows](https://docs.0x.org/docs/developer-resources/rate-limits). Actual RMT account quota not readable. Existing debounce400ms, active9s cadence,6s indicative reuse, hidden/offline/closed pauses and in-flight dedup remain unchanged. |

Trade Analytics can reduce *reporting* infrastructure after an app/chain-specific trial, but transaction hashes, actual fee transfers, canonical receipt/reorg status and independently established fills remain RMT evidence. Provider-estimated USD values cannot invent cost basis/P&L or Distribution entitlement. No live analytics request was made with inaccessible credentials. No blanket route decoding, runtime re-proof, chain-clock or local swap simulation is reintroduced.

## 6. Gecko production efficiency

| Reader/path | Existing limits/cache | Amplification / gap |
| --- | --- | --- |
| `gecko-presentation-reader.ts` |96 entries; URL single-flight;4 concurrent;24 starts/min/process;3.5s;512KiB; redirects rejected; failure15s;429 cooldown1..300s (default60) | Local budget does not coordinate Vercel instances/regions or other Gecko readers. Stale evidence≤15min default; typed unavailable/rate-limited/invalid retained. |
| `token-chart-market.ts` | Token→best legitimate pool5min; canonical/hint first; exact token evidence, liquidity/volume ranking; OHLCV cached at chart refresh interval | 5M15s,15M20s,1H/6H/24H30s,7D60s. Canonical404 can trigger one bounded alternate; no arbitrary provider fanout. |
| `token-presentation-reader.ts` | Token info15min/stale24h; pool5min; uses shared new reader | Visual/market categories independent of identity and execution; matching artwork/info URLs coalesce. |
| `token-artwork-reader.ts` |32 images1h/stale24h;96 failures60s;4 concurrent;3s;1MiB;≤2 redirects; HTTPS/public DNS pinned at each hop and raster validation | Broken art uses stable monogram; no SVG/HTML execution, no new provider. Image-host traffic is not a Gecko API call unless fetching provider metadata. |
| `gecko-new-pool-feed.ts` | Three feed endpoints (new/top/trending), page1; Next fetch revalidate60s;7s timeout | Not covered by the new process-wide24-start budget. Market snapshot/client300s reduces repetition, not global quota authority. |
| `api/markets/external-trades/route.ts` | Pool trades Next revalidate6s, CDN6s/stale30s | Potential10 provider calls/min/hot pool; **not covered by new reader budget**. Include in any shared-budget design. |
| API OHLCV / token workspace / artwork | CDN/shared-cache headers; workspace60s/stale120; OHLCV range interval/stale30; media cache + stable layout | Framework/CDN hits serve many users. Cache misses, unique contracts/ranges/pools and cold regions still amplify. |

[GeckoTerminal FAQ](https://apiguide.geckoterminal.com/faq) publishes30calls/min for the public API. That is separate from CoinGecko Demo/paid plan quotas. Existing provider data is beta/attributed and never execution authority. No DEX Screener expansion; the owner/legal review of its direct-competition restriction remains separate.

### Scale assumptions and model

Assume one visible1H chart/token, ten-minute session,20 OHLCV reads,2 token-pool reads and1 visual-info read **if no usable upstream/shared cache**. That is23 API calls/session; exclusive endpoints/extra trades panels/retries add calls. Counts represent offered demand; local throttles/429 can reduce successful requests. They are not a claim that all requests will be dispatched or that production has this load.

| Simultaneous ten-minute sessions | Unshared calls/10min | Offered calls/min | Ideal cache with20 shared hot tokens (no trade feed) |
| --- | --- | --- | --- |
|1 |23 |2.3 | Same one-token demand, plus shared feed overhead |
|100 |2,300 |230 |~48.33/min |
|1,000 |23,000 |2,300 |~48.33/min |
|10,000 |230,000 |23,000 |~48.33/min |

Ideal20-token shared demand =40 chart +4 pool +1.33 info +3 feed calls/min. Only5 hot tokens≈14.33/min. Add trades feed up to10/min for each active pool. Different ranges/regions/unique tokens and misses change these numbers. Thus even perfect caching is not enough to offer every hot pool/range/feed at present cadences under a30/min quota. Do not hide this by inventing price histories or claiming100% coverage.

The existing `fetch(...next.revalidate)` already benefits from [Vercel Data Cache](https://vercel.com/docs/caching/runtime-cache/data-cache): regional and environment-isolated, persistent across deployments. Process-local Maps add cheap reuse/coalescing. **Process-local caching alone is insufficient for a global upstream budget**, and Data Cache is not a distributed provider rate limiter. Concurrent misses, eviction and uncached legacy reads need measurement. No paid KV is justified solely by a user-count forecast.

### Simplest shared-cache design — NOT IMPLEMENTED / NOT DEPLOYED

First use existing logs/counters and CDN/Data Cache hit evidence to measure endpoint/cache-key cardinality,429 rate, provider latency and stale-served count. Preserve all current refresh cadences and stable UI. If sustained misses exceed the account budget, use one existing Railway worker and its existing dedicated PostgreSQL with an isolated *presentation-cache* table keyed by provider/version/chain/contract/pool/range/query. Expiry + observation time + provenance + last-known-good value; bounded pending keys and payloads; advisory lease for one refresher per key; single shared endpoint budget/cooldown covering **all** Gecko families. Web reads cached evidence or bounded enqueues, never per-user upstream fanout; no ownership/economic authority from the cache.

This is a design option, not authorization for a table/job/config change. Compare its measured CPU/DB/storage cost with the already available regional Data Cache before implementation. Do not create Redis/KV/service/DB by default. Backpressure must expose stale/rate-limited states, never block the existing trade ticket. Wallet-bound quotes, authentication and spendable balances do not belong in a public shared presentation cache.

## 7. OpenSea: persist versus provider-read

Actual worker: `apps/nft-marketplace-indexer/src/{worker,reader,store,opensea-client,sources}.ts`; normalized domain in `packages/shared/src/nft/marketplace-evidence.ts`. It admits **CCFF00 only**, not Watching projects. Required server key absent in inspected service variable names; no activation attempted.

| Responsibility | Classification | Reason |
| --- | --- | --- |
| Exact chain/collection/provider slug relationship, observed identity and provenance | KEEP_IN_RMT | Prevent cross-collection/chain substitution; retain source/time and reviewed project relationship. |
| Pagination cursors, idempotent order/sale observations, completeness/watermarks/errors | KEEP_IN_RMT | Restart-safe scoped history and honest unavailable/partial/stale state. |
| Scoped native-payment normalized listing candidates and exact-order revalidation evidence | KEEP_IN_RMT | A provider listing is not an executable/verified order. Lowest normalized listing is native-only, not a universal floor. |
| Provider-reported floor, current stats, listings/offers/sales | READ_FROM_OPENSEA / REQUIRES_OPENSEA_CREDENTIAL | Source/currency/window explicit; [stats](https://docs.opensea.io/reference/get_collection_stats) distinguish volume and floor currencies. Do not infer zero from unavailable. |
| Artwork/traits/descriptions of arbitrary NFTs | READ_FROM_OPENSEA only as optional enrichment | Existing onchain metadata/artwork authority remains independent. Avoid storing a duplicate full OpenSea catalog. |
| Transfer ledger/holders/circulating supply | KEEP_IN_RMT ownership indexer | No transfer-as-sale inference; complete ownership projection required for totals. |
| Unlimited global marketplace indexing/orderbook, duplicated media universe | REMOVE_DUPLICATION candidate | Not implemented as a broad current authority; do not build it. Retain only project-scoped observations that serve UI/accounting needs. No code deleted here. |
| Stream API replacing repeated polling | EVALUATE_LATER / REQUIRES_OPENSEA_CREDENTIAL | [Stream](https://docs.opensea.io/reference/stream-api) may reduce REST repetition, but reconnect gaps/order status still need bounded REST reconciliation and durable provenance. |

The reader's bounded recent reports are not a24h total. Twenty retained reports must stay labeled recent/bounded;24h volume requires correctly windowed aggregates/coverage. Provider failure must not erase ownership evidence. [Collection events](https://docs.opensea.io/reference/list_events_by_collection) support timestamp filters; scope must remain explicit.

[OpenSea key documentation](https://docs.opensea.io/reference/api-keys) describes account-shared limits, response quota headers and Retry-After. Exact permanent-key quota is unknown here. Seven-day instant keys are not a permanent production solution and were not obtained. The current client bounds retry attempts to3 and tracks rate-limit headers; a future optimization may centralize cooldown across feeds if activated/observed quota pressure proves it necessary. No service, key or environment mutation now.

## 8. Railway deployment efficiency — implemented repository change

[Railway watch patterns](https://docs.railway.com/builds/build-configuration) use repository-relative gitignore-style matching; no match skips deployment. [Monorepo docs](https://docs.railway.com/deployments/monorepo) separate config-file/root-directory resolution. Tests use the exact-path/recursive-directory subset chosen here, not a homemade replacement for Railway deployment logic.

| Service | Before | After | Live adoption |
| --- | --- | --- | --- |
| Main indexer | app/**; root package + workspace; **lockfile missing** | app/src/** + own package.json/tsconfig.json/railway.json + root package/lock/workspace | Repository config linked; not deployed here |
| Market indexer | app/** + root package/lock/workspace | Same narrowed app inputs + same root files | Repository config linked; not deployed here |
| External-origin indexer | app/** + root package/lock/workspace | Same narrowed app inputs + same root files | No live application service found; future repository scope |
| NFT ownership | app/** + shared/** + root package/lock/workspace | Narrowed app inputs + shared/src/** + shared/package.json + root files | **Dashboard inline scope unchanged**; later owner-authorized adoption needed |
| NFT marketplace | Same broad NFT pattern | Same narrowed NFT scope | **Dashboard inline scope unchanged**; no activation |
| Five PostgreSQL services | Railway PostgreSQL image, no repository source | NOT_APPLICABLE / unchanged | No DB/service/resource/config mutation |

All production TS/build inputs reside in src and each app's package/tsconfig. SQL migrations/schemas are inline there. Market fixtures and external-origin shadow configuration are test-only, not production build/runtime inputs. NFT services depend on `@rmt/shared`; token and external workers do not. The test checks declared workspace dependency closure and exported source coverage so a later shared dependency cannot silently lose its trigger.

| Changed path | Before triggers | After triggers |
| --- | --- | --- |
| web/CSS or top-level docs | None | None |
| worker README/.env.example | That worker | None |
| worker src/schema/package/tsconfig/railway config | That worker | That worker |
| shared NFT source/package | Both NFT services | Both NFT services |
| shared README | Both NFT services | None |
| root package.json/workspace | All five | All five |
| pnpm-lock.yaml | Four; main indexer incorrectly omitted | All five |
| market test fixture / external shadow-only evidence | Owning worker | None |

The recent PR556 main/market deployments were not triggered by a pure web/CSS/docs diff: main included root axios security override/lock changes. Those are legitimate shared installation inputs and remain watched. Removing root package/lock triggers merely to avoid deployment would risk stale dependency/security fixes.

Validation: `node --test scripts/railway-watch-scope.test.mjs` —29/29 locally. It compares [exact base configs](evidence/2026-09-30/railway-watch-baseline.json) to the proposed scopes, proves the old missing-lockfile/broad-doc behavior, covers real tracked source and workspace dependencies, and confirms commands/health/restart policy are identical. It is added to the existing indexer CI job, not a separate deployment workflow. No build-command/region/replica/resource/database/variable/domain/service identity change.

## 9. Dormant architecture inventory — no deletion

| Architecture / source | Classification | Current role / cleanup boundary |
| --- | --- | --- |
| Public 0x Swap v2 adapter/firm response/commitment/wallet recovery | ACTIVE | Only normal spot executor. Do not remove or rewrite. |
| Gasless branch of `vnext-zero-x-adapter.ts`, quote observation types | TEST/EVIDENCE ONLY for current public path; dormant candidate | Eligibility filters it before dispatch. Delete only after separately tracing shared consumers; no revival. |
| Sushi adapters/`sushi-trade.ts`/historical executor contracts | TEST/EVIDENCE ONLY execution; ACTIVE read-only market source | Venue indexing is not executor activation. Candidate cleanup is unreachable public execution branches, not historical evidence/contracts. |
| Uniswap V2/V3/V4 direct adapters/fee executors/decoder/proofs | TEST/EVIDENCE ONLY / DEAD CANDIDATE for obsolete public direct execution | Read-only venue/pool intelligence remains ACTIVE; historical deployment/receipt evidence must survive cleanup. |
| UniswapX intent adapters/order flow | RELEASE-LOCKED FUTURE / TEST EVIDENCE | Not allowed by current public execution eligibility. No relayer/service activation. |
| up. direct execution/fee code | TEST/EVIDENCE ONLY execution; ACTIVE venue enrichment | Live gauge/pool reads are presentation, not swap permission. |
| PONS/UP launch and pool readers | ACTIVE optional discovery | Do not equate a source label with legacy executor authority. Old direct execution is not public fallback. |
| Legacy fee systems/V6 factory/splitters | ACTIVE main-indexer history/economic evidence; obsolete execution branches DEAD CANDIDATE | Scope cleanup to callers, not economic records or reviewed deployed contracts. Current0x fee selector unchanged. |
| Across/config/quotes/bridge helpers | RELEASE-LOCKED FUTURE | Dedicated cross-chain RPC variable names exist; configured values do not prove a released funding route. No bridge/funding activation. |
| Position Guard/live/admin/rehearsal controls | RELEASE-LOCKED FUTURE / TEST EVIDENCE | Market heartbeat evaluator is optional and no evaluator URL/token listed on inspected service. Do not enable automation. |
| External-origin activation registry/candidate shadow replay | RELEASE-LOCKED FUTURE / TEST EVIDENCE | DB/API foundation, no live ingest service in inspected project; review source activation separately. |
| Distribution/CCFF00 readiness, V7 creator foundation, NFT mint preflight | RELEASE-LOCKED FUTURE / TEST EVIDENCE | Preserve explicit activation locks. No Proof of Holding, Distribution or mint execution in this PR. |

`UNKNOWN` applies to account-specific activation/usage not observable in this audit; source presence or a secret name cannot establish live financial use. No historical system is deleted. [Static call inventory](evidence/2026-09-30/rpc-source-calls.json) keeps dormant call locations visible for a later cleanup task.

## 10. Cost and scale model

Account-specific current invoices, negotiated quotas and billable resource averages were unavailable. Published list prices below are dated2026-09-30 and are **not** approval to change plans. Preserve existing Vercel Pro/$20 budget/pause controls, all service sizes and existing provider subscriptions.

| Provider | Authoritative public information | Main cost lever / unknown |
| --- | --- | --- |
| Alchemy | [Pricing](https://www.alchemy.com/pricing): Free30M CU/mo,25RPS/500CU/s; PAYG$0.525/M CU,300RPS/10,000CU/s. Extra5,000CU/s capacity listed$160/mo. | Account plan unknown; Free10-block logs conflicts with current chunks. [Method CUs](https://www.alchemy.com/docs/reference/compute-unit-costs): head10, block/code/balance/receipt20, call26, logs60. HTTP batch sums methods. Older pricing FAQs differ; use current pricing page, confirm account before budgeting. |
|0x | [Free~5RPS](https://docs.0x.org/docs/developer-resources/rate-limits); exact app billing/limits unknown | Wallet-specific active quote traffic scales with active tickets; no cross-wallet response cache. Analytics read reporting can aggregate app data later. |
| Gecko / CoinGecko | [Gecko public30/min](https://apiguide.geckoterminal.com/faq). [CoinGecko pricing](https://www.coingecko.com/en/api/pricing): Demo10k/mo100/min; Basic$35 monthly100k/mo300/min; Analyst$129 monthly500k/mo500/min; endpoint/license eligibility must be checked. | RMT uses public Gecko, not proof of a paid CoinGecko plan or equivalent endpoint quota. Shared hot-key reuse dominates; do not purchase here. |
| OpenSea | [Permanent key quotas are header/account-specific](https://docs.opensea.io/reference/api-keys), unknown without legitimate credential | One project-scoped observation can serve many UI users; pages/orders/retries, not user count, drive upstream ingestion. No fabricated credential/pricing. |
| Vercel | [Pro plan](https://vercel.com/docs/plans/pro-plan); [included usage is credit-based](https://vercel.com/changelog/included-pro-usage-is-now-credit-based) | Existing project plan/budget preserved. Actual region/CPU/memory/request/egress charges and invoices not read; no invented monthly user price. CDN/Data Cache hits reduce function/upstream work. |
| Railway | [RAM$10/GB-month,CPU$20/vCPU-month,egress$0.05/GB,storage$0.15/GB-month](https://docs.railway.com/pricing); compute metered by minute | Actual project plan/averages/storage/egress unknown. Worker cost depends on chain backlog/observations and API demand, not one worker per user. Safe watch scope reduces needless restart/build work. |

Quantitative assumptions:100/1,000/10,000 daily users, one10-minute session/user/day, ten native+ERC20 balance refreshes, illustrative3RPC requests/refresh (one native + bounded balance/metadata aggregate),25% of session with active ready ticket,9s cadence≈17 preparation cycles, one20-read1H chart. Source `trade-intent-composer.tsx` automatically renews read-only preparation through `startTrade()`, which obtains a fresh price **and firm quote** before authorization preparation;17 ready cycles therefore model34 provider calls, not just17 prices plus one user-click quote. Price-only/not-ready states differ; explicit clicks, approvals and retries add calls. Not all users trade; quotes are read-only. Public-account/firm responses cannot be shared across takers.

| Users/day | Balance RPC/day /30d CU at26 average | Illustrative PAYG CU price, excludes workers/egress |0x requests/day (17 paired cycles/user) | Gecko unshared/day |
| --- | --- | --- | --- | --- |
|100 |3,000 /2.34M |$1.23 |3,400 |2,300 |
|1,000 |30,000 /23.4M |$12.29 |34,000 |23,000 |
|10,000 |300,000 /234M |$122.85 |340,000 |230,000 |

The26CU average is a model, not a claim every RPC is eth_call. Shared worker loads are additional and may dominate: the example market enrichment4.717M calls/day at26CU average≈3.68B CU/30days (~$1,932 list PAYG), versus idle market155,520/day at20CU≈93.3M (~$49). This wide range is why actual selected-pool/token counts, fallback counts and provider billing telemetry are needed before a plan decision. Retries/batch CU rules and peak throughput can change cost materially.

For simultaneous users with10% active ready tickets and two provider calls per9s renewal:100→~2.22RPS,1,000→~22.22RPS,10,000→~222.22RPS, plus edits/clicks/approval retries. A Free5RPS assumption is unsuitable at higher concurrent activity even when daily averages look low. Do not increase cadence or share wallet-specific commitments to solve quotas. This source-derived offered-load estimate does not claim those request counts were measured in production.

Railway illustrative resource formula per service: average memoryGB×$10 + averageCPU×$20 + egressGB×$0.05 + volumeGB×$0.15/month, before plan minimum/credits/taxes. Actual metrics were not read; no promised cost savings. Vercel bill requires observed cache misses, duration/CPU, response/image bytes and regions; user counts alone cannot give an honest dollar figure. OpenSea/API permanent quotas remain unknown.

### One observation → many users

Shared chain heads/checkpoints, project-scoped indexed events, chart/pool/info keys, artwork and OpenSea project observations can serve many users. Portfolio balances/history need wallet-qualified keys and freshness; economic eligibility needs deterministic RMT evidence. Quote/auth tokens and executable commitments remain private, taker-bound and fresh. No circular cache/provider authority.

## 11. Recommended next implementation and release gates

1. Obtain **supported owner-authorized access to an existing Alchemy4663 credential/plan** through secure tooling, not chat. Run the identical bounded method/archive tests plus WS reconnect/log replay and the configured log ranges. No production switch until equivalence, quotas and rollback are reviewed independently.
2. Measure shared Gecko/cache429 and market-indexer per-cycle enrichment/fallback counts using existing diagnostics/logs. If measured quota pressure persists, implement the scoped shared presentation cache/budget design above using existing infrastructure, without touching trade authority.
3. After Portfolio scope is approved, pilot Transfers/Address Activity and0x Trade Analytics as observation/reporting inputs; retain RMT settlement/ownership/economic evidence. No Proof of Holding/Distribution shortcuts.
4. Adopt reviewed NFT watch scopes through a later authorized configuration action; keep PR553 and all infrastructure activation separate. Do not redeploy unchanged source to prove this audit.

For this PR: all path-triggered checks must complete on the exact head. Railway JSON, this documentation/evidence, the source-scope test, its CI invocation and an exact public-address/file scan exception change. Runtime packages/handlers remain byte-identical to base. Local `pnpm check:repo` passed, with three existing advisory configuration hints. Browser/visual/0x/terminal workflows whose path filters do not match this diff are **NOT_TRIGGERED**, not claimed as passing. No acceptance suite is removed or waived. See the PR's exact-head checks for actual results rather than predicting a17-check count.

### Exact-base security blocker observed during CI

At the initial PR head, web stopped at unchanged `pnpm audit:production`: [GHSA-m9gg-hp2v-232j](https://github.com/advisories/GHSA-m9gg-hp2v-232j), published to GitHub's advisory database on2026-09-30, reports two high-severity vulnerable `@grpc/grpc-js` dependency branches through Firebase. A bounded local audit reproduced the failure. Root package and lockfile blob IDs are identical to authorized base (`131d0bdf4e4f0af28daaf14dc0d429734cbafd7a`, `45347b2fc599250dc921eebe7f5e1f1c1389baa8`), so this is not a watch-scope/runtime regression. The audit check stays enabled; no waiver/retry can repair vulnerable versions.

Smallest proposed source delta, **not applied without owner authorization beyond the watch-scope implementation boundary**: root overrides `@grpc/grpc-js@<1.13.6 → 1.13.6` and `@grpc/grpc-js@>=1.14.0 <1.14.5 → 1.14.5`, plus corresponding lockfile resolution. No Firebase/Privy SDK upgrade or production configuration change is proposed. This would broaden dependency-triggered CI and worker watch implications; run the full affected checks if approved. Until then exact-head CI cannot honestly be reported all green.
