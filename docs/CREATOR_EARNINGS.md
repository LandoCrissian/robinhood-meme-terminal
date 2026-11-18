# Creator earnings

Tasks 074–075 add `/my-launches/earnings` and isolated wallet-profile acceptance to the existing website. It discovers projects related to an exact beneficiary address, then separately verifies contract balances. Browsing requires no wallet connection or Firebase session. This development branch has not been deployed to the production website or indexer. No production PostgreSQL schema, writer, credentials or resource plan was changed. [Task 075 profile, settlement and evidence boundaries](PRODUCTION_CLAIMS_ACCEPTANCE.md)

## Accounting and identity

Discovery matches all four immutable roles: creator, independent project treasury, Operations and Reserve. An address may have multiple roles; its ledger credit is counted once. A Safe's credit belongs to the Safe, not to its owners. A matching historical creator address is not proof of a current fee entitlement.

Each new-engine record carries chain, factory, registry, token, original curve/revenue ledger, creation transaction/log, block hash and checkpoint. The fixed 1-billion supply and committed treasury denominator remain unchanged. Same-token migration keeps the **original curve revenue ledger**: `originCurve`, current factory/registry routing and the ledger's `activeCurve` are reconciled rather than replacing old credits with a successor's empty balance.

On-demand reads verify birth receipts, runtime/deployment pins, policy and beneficiary credits at a canonical checkpoint. Production reads require matching independent provider results. Claimed totals use the beneficiary's accrued buckets minus current claimable credit, not a global claimed amount attributed to each recipient. ETH and token amounts stay separate. Unsupported evidence is unavailable, never an assumed zero.

A recorded creation overpayment does not erase the project's beneficiary relations. Its refund event is registration evidence; independently proving payment/refund settlement still requires exact native-transfer evidence. Discovery never labels that refund settled.

LP balances come from the ledger for the original locked position. Its complete PoolKey, position owner, permissions and principal liquidity are checked. Gross fees awaiting collection are distinct from distributed, claimable and already claimed credits. Other liquidity providers' fees are excluded. Creation fees have one factory-wide Operations payout; this amount is excluded from project totals and is never multiplied by project count.

## Read interfaces

| Interface | Purpose and boundary |
| --- | --- |
| `GET /api/launchpad/earnings?recipient=ADDRESS&after=CURSOR` | Public website discovery; ten registrations per page. Responses are private/no-store. |
| `GET /api/launchpad/earnings/TOKEN?recipient=ADDRESS` | Independently checked contract snapshot for that beneficiary/project. |
| `GET /api/launchpad/earnings/factory?recipient=ADDRESS` | Factory-wide creation-fee payout and immutable receiving Operations address. |
| `GET /api/launchpad/earnings/history?recipient=ADDRESS&after=CURSOR` | Separate historical relations. Historical fee execution and balance adapters remain unsupported. |
| `GET /curve-earnings?recipient=ADDRESS&limit=25&after=CURSOR` | Authenticated Railway-facing new-engine discovery on chain 4663. Not deployed by this task. |
| `GET /historical-launches?recipient=ADDRESS&limit=25&cursor=BLOCK.LOG` | Existing authenticated V6 API, extended with original/current creator and protocol-treasury matching. Default responses remain compatible. |
| `GET /earnings?...` and `/earnings/activity?transaction=HASH` | Explicit chain-31337 fixture worker only, authenticated with its existing local read key. |

New-engine discovery uses `schemaVersion: 1`, profile `rmt-creator-earnings-v1`, deployment/checkpoint evidence, `beneficiaryRoles`, `feeEvidence: contract-read-required`, and `nextCursor`. Exact-token lookup uses `token=ADDRESS&limit=1`; token lookup and pagination cannot be combined. The production and fixture cursor/chain profiles are separate.

Historical V4 snapshot relations and paginated V6 records are displayed separately. Their policy is not relabeled as the new 90/5/5 policy. Historical responses require bounded checkpoint and registration evidence; missing, malformed or expired observations become unavailable, and aged evidence remains stale. No historical balance is invented.

## Durability and limits

The existing leased writer and registration/checkpoint store remain authoritative. Recipient discovery reads existing JSONB registration fields; it introduces no production table or runtime DDL. Task 075 separately proposes versioned claim-evidence tables and a bounded hook for that same writer. The schema is uninstalled in production, initialization refuses missing tables, and no second writer/scheduler was created. Existing registration ingestion handles exact duplicate replay and conflicting identities. Reads use PostgreSQL `REPEATABLE READ READ ONLY`, a one-second statement timeout and existing authenticated read budgets.

New-engine cursors bind deployment, recipient and a retained canonical block/hash. Later blocks do not invalidate a cursor merely because the tip advanced. Later pages exclude creations above the original anchor. A reorg or restore that removes that anchor invalidates the lookup; the caller must refresh. Aging pages are stale, not silently current. Cursors survive process/browser restart if retained and still canonical; the page can also repeat a lookup from the durable store.

- Indexer discovery: 1–50 records per page, with one bounded lookahead; opaque cursors are at most 768 characters. The website requests ten records per page.
- Production registration ingestion: at most 128 registrations in each bounded 2,000-block range. Exceeding this limit fails closed; it is not a 128-project product limit.
- Local fixture lifecycle: at most 128 projects. Fee activity: at most 16 rows for one transaction hash.
- Website upstream JSON: 192 KiB maximum, four-second fetch deadline. Website reads have a per-instance budget of 30/minute and two concurrent requests; the backend retains its separate authenticated budget. These are not a distributed visitor quota.
- ABI reads: each reader helper permits at most 128 calls and four concurrent calls. Context verification uses its own reader plus a fixed number of code, block, balance and receipt reads; this is not a 128-total-RPC request cap. Measured successful fixture paths use 51 RPC methods for a curve snapshot, 77 for a graduated snapshot and 20 for a factory-wide balance, per provider. Production corroboration doubles these counts before discovery reads. Transport batching/caching may differ. Projects are checked individually; no eager all-project contract scan runs. Totals exclude unchecked projects, token balances and factory creation fees.
- The phone UI retains at most 100 registrations per reading window. Continuing uses the canonical next cursor rather than silently ending discovery. Refresh returns to the beginning.

The PostgreSQL tests exercise 53 new-engine registrations per store and 30 historical recipient matches. They do not establish production-scale performance. JSONB recipient filtering has no newly installed production expression index; larger cardinality/load acceptance and any reviewed index installation remain separate operational work. No polling worker or parallel scheduler was added. [Sanitized PostgreSQL evidence and CI correction](evidence/rmt-task074/indexer-postgres.json)

## Synthetic claims and recovery

Only the explicit loopback chain-31337 configuration admits `POST /api/launchpad/test-earnings`. It supports curve claims, LP collection, combined/native-only/token-only LP claims, and factory creation-fee release. Production `/api/launchpad/production-earnings` remains a hard-disabled 404; an environment flag cannot enable it.

Task 075 adds `POST /api/launchpad/test-claim-profiles` under an additional exact local-only profile flag, origin and deployment binding. It prepares/revalidates unsigned EOA, pinned MetaMask EIP-7702 and SafeL2 1.4.1 reviews and reconciles receipts. There is no chain-4663 branch or RPC URL/signing-key parameter. Production routing/startup rejects this local test configuration; no public route can activate real claims.

Review binds signer, chain, deployment, target runtime, beneficiary, calldata, nonce, amounts, position identity and deadline where applicable. Account/chain changes invalidate review. Recovering a submitted request reconciles its original transaction and never asks automatically for another signature. Missing or malformed native transfer traces keep settlement pending. A fee event or advanced checkpoint alone is insufficient.

The local writer stores canonically verified curve/factory/LP fee activity in its fixture-only table; duplicate receipts are idempotent, conflicting identities fail, and reorg rollback removes orphaned activity. Claim recovery reports `indexed` only after matching this exact activity identity, amounts and canonical checkpoint. An empty activity response is indexing-pending, not proof that no payment occurred.

Migration-aware fixture registration verification preserves original-ledger discovery and original-ledger claim ingestion after reviewed V2/V3 transitions. A separate bounded receipt verifier binds successor graduation to its current and previous canonical route, runtime history, original ledger, actual starting reserves, funded pool and locked position. It persists that actual graduation in the existing store so LP fee collection and claims use the same canonical activity path. It does **not** fabricate a V1 trading state for a successor: readiness still reports unsupported successor trading separately. Unsupported execution envelopes or missing proofs remain unavailable/indexing-pending.

Safe beneficiary accounting is supported. A browser EOA claim cannot impersonate its Safe. The older direct fixture adapter still rejects delegated and Safe execution; Task 075 provides separately bound profiles for the exact MetaMask delegate and SafeL2 1.4.1. Safe inner proposals require two genuine EIP-712 owner approvals before an outer `execTransaction` envelope is available, with a separate gas payer and EVM nonce. The local acceptance executes actual contracts with ephemeral test keys. This does not establish physical-phone, hosted Safe or production claim acceptance.

`prepareUnsignedProductionEarningsReview` remains the older internal nonbroadcast adapter; its execution-only estimate excludes unverified L1 data fees. The Task 075 `prepareProductionClaimExecutionReview` supplements it with exact wallet profiles, dual-provider review corroboration, transaction-specific simulation and verified Nitro L2/L1 fee components or an explicit refusal. Both return `executionEnabled: false`. No production HTTP signing/broadcast route was added, `/api/launchpad/production-earnings` remains 404 and the browser sender rejects chain 4663.

The new read-only production-shaped settlement adapter distinguishes receipt observation, canonical L2 evidence, indexing pending, revert and unavailable. Exact native/token transfer evidence and a canonical indexed row are required; a checkpoint/event alone cannot establish settlement. No production Ethereum L1 finality policy is implemented, so chain 4663 cannot report `settled`. Local settled results require an explicitly named synthetic checkpoint policy. An original payer/nonce may recover a missing hash without another signature/send. The actual 4663 probes verify deployed bindings, not an existing new-engine claimant or a real claim. [Complete acceptance matrix and remaining gates](PRODUCTION_CLAIMS_ACCEPTANCE.md)

## Reproducible checks and release status

Run from the repository root with Node 22, pinned pnpm and frozen dependencies:

```sh
pnpm --filter indexer typecheck
pnpm --filter indexer build
pnpm --filter indexer test:resilience
pnpm --filter @rmt/launch-website exec tsx --tsconfig tsconfig.test.json --test lib/server/earnings-data.test.ts lib/server/earnings-contracts.test.ts lib/server/earnings-claims.test.ts
```

For PostgreSQL checks, use fresh, empty, loopback-only scratch databases. `DATABASE_URL` must name `rmt_curve_production_smoke_*` for `pnpm --filter indexer test:curve-production`; `RMT_EARNINGS_SMOKE_DATABASE_URL` must name `rmt_curve_fixture_task074_smoke_*` for `pnpm --filter indexer exec tsx src/curve-fixture-earnings-postgres-smoke.ts`. Run the existing isolated schema smoke separately for historical relations. These tests must never point at Railway or a reused database.

The connected same-app browser command is:

```sh
node scripts/visual-qa/rmt-creator-integration.mjs \
  --browser chromium \
  --anvil /path/to/anvil --solc /path/to/checksum-verified-solc-0.8.26 \
  --pg-bin /path/to/postgresql/bin \
  --mobile-plan docs/evidence/mobile-signing/review-plan-4663.json \
  --output /new/isolated/evidence-directory
```

Use `--browser webkit` for the other browser engine. An explicit `--successor-only` selects just the supplemental operator migration/LP proof for focused diagnostics; it does not establish browser acceptance. CI runs the complete journey for both engines.

The command requires website/indexer builds, pinned contract dependencies and the existing historical evidence anchor. It creates synthetic assets and a disposable local PostgreSQL cluster. Recorded local evidence includes 112 Foundry tests, 140 website tests (including 42 focused adapter and ten discovery/history cases), 53/53-registration PostgreSQL checks, historical 30-registration recovery, and the connected 24-transaction browser lifecycle with separate mobile-review tests. Supplemental successor acceptance and final CI results are recorded in the draft PR and evidence below; an earlier failed run is not counted as passed. These are separate coverage boundaries, not an independent audit.

The supplemental successor run passed with 19 separately identified fixture-operator receipts: genuine two-signature/timelocked V1→V2→V3 migration, original-ledger claims, V3 graduation, official 2.1.2 router buys/sells, LP collection/claim, durable restart and reorg restoration of fee credits, with principal unchanged. The actual run exposed a one-based registry-history reader bug, which was fixed along with its incorrect test model. A separate fixture deadline drift was fixed by binding Permit2 and the router to one deadline; the indexer's strict allowance checks were preserved.

[Sanitized receipts, amounts and database identities](evidence/rmt-task074/acceptance.json) · [Unchanged compiler/source and security report proof](evidence/rmt-task074/frozen-source-and-slither-proof.json) · [Portrait](evidence/rmt-task074/earnings-portrait.png) · [Landscape](evidence/rmt-task074/earnings-landscape.png) · [Desktop](evidence/rmt-task074/earnings-desktop.png). These screenshots use synthetic data. Raw lifecycle JSON and screenshots are retained as CI artifacts; they contain no PostgreSQL cluster or private credentials.

Production financial execution remains blocked. Preserve the 22 high static-analysis findings and failed release gate, governance notice, separate owner release approvals, provider/trace and L1-finality requirements. Production responses describe L2-confirmed observation with **L1 finality unverified**; local receipts are synthetic and have no L1-finality claim. Physical iPhone earnings acceptance is unverified. Website publication, production indexer rollout, Firebase activation and financial execution each retain their own authorization boundary. No contract, custody or economic change is included.

Task 075 implements the exact EIP-7702/Safe preparation profiles and proves them with synthetic execution; its final browser/CI results are recorded separately in the [production-claims acceptance package](PRODUCTION_CLAIMS_ACCEPTANCE.md). The next acceptance stages remain separate: review this draft and its evidence; authorize any website/indexer/schema rollout within the existing hosting constraints; accept production provider/trace, finality, recovery and monitoring requirements; complete physical-wallet acceptance; resolve the retained security gates; then obtain explicit financial activation approval. No environment flag alone constitutes any of these approvals.

[Treasury policy](CREATOR_TREASURIES.md) · [Release acceptance](RELEASE_ACCEPTANCE.md) · [Deployment](DEPLOYMENT.md) · [Security findings](SECURITY.md) · [Existing Railway migration boundary](RAILWAY_LAUNCHPAD_MIGRATION_AND_RETIREMENT.md)
