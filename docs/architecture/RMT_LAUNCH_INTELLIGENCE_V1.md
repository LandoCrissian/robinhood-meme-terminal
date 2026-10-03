# Robinhood Chain launch intelligence

Authorized base: `181ecb3f48f6671bcaa169c6029563ab0e67950b`. Owner authority: `RMT_LAUNCH_INTELLIGENCE_PONS_STONKBROKERS_V1`.
No merge, deployment, production database/configuration writes, infrastructure provisioning or financial actions. PR553 is separate.

## Findings recorded before implementation

- Main matched the exact authorized base; no matching PR/worktree existed.
- Existing `apps/market-indexer` has the Railway service, dedicated PostgreSQL database, RPC, server-only read token, bounded block batches and single worker timer. It is the appropriate existing host for launch history.
- Dormant `apps/external-origin-indexer` has typed origin manifests/replay but an empty activation-locked production adapter registry. Railway inventory has no external-origin service/database. None is provisioned or activated.
- Existing web Pons V2/Stonk request-time readers remain compatibility readers, not canonical durable launch history. The older Stonk reader covers one pad rather than the complete current set.
- Separate launch tables are independent of pool admission/catalog reaping. Project Graph and NFT ownership remain independent authorities.
- VNext already owns exact-token initialization, progressive enrichment, LAUNCH taxonomy, Explore and the sole execution controller. PR561 URL handoff is reused, with no alternate terminal/composer/executor.
- Artwork uses the existing bounded raster proxy/cache. The latest provider-native 0x owner law supersedes older general route/runtime/simulation requirements; no execution consumers change.

## Implemented authority and path

Official documentation, deployed address/runtime hashes, documented ABIs and positive creation/enrollment events establish launch provenance. Source phases are retained beside normalized lifecycle states. Names, tickers and provider labels never establish origin. Existing-token pad enrollment is `TOKEN_ENROLLED`, never inferred token creation.

The existing worker invokes one isolated live launch cycle after canonical work. A separately bounded sequential historical lane now catches up independently; [throughput correction and evidence](RMT_LAUNCH_HISTORICAL_THROUGHPUT_V1.md) records its budget, fairness, preemption and review boundary. Six logged durable tables retain source fingerprints, events, live/history checkpoints, lifecycle observations, independent identity observations and refresh attempts. Pool migrations/rescans remain independent. No production data is inserted here.

A PostgreSQL advisory lock prevents concurrent producers. The ordinary cycle reads at most one aligned live range and one descending-history range. Between ordinary cycles a bounded sequential lane processes additional history, rotating source groups and coalescing equal cursors/address/event signatures. Each range uses the existing batch ceiling (default 5,000 blocks), a smaller contiguous range when the history work quota requires it, and the unchanged confirmation setting (default 20; a finality assumption). Event persistence and cursor advancement commit atomically after hash checks. Identical events deduplicate; conflicting replay rejects. Reorgs remove affected events/observations/proofs to a retained canonical checkpoint before replay. Deeper reorgs halt advancement rather than invent an ancestor.

Runtime/quote proofs are shared for one hour per producer, including Lens runtime. Source fingerprints require explicit reviewed migration for changes. These are intelligence proofs, never per-trade requirements. One lifecycle observation is selected fairly per cycle: five-minute success cadence and one-minute failure retry. Optional identity enrichment batches at most 25 tokens/four fields through existing Multicall3, potentially split by viem's 8,192-byte bound. Successful categories retain individual block/hash/time; failure never erases another category. No supply certification or pool prerequisite.

Authenticated endpoint: `GET /v1/launches`, using the existing read token and bounded exact-token/source/text/scope-bound cursor reads. Web validates chain 4663, registered source/address/generation, provenance, units and response bounds before publishing `/api/vnext/launches`. Existing `RMT_MARKET_INDEXER_URL` and read-token settings are reused; no new production credentials.

`/launches` is Markets → Explore → Launches. The owner discovery-chassis amendment is implemented with compact scanner rows using Markets artwork, typography, separators, search and touch rhythm. Each row shows identity, source/version, factual lifecycle and one observed metric; complete contracts/transactions/observation remain in the selected token workspace under More → Launch origin → Evidence & Sources. Discovery has no per-row evidence/action stack or large progress panels. Filters appear only when records justify them. Graduated launches do not show a fluctuating current Lens market-cap ratio as incomplete historical graduation. Pons V1 principal thresholds remain distinct from V2 curve migration.

Selection links to the existing terminal with exact `market`/`launch` identifiers. Authenticated identity is seeded without waiting for directory admission. Index failure still initializes the exact-address destination shell. More/Origin reads optional intelligence independently of chart/trade/wallet. Text search supplements stronger existing results using onchain units; exact-contract search is unchanged. Unknown units are never defaulted. Project links require independently admitted exact-contract Project Graph evidence.

Artwork uses existing canonical project precedence and the bounded proxy/cache. Pons `logo()` is an onchain presentation observation, not project-official art or execution authority. HTTPS/DNS pinning, raster signatures, size/timeout/redirect bounds and existing IPFS gateway handling apply. No arbitrary image search or OpenSea dependency. Failure falls back cleanly.

## Official scope and genuine evidence

- [Pons V1](https://docs.ponsfamily.com/), [V2](https://docs.ponsfamily.com/v2), [official source](https://github.com/ponsdotdev/pons-labs), pinned `44a3db9193c365f6c25cf0d4c2efc396e6de0df5`.
- [StonkBrokers deployed integration/ABIs](https://stonkbrokers.wtf/developers), [Smart Launch docs](https://www.stonkbrokers.cash/docs).

Admitted: current/legacy Pons V1, current Pons V2, all nine original Stonk Smart Launch V2 pads and nine r2 pads, plus read-only Lens. Stonk prose says eight original pads but its complete address table lists nine. See [contract verification](evidence/launch-intelligence/official-contract-verification.json).

All 21 sources and Lens had nonempty deployed runtime at block 78,253,528, with recorded hashes. Required signatures/views and sampled positive events agree. This establishes deployed-address/runtime/view/event compatibility, **not** a compiled source-to-bytecode reproducible build. Explorer access returned 403; older historical `eth_getCode` returned historical-state-unavailable. Neither means absence.

Other documented Router/ClockInCard/Kickstarter contracts are not origin producers/executors. The separate older StonkLauncher/native pad and other historical Pons V2 stacks are outside current Smart Launch semantics; no generation is guessed.

Two deterministic fixtures retain ten genuine creation/enrollment records and external read boundaries, plus ten genuine normalized source observations through the changed producer at block 78,308,700. Samples cover current/legacy Pons V1, Pons V2, original Stonk WETH/STONK and WETH r2, bonding/graduated states. All ten live source observations succeeded. Five Pons samples had actual IPFS logos; Stonk logo reads were unavailable and none was invented. Empty pads are not fabricated into cards.

The actual producer ABI successfully queried a 21-address/event union over blocks 78,248,500–78,248,600: two Pons V2 events, 203 ms. [Machine-readable read](evidence/launch-intelligence/coalesced-log-read.json). No financial RPC methods.

## Validation and limitations

Disposable loopback PostgreSQL regression uses the real migrations/store/authenticated HTTP endpoint/web validator/token seed, replaying genuine records at external RPC boundaries. It covers category retention, pool migration/restart, dedupe/conflict, scoped pagination, provider recovery, worker reorg rollback, deep-reorg halt and concurrent producer locking. This is not production data readiness.

Rendered acceptance uses real Next components/routes at 375/390/430/1440 with genuine captured identities/origins replayed at the existing external service boundary. Degraded-provider fixtures are labelled. Screenshots/video belong in CI artifacts, not Git. Physical iPhone and owner-authenticated financial acceptance remain untested.

Original implementation estimate (historical): default poll was five seconds; two catch-up ranges implied at most 1,440/hour independent of pad count before ordinary work duration. The independently bounded historical lane replaces that scheduling assumption; see the throughput correction for measured capability, limits and conditional estimates. Ordinary lifecycle observation/metadata cadence and hourly runtime proof semantics remain unchanged. No long-term bill is inferred from the bounded benchmark.

A 78-million-block history at 5,000/range is approximately 15,600 ranges. V1 documented start blocks are retained. No authoritative current V2/r2 deployment start block was established; zero is conservative, not a claimed deployment date. UI/API expose partial history/scanned bounds. The historical throughput correction has no deployment authorization; source review and separately authorized production observation must confirm its sustained operating envelope.

Canonical history/checkpoints are database-shared. Runtime proof/web caches are optimizations; web instances can still independently read the shared endpoint. Browsers never discover RPC logs. Lifecycle/market-cap observations may be delayed. Origin does not establish quality, 0x route availability, Project/NFT admission or economic authority.

## Separately authorized release

Existing market service first; verify migrations/durable state/authenticated `/v1/launches`; web second. No new service/database/variable/executor. Watch scopes cover market source, shared launch interface and shared manifest/lockfile; NFT workers can legitimately trigger on shared build inputs. No deployment, restart or configuration mutation here. PR553 untouched.
