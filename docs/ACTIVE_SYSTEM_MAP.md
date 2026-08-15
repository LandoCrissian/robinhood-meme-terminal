# RMT active system map

**Status: CURRENT — operational system of record**
**Architecture:** [`ARCHITECTURE_FREEZE.md`](ARCHITECTURE_FREEZE.md)

## Runtime and service ownership

| Domain | Authority | Status | Notes |
| --- | --- | --- | --- |
| Production terminal | `apps/web/lib/vnext/*`, `apps/web/lib/server/vnext-*`, `/` | ACTIVE / CANONICAL | VNext owns the public root. The selected-asset workspace independently checks exact displayed and USDG/WETH up. pools, live fees and gauge state without treating venue evidence as project origin. |
| External wallet gateway | Privy external connectors, EIP-6963 discovery and the Privy Wagmi adapter | ACTIVE FOUNDATION | One terminal control; exact connector-qualified selection; embedded wallets cannot become the VNext trading signer. Supported-device acceptance remains required. See [`UNIFIED_WALLET_GATEWAY.md`](UNIFIED_WALLET_GATEWAY.md). |
| Retired terminal presentation | former root feed, market workspace and portfolio trees | RETIRED | Replaced market and portfolio URLs restore intent inside VNext; no second terminal shell or V7–V12 global cascade remains active. |
| V6 protocol history | `apps/indexer` | ACTIVE COMPATIBILITY | Canonical deployed V6 launches, trades, graduation, fees and origin only. |
| External project origin | `apps/external-origin-indexer` | ACTIVE FOUNDATION | Fail closed; `source-listed` and `token-created` remain distinct. StonkBrokers has candidate identity only: the production launcher contract/event is unverified, no claims are served and activation remains locked. |
| External markets | `apps/market-indexer` | ACTIVE | Read-oriented discovery/enrichment, including separately identified `up-v2` and `up-cl` shadow sources; no execution or treasury work. Shadow rows are not consumed by the public terminal. |
| Same-chain execution | VNext adapters plus current Sushi/Uniswap verifiers | ACTIVE | Provider admission is capability-specific. `up-v2` and `up-cl` now have strict verification and exact wallet-authorization codecs, but their observation and provider-specific authorization gates default off pending controlled mainnet proof. |
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
| `/` | Canonical production VNext terminal. |
| `/vnext` | Permanent compatibility redirect to `/`. |
| `/market/[address]` | Compatibility redirect to the exact market inside `/`; optional Buy/Sell intent is preserved. |
| `/portfolio` | Compatibility redirect to the wallet-held portfolio inside `/`. |
| `/profile` | Paused; preserved source/data, not promoted by active navigation. |
| `/launch` | Paused product notice; must not promise a V7 reopening roadmap. |
| `/explore` | Allowed only as ecosystem/market discovery; creator-platform promotion is paused. |
| creator, consent, deployment and admin routes | Preserved operational/experimental source; not public terminal roadmap. |

## Environment status

- `NEXT_PUBLIC_RMT_VNEXT_*` / `RMT_VNEXT_*`: independent shell, provider, authorization, submission and funding gates. Capability does not imply activation. Each up. provider requires its observation gate, its own server authorization gate, both global authorization gates and the wallet-submission gate before an actual wallet prompt.
- `NEXT_PUBLIC_RMT_LIVE_*`, creator/V7, profile and autonomous execution controls: paused unless required for preserved compatibility tests; must not be newly enabled.
- `RMT_EXECUTION_FEE_ENABLED`: remains `false`; policy implementation approval is not production activation approval.
- `RMT_EXECUTION_FEE_BPS` and treasury: production examples remain blank and no environment was changed. `RMT_EXECUTION_V1` now binds 25 basis points to the verified Safe `0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC`, block `35041945` and policy hash `0x295c900143405bb585a4d88c3788fadab522fd4313f69242f64e52e39827f141`; no provider settlement deployment or collection gate is active.
- Production values are changed only through a separate authorized release action, never by architecture documentation.

## Contract source classification

### A. Deployed/current compatibility

V6 governance, registry, gate, policy, factory, bootstrap, official migration, canonical V6 clones and exact deployment evidence. These remain truthful representations of current onchain state.

### B. Terminal security / optional execution

Position Guard source, the separate Sushi deadline-guard track and the deployed `RMTUniswapV3FeeExecutorV1` atomic settlement primitive at `0x843a4D8BEa13037c5706eA005d336aE735BB0eD4`. Its exact runtime and receipt are verified, but deployment does not imply wallet routing or production fee activation; all fee/provider gates remain disabled.

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
