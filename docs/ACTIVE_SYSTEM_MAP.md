# RMT active system map

**Status: CURRENT — operational system of record**
**Architecture:** [`ARCHITECTURE_FREEZE.md`](ARCHITECTURE_FREEZE.md)

## Runtime and service ownership

| Domain | Authority | Status | Notes |
| --- | --- | --- | --- |
| Forward terminal | `apps/web/lib/vnext/*`, `apps/web/lib/server/vnext-*`, `/vnext` | ACTIVE / MIGRATING | Canonical architecture; production root cutover not complete. |
| Production compatibility terminal | `apps/web/app/page.tsx`, legacy market workspace | ACTIVE COMPATIBILITY | Preserve trading behavior while capabilities migrate into VNext. |
| V6 protocol history | `apps/indexer` | ACTIVE COMPATIBILITY | Canonical deployed V6 launches, trades, graduation, fees and origin only. |
| External project origin | `apps/external-origin-indexer` | ACTIVE | Fail closed; `source-listed` and `token-created` remain distinct. |
| External markets | `apps/market-indexer` | ACTIVE | Read-oriented discovery/enrichment; no execution or treasury work. |
| Same-chain execution | VNext adapters plus current Sushi/Uniswap verifiers | ACTIVE | Provider admission is capability-specific. |
| Funding/recovery | VNext Across domain and server-side Firebase persistence | RELEASE-GATED | Asynchronous, wallet-bound and non-custodial. |
| RWA registry/evidence | Robinhood stock-token registry and policy evidence | ACTIVE FOUNDATION | Canonical RWA and RWA-paired markets remain distinct. |
| Profiles/referrals | preserved web source, Firebase records and rules | PAUSED | Not active terminal product; data is preserved. |
| RMT Live/community | preserved web/API source and Firestore rules | PAUSED | No persistent trader overlay or active roadmap work. |
| Creator/V7/NFT/marketplace | preserved app, docs, contracts and tests | PAUSED | Not current roadmap and not production-ready evidence. |
| Position Guard automation | existing local/release-gated source | PAUSED EXPANSION | Keep disabled; do not expand market-indexer coupling. |
| Sushi deadline guard | PR #313 track | SEPARATE | Deployment/security track; not part of terminal consolidation. |

## Route classification during migration

| Route | Status |
| --- | --- |
| `/` | Current production compatibility terminal until the completion gate passes. |
| `/vnext` | Canonical forward terminal; not yet production root. |
| `/market/[address]` | Named VNext compatibility boundary until the complete asset workspace moves into VNext. |
| `/portfolio` | Preserved legacy route. VNext navigation now owns its holdings entry point; PR 4 completes the authoritative holdings surface. |
| `/profile` | Paused; preserved source/data, not promoted by active navigation. |
| `/launch` | Paused product notice; must not promise a V7 reopening roadmap. |
| `/explore` | Allowed only as ecosystem/market discovery; creator-platform promotion is paused. |
| creator, consent, deployment and admin routes | Preserved operational/experimental source; not public terminal roadmap. |

## Environment status

- `NEXT_PUBLIC_RMT_VNEXT_*` / `RMT_VNEXT_*`: independent shell, provider, authorization, submission and funding gates. Capability does not imply activation.
- `NEXT_PUBLIC_RMT_LIVE_*`, creator/V7, profile and autonomous execution controls: paused unless required for preserved compatibility tests; must not be newly enabled.
- `RMT_EXECUTION_FEE_ENABLED`: must remain `false` without explicit fee-policy approval.
- `RMT_EXECUTION_FEE_BPS` and treasury: no approved production values; examples must remain blank/unapproved.
- Production values are changed only through a separate authorized release action, never by architecture documentation.

## Contract source classification

### A. Deployed/current compatibility

V6 governance, registry, gate, policy, factory, bootstrap, official migration, canonical V6 clones and exact deployment evidence. These remain truthful representations of current onchain state.

### B. Terminal security / optional execution

Position Guard source and the separate Sushi deadline-guard track. Source does not imply production activation.

### C. Paused experimental

V7 creator collections, editions, release registry/modules, media evidence, consent-bound splits and creator marketplace preparation.

### D. Retired historical

V4/V5 and earlier launch factories, older bonding/graduation/reward experiments and archived deployment records. Preserve for history and compatibility only.

## Document status register

| Status | Documents / families |
| --- | --- |
| CURRENT | `ARCHITECTURE_FREEZE.md`, `ACTIVE_SYSTEM_MAP.md`, `TERMINAL_COMPLETION_GATE.md`, `RMT_TERMINAL_VNEXT_ARCHITECTURE.md`, `RMT_TERMINAL_VNEXT_MIGRATION.md`, `RMT_TERMINAL_VNEXT_UI_OWNERSHIP.md`, current deployment/security/operations evidence. |
| HISTORICAL | V4/V5 archives, previous deployment records, historical release handoffs after their baseline. |
| PAUSED | profile, community/RMT Live, creator media/release/consent, V7, marketplace and autonomous Position Guard expansion documents. |
| RESEARCH | provider benchmark, NFT research, terminal UX research, external audit inquiry and unadmitted provider research. |
| SUPERSEDED | roadmap language that names V7 launching, creator ecosystem or profiles as the current next phase; `HANDOFF_2026-08-06.md` as a roadmap. |

A more recent deployment/security record can remain factually authoritative for its narrow domain without becoming product-roadmap authority.

## Open PR classification at freeze

- #340: newer correct UniswapX verification-plan foundation; preserve and review separately.
- #313: separate Sushi deadline-guard security/deployment track.
- #309: research/documentation, not runtime truth.
- #302: temporary Terminal V11 diagnostics; stale owner decision pending.
- #297: separate autonomous Position Guard track.

No open PR is merged, closed or repurposed by this classification.
