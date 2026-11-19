# RMT Reclaim acceptance

[Task 078](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/671#issuecomment-6994244524), stacked on #671 at `8d1876daed6449e40388166255f52f13f3c488dd`. **LOCAL DEVELOPMENT ONLY / BLOCKED_NO_BROADCAST.** Contract regressions, source boundaries, the isolated PostgreSQL smoke, public read-only browser checks and a bounded read-only 4663 observation have completed below. The connected Reclaim execution journey and exact-head CI remain **pending** and must be added from actual runs before final handoff. Workflow wiring is not test execution.

## Product and custody decision

Reclaim is a bounded token-launchpad companion, not an NFT marketplace or general terminal. A campaign has its own manually funded reward-token reserve and explicitly admitted finite NFT eligibility. It does not draw automatically from creator earnings, Operations, Reserve, LAMMB royalties, project treasuries or LP principal.

| Decision | Implemented boundary | Live approval still required |
| --- | --- | --- |
| Default custody | **Reversible escrow receipt**, with actual ERC-721/1155 safe receipt and immutable claimant/item/quantity/original-reward evidence. | Actual eligible collections, NFT issuer powers and custody policy. |
| Burn/sink/permanent retirement | **Not implemented.** Transfers are not burns. No administrator may transfer or burn accepted NFTs. | Separate policy, authority and reviewed implementation; never implied by this receipt. |
| Returns | Original claimant repays the exact original reward units and receives their own complete receipt's NFTs. Lifetime caps/eligibility remain consumed. | Disclosure of repayment/gas/external-NFT risks. |
| Reward mode | Fixed token units; USD quoting always fails closed. Every NFT acceptance and reward payment is atomic and funded first. | Actual RMT identity, funded balance, fixed-unit campaign approval or a defensible conversion policy. |
| Owner actions | Immediate pause; noticed collection/rate/close/recovery/controller actions, epoch-bound authorizations and incoming-controller acceptance. | Controller/key-continuity responsibility and production activation. |
| Recovery | Only uncommitted reward reserves after close and a fresh notice, paid to the same controller. No arbitrary NFT rescue/drain. | A separately authorized real transaction. |

Unsolicited safe NFT receipts reject. Unsafe forced NFTs, foreign tokens or forced ETH may be stranded and generate no reward. NFT runtime/ERC-165 checks do not universally establish non-upgradeability, authenticity, scarcity or freedom from issuer seizure/burn/blacklisting. Live collection admission requires review of the actual collection authority and precise token-ID/quantity policy. No metadata is treated as eligibility or instructions.

## Units, reserves and anti-abuse

The owner's $20 initial target and $0.05 per eligible unit are **nominal intended equivalents**, not a live price or funded reserve. The isolated model explicitly assumes one synthetic RMT equals $0.01: 2,000 synthetic tokens fund five tokens per accepted NFT unit, for 400 units. It does not create a real RMT token or claim that those token amounts equal dollars in production. A future $0.50-equivalent setting needs funding and separate approval.

The reserve equation is `funded + repaid + unsolicited = reserve + paid + recovered`. Rewards are paid immediately; there are no unsecured credits or accepted-but-unpaid NFTs. Actual token balances are checked independently. Unreconciled gifts are distinguished from manual funding and do not become invented creator earnings.

Each proof binds chain, campaign, collection/runtime, standard, token ID and maximum lifetime quantity. Proofs have at most 32 siblings, a redemption at most eight sorted unique IDs/twenty units. Per-wallet, wallet/collection, collection, token-ID, claimant nonce, policy epoch, exact reward and deadline checks bound acceptance. Returning an NFT does not reset its eligibility or caps. A wallet cap alone cannot defeat Sybil activity; finite owner-reviewed eligibility is essential.

## Source and verification completed so far

All **47 previously tracked Solidity files** match the Task 077 Git blobs and compiler source bytes. Existing curve/v4, token supply, 600M/400M allocation, 90/5/5 entitlements, treasury modules and governance notices remain unchanged. [Frozen-source manifest](evidence/rmt-task078/frozen-source-manifest.json).

The independent three-source Reclaim compiler closure is **`d3596a541f62f25e579e7f8186e017f678a297f454423a4fa9984c898e720471`**, solc 0.8.26/Cancun/viaIR/200 runs/IPFS metadata. Campaign runtime/initcode are **21,278/22,318 bytes**; factory **24,009/46,986**, with **47,050 encoded factory initcode bytes**. Runtime headroom is only **567 bytes**; changed source/constructors require new size verification.

Executed contract checks: **37 Foundry tests passed**, including two 512-run fuzz tests and a 128×32/4,096-call stateful custody/accounting handler. These cover real fixture ERC-721/1155 custody/reward/returns, reserve exhaustion, caps, epoch/nonce/deadline failures, controller/notice lifecycle, unsupported/unsafe receipts, malicious tokens/callbacks and rollback. **Six security-evidence Node tests passed.** These are synthetic local tests, not physical-iPhone acceptance, live financial evidence or an independent audit.

Fresh complete-closure Slither 0.11.5/Crytic Compile 0.3.11 runs **all 101 detectors**: initial **32 findings**, current **28 findings** (**four high, one medium, eighteen low, four informational, one optimization**). The strict Reclaim gate **fails**. Four exact-balance high IDs remain unchanged. Legitimate checks/effects/interactions changes reduced two medium/two low observations while preserving exact delta checks. [Every finding, dataflow, test and uncertainty](RMT_RECLAIM_SECURITY.md); [raw reports and inputs](evidence/rmt-task078/security/).

The earlier **22 core/dependency highs plus six treasury V1 highs** and their failed gates remain visible. The nonspending treasury purchase prototype remains NO-GO. New Reclaim findings do not clear old findings, and no detector or assertion was suppressed.

## Retained regressions and dependency audit

The unchanged suites ran locally with Forge **1.7.1**, pinned native solc **0.8.26+commit.8a97fa7a** and their existing Foundry settings. Source snapshot: `306f8f1b3d7ebd60db1906d92a283d43849bfd86`. [Results, tool bindings and log hashes](evidence/rmt-task078/regressions/summary.json); raw test output is retained in the same directory. Text evidence is normalized from CRLF to LF only; no database cluster or credentials are included.

| Suite | Passed / failed / skipped | Fuzz and invariant evidence |
| --- | --- | --- |
| Retained core | **112 / 0 / 0**, fourteen suites | Five × 512 fuzz cases; 64 × 32 / 2,048 accounting-handler calls. |
| Treasury V1 | **23 / 0 / 0** | Three × 512 fuzz cases; 128 × 32 / 4,096 accounting-handler calls. |
| Purchasing V2 prototype | **30 / 0 / 0** | Three × 512 fuzz cases; 128 × 32 / 4,096 handler calls. This does not enable purchases. |
| Reclaim source/security evidence | **9 / 0 / 0** | All 47 prior Solidity files and the separate compiler/static-analysis boundaries match. |

Core compilation took 259.05 seconds and tests 1.54 seconds on this Windows run. Existing test-only `selfdestruct`/mutability warnings and Forge optional invariant-target introspection warnings remain in the logs. They were not suppressed. This run does not replace earlier platform-specific or opt-in evidence, a fresh 4663 fork lifecycle, or an independent review.

No-change pnpm **10.12.1** audits: [`pnpm audit --prod --json`](evidence/rmt-task078/regressions/pnpm-audit-production.json) returned **zero advisories across 226 dependencies**, exit 0. [`pnpm audit --json`](evidence/rmt-task078/regressions/pnpm-audit-full.json) returned **four moderate advisories across 843 dependencies**, exit 1: `uuid`, `@opentelemetry/core`, `glob` and `minimatch`, each reachable through the root development dependency `firebase-tools`. No high/critical dependency advisory was reported in these runs. No auto-fix, lockfile change or contract-static-analysis clearance is implied.

## Isolated PostgreSQL and public browser checks

The [PostgreSQL smoke](evidence/rmt-task078/postgres-smoke.json) passed on **PostgreSQL 18.6**, using a separate loopback-only synthetic database, with exit 0. Its scope explicitly excludes production and a deployed worker. This short smoke report does not by itself prove the complete connected Reclaim receipt/restart/reorg journey.

The actual loopback read-only website passed [Chromium](evidence/rmt-task078/public-chromium/reclaim-public.json) and [WebKit](evidence/rmt-task078/public-webkit/reclaim-public.json) checks in desktop, phone portrait and landscape layouts: no horizontal overflow, keyboard reachability, editable phone text at 16px, no browser errors and **zero wallet, external or financial requests**. All tested execution boundaries (`prepare/redeem`, `prepare/fund`, `revalidate`, `verify`) returned **404**. Live token, campaign, USD reference and reserve remain unassigned. These are browser-emulation results, not physical-iPhone acceptance or a hosted deployment.

| Layout | Chromium screenshot | WebKit screenshot |
| --- | --- | --- |
| Desktop | [View](evidence/rmt-task078/public-chromium/chromium-desktop-reclaim-read-only.png) | [View](evidence/rmt-task078/public-webkit/webkit-desktop-reclaim-read-only.png) |
| Portrait | [View](evidence/rmt-task078/public-chromium/chromium-portrait-reclaim-read-only.png) | [View](evidence/rmt-task078/public-webkit/webkit-portrait-reclaim-read-only.png) |
| Landscape | [View](evidence/rmt-task078/public-chromium/chromium-landscape-reclaim-read-only.png) | [View](evidence/rmt-task078/public-webkit/webkit-landscape-reclaim-read-only.png) |

## Read-only 4663 observations

The [bounded 4663 probe](evidence/rmt-task078/read-only-4663.json), completed **2026-11-19 00:27:05.695 UTC**, corroborated official Robinhood and Pocket RPC observations at L2 block **117812614**, hash `0x8777cb46f1ccc4b211858718775734aed336483ef1fce93d06b66c4945cd621d`. Both providers rechecked the same anchor. SafeL2 1.4.1, proxy factory and fallback-handler runtime pins matched; existing Operations and Reserve Safes matched their pinned proxy runtime and SafeL2 master copy, the three approved owners, threshold 2 and nonce 0. Both reported the expected ERC-721/1155 receiver interfaces. All three governance owner addresses had empty code at this anchor. Pocket returned some **429** responses; the bounded second attempts recovered, and the original failures remain in the report.

This is **corroborated L2 state**, not Ethereum L1 finality, independent market pricing, phone key control, universal NFT compatibility, Reclaim deployment or authorization to spend either Safe's funds. No campaign, token, USD reference, NFT policy or reserve is admitted by this observation. No signature, broadcast or production change occurred.

## Connected integration acceptance — pending actual execution

The first Linux Chromium CI run at PR head `8e2ca659b1d12d88f166415418d1b279a97b3795` stopped in the **retained ordinary launch lifecycle, before Reclaim**. Its actual graduation review returned HTTP 200 with `status: unavailable`, diagnostic **`simulation / TimeoutError`**, before wallet confirmation. The local RPC transport allowed only 2.5 seconds while its Anvil proxy allowed twelve. A narrow correction gives this **loopback fixture client** a bounded ten seconds with **zero retries**; production RPC budgets and all identity, simulation, settlement and security assertions remain unchanged. An actual 3.2-second loopback `eth_call` now passes; an unavailable call still fails closed after ten seconds, with one request and no retry/broadcast in either case. Nine focused configuration/transport/diagnostic tests and website typecheck passed. [Raw focused tests and disposition](evidence/rmt-task078/regressions/fixture-transport-disposition.json). The silent Anvil log does not identify whether the original latency came from archive storage, provider rate limits or scheduling; that narrower cause remains unknown. A complete lifecycle CI rerun is still required.

| Concrete failure | Preserved evidence | Fix and remaining verification |
| --- | --- | --- |
| Graduation review `simulation / TimeoutError` before Reclaim | [Original diagnostic](evidence/rmt-task078/regressions/ci-first-graduation-review.json), SHA-256 `f183c10a72c7d7f0e48513e3b4e59bbde94e0d4460fe8872425b0f43c5b81f63`; original CI artifact link and download hash are in the transport disposition. | Commit `72e81d75` changes only the local fixture's bounded read budget, with positive/timeout tests. Complete Linux lifecycle rerun remains pending. |
| Repository CI: one unused shared declaration | [Original timestamped excerpt](evidence/rmt-task078/regressions/ci-first-knip-excerpt.txt); [source-log hash and disposition](evidence/rmt-task078/regressions/ci-knip-disposition.json). | Commit `87004c89` adds `packages/launchpad-common/reclaim-runtime.d.mts` as an explicit Knip entry, matching the existing shared-declaration pattern. No ignore or security assertion was added. Linux rerun remains pending; local Knip separately hit an OXC `Array buffer allocation failed` runtime failure. |

The intended entrypoint is the existing isolated harness with `--reclaim-only`; previous default lifecycle, Task 075 profile and Task 076/077 treasury steps remain separate. No production database schema or authoritative writer is rolled out. The existing fixture writer/checkpoint should be exercised against the isolated PostgreSQL schema, with authenticated bounded reads and exact receipt/log/state evidence.

Required before final handoff: actual form→campaign→manual funding→noticed eligibility→ERC-721/1155 surrender→canonical reward/custody→pause/rate/close/recovery; interrupted hash recovery without resubmission; application/indexer restart and reorg rollback; EOA, admitted delegation and genuine 2-of-3 Safe evidence; and execution-mode desktop/portrait/landscape screenshots. Public zero-wallet/financial-404 checks are already recorded above. Missing connected receipt/settlement evidence must remain pending, not synthetic success. **The connected-journey results are not yet claimed here.**

The new strict security job analyzes every Reclaim production root/reachable import. Local YAML parsing verified the four existing security job objects are unchanged; an additional Reclaim browser step runs for each Chromium/WebKit engine without deleting previous regression stages. Exact-head CI results remain pending.

```sh
pnpm install --frozen-lockfile
(cd packages/contracts && bash scripts/install-v4-deps.sh)
pnpm --filter @rmt/launch-website build
pnpm --filter indexer build
node --test scripts/reclaim/*.test.mjs
forge test --root packages/contracts/reclaim --use /absolute/path/to/solc-0.8.26 -vvv
node scripts/visual-qa/rmt-creator-integration.mjs --reclaim-only \
  --browser chromium --anvil /absolute/path/to/anvil --solc /absolute/path/to/solc-0.8.26 \
  --pg-bin /absolute/path/to/postgresql/bin --output /absolute/unused/output
```

Repeat with WebKit and a distinct unused output. The harness command is integration wiring pending acceptance, not a claim the above sequence has passed. Source/compiler verification uses pinned inputs. New evidence attributes use LF for JSON/MJS/TXT and binary storage for GZ/PNG; artifact inventories must use tracked paths, not ignored local logs or database files.

## Production no-go and owner decisions

No actual new RMT address, approved live campaign/NFT eligibility, funded reward reserve or USD conversion exists. Production pages must say unavailable and make no signing/claim calls. Future activation separately needs accepted RMT identity, explicit fixed-unit/price policy, funding, collection/custody approval, controller responsibility, security disposition, durable indexing/finality and owner deployment/activation authorization. No new wallet or paid service is required for the local implementation.

No production deployment, funded transaction, token issuance, royalty change, automatic treasury purchase, hosting/plan change, production writer/data migration or merge is authorized or performed. LAMMB remains independent. Recommended next task will be narrowed from the actual integration results, not presumed before acceptance.
