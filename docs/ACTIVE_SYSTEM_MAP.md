# RMT active system map

**Status: CURRENT — operational system of record**
**Architecture:** [`ARCHITECTURE_FREEZE.md`](ARCHITECTURE_FREEZE.md)

**Current execution decision:** `RMT_EXECUTION_AUTHORITY_RECONCILIATION_AND_PRECEDENCE_V1` at base `6a693668ac72bb967217c1f48741aeaf038ff0dd`. Current provider-specific authority: [0x AllowanceHolder](RMT_ZEROX_ALLOWANCE_HOLDER_PUBLIC_EXECUTION_V1.md); hot-path scope: [execution authorities](execution-hot-path-authorities.md). These references govern only their stated domains. Apply [authority resolution](RMT_AGENT_CONTROL_PLANE.md#authority-resolution): durable safety invariants remain binding, newer explicit owner-approved domain facts supersede older general current-state prose, and unresolved genuine conflicts stop for owner review.

## Runtime and service ownership

| Domain | Authority | Status | Notes |
| --- | --- | --- | --- |
| Token Terminal | `apps/web/lib/vnext/*`, `apps/web/lib/server/vnext-*`, `/` | ACTIVE / CANONICAL | VNext owns the public root and the single Token state/execution architecture. Exactly eight owner-curated markets remain canonical seeds; bounded provider discovery may add visible non-curated markets without admitting or authorizing them. Exhaustive indexing is not a Terminal dependency. |
| NFT Terminal | `apps/web/app/nft/*`, `apps/web/lib/server/nft-*`, `packages/shared/src/nft/*`, `/nft` | ACTIVE / CURATED / READ-ONLY EXECUTION STATE | CCFF00 is the only public `ACTIVE` NFT project. Robin Rabbits and Gogh Punks are `WATCHING` and non-public. NFT execution is `NONE`; this is not a generic marketplace or OpenSea clone. |
| NFT technical verification | `apps/nft-indexer/src/technical-verification.ts`, `packages/shared/src/nft/technical-verification.ts`, reviewed manifests under `docs/nft/technical-verification/*` | ACTIVE FOUNDATION | Creation provenance, runtime identity and ERC interface evidence fail closed. Provider/network failure remains inconclusive. `RMT_NFT_FACTORY_CLONE_PROVENANCE_V2` is the next NFT-specific technical task; successful verification may produce `WATCHING`, never automatic public admission. |
| NFT marketplace evidence | `apps/nft-marketplace-indexer`, `packages/shared/src/nft/marketplace-evidence.ts` | ACTIVE READ-EVIDENCE FOUNDATION | Currently scoped to CCFF00. OpenSea/Seaport evidence may describe provider-reported listings, offers, sales and volume; it is not canonical ownership authority, verified settlement or execution authorization. |
| Project Market | curated token and NFT authority domains | ACTIVE PRODUCT FOUNDATION | Future token/NFT connections require owner confirmation plus independent technical verification. Names, symbols, branding, metadata and contract functions never establish a relationship. |
| External wallet gateway | Privy external connectors, EIP-6963 discovery and the Privy Wagmi adapter | CURRENT_SUPPORTING_INFRASTRUCTURE / RELEASE-SCOPED | One terminal control and exact connector-qualified selection. User-controlled submission is enabled only behind current authorization/release gates and explicit user wallet confirmation. No automatic signing/broadcast or key/seed custody. See [`UNIFIED_WALLET_GATEWAY.md`](UNIFIED_WALLET_GATEWAY.md) for wallet mechanics, subject to current execution-domain authority. |
| Retired terminal presentation | former root feed, market workspace and portfolio trees | RETIRED | Replaced market and portfolio URLs restore intent inside VNext; no second terminal shell or V7–V12 global cascade remains active. |
| V6 protocol history | `apps/indexer` | ACTIVE COMPATIBILITY | Canonical deployed V6 launches, trades, graduation, fees and origin only. |
| External project origin | `apps/external-origin-indexer` | ACTIVE FOUNDATION | Fail closed; `source-listed` and `token-created` remain distinct. StonkBrokers has candidate identity only: the production launcher contract/event is unverified, no claims are served and activation remains locked. |
| Curated market authority | `apps/web/lib/vnext/curated-market-registry.ts` plus fresh RPC verification | ACTIVE / CANONICAL | Owner-reviewed entries pin canonical market identity for the eight seeds. Curated authority is separate from broad visibility and dynamic provider-specific execution eligibility. Aliases are not identity authority. |
| Historical external markets | `apps/market-indexer` | OPTIONAL / RETIREMENT PENDING | No production-health, directory, search or execution requirement remains. Stop compute only after curated-web acceptance; retain its database during a reviewed recovery window. |
| Same-chain execution | VNext intent, quote, verification, authorization and recovery domains | CURRENT_PUBLIC_EXECUTION / ZERO_X_ONLY | Only `zero-x-swap` on chain 4663; `PROVIDER_NATIVE_INPUT_FEE` under the current 0x source boundary. Indicative price is not execution authority. Authoritative firm verification, committed authorization, allowance/balance checks, RPC simulation and strict settlement reconciliation are mandatory. Stock Tokens remain view-only/execution-ineligible, fail closed. |
| Other provider integrations / custom fee executors | Preserved Uniswap V3/V2, Sushi, UniswapX and other provider code and records | CONTROLLED/HISTORICAL / PRESERVED; READ/DISCOVERY ONLY where admitted | Deployed contracts, liquidity evidence and controlled proofs do not authorize current public execution. Historical release records remain intact; no provider is activated by this classification. |
| Funding/recovery | VNext Across domain and server-side Firebase persistence | RELEASE-GATED | Asynchronous, wallet-bound and non-custodial. |
| RWA registry/evidence | Robinhood stock-token registry and policy evidence | ACTIVE FOUNDATION | Canonical RWA and RWA-paired markets remain distinct. |
| Profiles/referrals | preserved web source, Firebase records and rules | PAUSED | Not active terminal product; data is preserved. |
| RMT Live/community | preserved web/API source and Firestore rules | PAUSED | No persistent trader overlay or active roadmap work. |
| Creator/V7 | preserved creator apps, media, launch, consent, marketplace-creation, docs, contracts and tests | PAUSED | Separate from the active curated NFT Terminal. No creator launch or creator marketplace reactivation is implied. |
| Distribution | VNext distribution domain, planner and preserved deployment foundations | FOUNDATION / FUTURE PRODUCTIZATION | Current work is planning/read-only foundation. No deployment, campaign execution, fee economics or CCFF00-specific architecture activation is authorized. |
| Position Guard automation | existing local/release-gated source | PAUSED EXPANSION | Keep disabled; do not expand market-indexer coupling. |
| Sushi deadline guard | PR #313 track | SEPARATE | Deployment/security track; not part of terminal consolidation. |

## Route classification during migration

| Route | Status |
| --- | --- |
| `/` | Canonical production VNext terminal. |
| `/vnext` | Permanent compatibility redirect to `/`. |
| `/market/[address]` | Compatibility redirect to the exact market inside `/`; optional Buy/Sell intent is preserved. |
| `/portfolio` | Compatibility redirect to the wallet-held portfolio inside `/`. |
| `/nft` | Active curated NFT Terminal catalog; only public `ACTIVE` projects render. |
| `/nft/[projectId]` | Curated Project Market inventory/evidence route; admission remains registry-controlled. |
| `/nft/[projectId]/[tokenId]` | Read-only NFT item evidence route; no purchase, sale or transfer execution. |
| `/profile` | Paused; preserved source/data, not promoted by active navigation. |
| `/launch` | Paused product notice; must not promise a V7 reopening roadmap. |
| `/explore` | Allowed only as ecosystem/market discovery; creator-platform promotion is paused. |
| creator, consent, deployment and admin routes | Preserved operational/experimental source; not public terminal roadmap. |

## Environment status

- Wallet execution is exact-provider release-scoped: current public authority is `ZERO_X_ONLY`. User-controlled submission requires explicit wallet review/confirmation and fail-closed authorization/release gates. No particular Production environment values are inferred here. Capability, deployment and controlled proof do not activate another provider.
- `NEXT_PUBLIC_RMT_LIVE_*`, creator/V7, profile and autonomous execution controls: paused unless required for preserved compatibility tests; must not be newly enabled.
- Current 0x economics use `PROVIDER_NATIVE_INPUT_FEE`: exactly one 25-bps sell-token integrator fee to the established treasury, with provider fees disclosed separately, under the existing 0x source boundary. Historical `RMT_EXECUTION_V2` custom-executor economics are not current provider-independent authority.
- `RMT_EXECUTION_V1` deployment, policy, proof, receipt and 2026-08-16 release-boundary records remain immutable historical evidence; they are not the forward policy.
- Historical execution evidence: the Uniswap V2 V2 executor was deployed and its controlled native ETH-to-PONS settlement passed in transaction `0xb8ff9e561d4a333f5f91eb707daf6e8b00d0d0565de68355cf5966c1a6cdbb9e` at block `53089890`. This is neither current public V2 authority nor a bidirectional live proof. The historical Uniswap V3 V2 public release is preserved, not current public authority.
- Production values are changed only through a separate authorized release action, never by architecture documentation.
- Background identity, quote and intelligence work never signs or submits; no autonomous customer trade is authorized. Approval or receipt success alone is not settlement: exact ERC20 Transfer or native-output trace reconciliation remains required.

## Contract source classification

### A. Deployed/current compatibility

V6 governance, registry, gate, policy, factory, bootstrap, official migration, canonical V6 clones and exact deployment evidence. These remain truthful representations of current onchain state.

### B. Terminal security / preserved optional execution

Position Guard source, the separate Sushi deadline-guard track, historical `RMTUniswapV3FeeExecutorV1` evidence, and the deployed V2 atomic-settlement executors remain PRESERVED / CONTROLLED/HISTORICAL. Uniswap V3 V2 had a historical public release under `RMT_EXECUTION_V2`; Uniswap V2 V2 has controlled live-proof evidence. Neither is current public execution authority. Exact historical runtime, policy, settlement and release records remain intact; no custom-executor admission is relaxed.

### C. Paused experimental

V7 creator collections, editions, release registry/modules, media evidence, consent-bound splits and creator marketplace preparation.

### D. Retired historical

V4/V5 and earlier launch factories, older bonding/graduation/reward experiments and archived deployment records. Preserve for history and compatibility only.

## Document status register

| Status | Documents / families |
| --- | --- |
| CURRENT | `ARCHITECTURE_FREEZE.md`, `ACTIVE_SYSTEM_MAP.md`, `TERMINAL_COMPLETION_GATE.md`, `RMT_TERMINAL_VNEXT_ARCHITECTURE.md`, `RMT_TERMINAL_VNEXT_MIGRATION.md`, `RMT_TERMINAL_VNEXT_UI_OWNERSHIP.md`, current deployment/security/operations evidence. |
| HISTORICAL | V4/V5 archives, previous deployment records, historical release handoffs after their baseline. |
| PAUSED | profile, community/RMT Live, creator media/release/consent, V7, creator-marketplace and autonomous Position Guard expansion documents. |
| RESEARCH | provider benchmark, historical NFT creator-platform research, terminal UX research, external audit inquiry and unadmitted provider research. |
| SUPERSEDED | roadmap language that names V7 launching, creator ecosystem or profiles as the current next phase; `HANDOFF_2026-08-06.md` as a roadmap. |

A more recent deployment/security record can remain factually authoritative for its narrow domain without becoming product-roadmap authority.

## Coordination state at this authority baseline

At baseline `7a7d0e5be09f8c412f6d3c3be84ed7cf9b0f0ef5`, GitHub reported zero open PRs. Future work must inspect current PR and branch ownership before modifying shared Token/NFT web surfaces. Documentation never authorizes merge, deployment, wallet broadcast, NFT execution, fee activation, asset admission or `WATCHING` promotion.
