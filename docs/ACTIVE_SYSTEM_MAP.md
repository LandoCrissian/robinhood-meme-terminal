# RMT Launch system map

**Status:** CURRENT MIGRATION INVENTORY, 2026-11-11

**Base inspected:** `6d0b8103bdad95367445a38e5f5327458baa9ab2`.

This table separates the existing repository's runtime from the requested product. It does not assert production configuration or that removal has occurred.

| Domain / known source | Observed at base | Target disposition |
| --- | --- | --- |
| `apps/web/app/page.tsx`, `apps/web/app/vnext/*`, scoped VNext CSS | Root mounts the existing terminal shell and can restore a launch-specific market | KEEP visual system; adapt the single shell to launch discovery/creation. Do not create a competing terminal or redesign. |
| Existing wallet, authorization, simulation, settlement and recovery | Shared security/execution infrastructure | KEEP protections; reuse only through reviewed boundaries. Preserve unresolved transaction recovery. |
| `packages/contracts/src/RMTLaunchFactoryV6.sol`, clone curve, gates/policy, deployed artifacts | Existing custom-curve factory and v4 graduation path | PRESERVE unchanged compatibility/history; not the new public engine. |
| New RMT direct-to-v4 launch engine | Not implemented by this reset | BUILD separately after liquidity, fee, custody and verification design; no production activation. |
| `apps/indexer` | V6 history/compatibility authority | KEEP required history; do not silently reinterpret legacy events as new launches. |
| Launch intelligence/readers and external-origin sources | Reusable launch discovery/origin foundations; full dependency audit pending | REUSE bounded, chain-qualified, reorg-safe components where suitable; new factory events must not depend on manual curated seed admission. |
| NFT terminal, `apps/nft-indexer`, `apps/nft-marketplace-indexer`, shared NFT domains | Existing NFT product/code | REMOVE from forward public product and runtime dependencies in tested stages. Preserve data/security evidence; no live worker shutdown in this PR. |
| General RWA/stock-token discovery and broad terminal intelligence | Existing market filters and chain/capital-flow cards | REMOVE unrelated public product use. Keep safety exclusions wherever shared execution remains reachable. |
| Profiles/referrals, community/RMT Live, creator/V7 NFT features | Previously paused code/data | RETIRE product surfaces and unnecessary runtime dependencies after checking consumers; do not delete user data. |
| General distribution planner / Position Guard expansion / agent product tracks | Preserved or future foundations, not a new launch requirement | OUT OF SCOPE. No autonomous trade or distribution activation. |
| LAMMB CannaCat embed, open PR #575 | Separate consumer of RMT auth/execution/recovery work | PRESERVE dependency and branch; establish a tested extraction/reuse boundary before shared code removal. |
| Existing provider integrations, contracts, fee/release receipts | Mixed live compatibility and historical/controlled evidence | PRESERVE exact evidence and release boundaries. Source presence is not activation. |

## Route migration

`/` currently serves VNext; `/vnext`, historical market and portfolio URLs preserve compatibility intent. `/launch` is documented as a paused notice at this base. NFT/project/profile/admin/creator routes require a route-by-route audit before removal. Do not infer that changing this document changes those routes.

The target is one launchpad shell: launch discovery, creation, token detail/trading, creator launch management and required wallet/fee state. Deep links and transaction recovery must survive the transition. Redirects must not convert an old token address into a different asset or discard pending transaction state.

## Known identity inconsistency

The old README describes an existing official V6 market, whereas `MAINNET_V6_DEPLOYMENT.md` labels launch 0 as retired and explicitly not the current token. This reset does not choose between those claims. Preserve all bindings and reconcile exact chain/factory/launch/transaction evidence before address-specific action.

## Runtime retirement evidence required

For each removed domain, record imports and shared consumers, entry routes/API handlers, background schedules, dependency/lockfile impact, data retention and rollback. Run affected checks and visual comparisons. Removing a menu item alone does not stop a worker or remove its cost. Service shutdown, production configuration and data deletion require a separate owner-authorized action.

See [the implementation plan](RMT_LAUNCHPAD_RESET_2026-11-11.md). The [prior system map](archive/terminal-scope-2026-11-11/ACTIVE_SYSTEM_MAP.md) is a verbatim historical snapshot, not a current product roadmap.
