# RMT Launch system map

**Status:** HISTORICAL BASE INVENTORY WITH TASK 018 TARGET

**Base inspected:** `6d0b8103bdad95367445a38e5f5327458baa9ab2`.

The table records the audited base and intended disposition. The [Curve V1 guide](RMT_LAUNCH_CURVE_V1.md) is the active engineering roadmap. The [direct launch runbook](RMT_LAUNCH_V4_LOCAL.md) records the prior local runtime and its evidence.

| Domain / known source | Observed at base | Target disposition |
| --- | --- | --- |
| `apps/web/app/page.tsx`, `apps/web/app/vnext/*`, scoped VNext CSS | Root mounts the existing terminal shell and can restore a launch-specific market | KEEP visual system; adapt the single shell to launch discovery/creation. Do not create a competing terminal or redesign. |
| Existing wallet, authorization, simulation, settlement and recovery | Shared security/execution infrastructure | KEEP protections; reuse only through reviewed boundaries. Preserve unresolved transaction recovery. |
| `packages/contracts/src/RMTLaunchFactoryV6.sol`, clone curve, gates/policy, deployed artifacts | Existing custom-curve factory and v4 graduation path | PRESERVE unchanged compatibility/history; not the new public engine. |
| New RMT gas-only Curve V1 | Absent at this base | BUILD separate fixed-supply factory, bonding curve, ledger and atomic v4 graduation. Preserve direct-to-v4 review as historical evidence. |
| `apps/indexer` | V6 history/compatibility authority | KEEP required history; do not silently reinterpret legacy events as new launches. |
| Launch intelligence/readers and external-origin sources | Reusable launch discovery/origin foundations; full dependency audit pending | REUSE bounded, chain-qualified, reorg-safe components where suitable; new factory events must not depend on manual curated seed admission. |
| NFT terminal, `apps/nft-indexer`, `apps/nft-marketplace-indexer`, shared NFT domains | Existing NFT product/code | REMOVE from forward public product and runtime dependencies in tested stages. Preserve data/security evidence; no live worker shutdown in this PR. |
| General RWA/stock-token discovery and broad terminal intelligence | Existing market filters and chain/capital-flow cards | REMOVE unrelated public product use. Keep safety exclusions wherever shared execution remains reachable. |
| Profiles/referrals, community/RMT Live, creator/V7 NFT features | Previously paused code/data | RETIRE product surfaces and unnecessary runtime dependencies after checking consumers; do not delete user data. |
| General distribution planner / Position Guard expansion / agent product tracks | Preserved or future foundations, not a new launch requirement | OUT OF SCOPE. No autonomous trade or distribution activation. |
| CannaCat embed drafts #575 and #581 | Closed and unmerged. #582 removes dedicated catalog, artwork and product metadata. | RETIRE remaining dedicated release and fixture dependencies. Preserve generic auth, execution and recovery safeguards and historical evidence. |
| Existing provider integrations, contracts, fee/release receipts | Mixed live compatibility and historical/controlled evidence | PRESERVE exact evidence and release boundaries. Source presence is not activation. |

## Route migration

`/` currently serves VNext; `/vnext`, historical market and portfolio URLs preserve compatibility intent. `/launch` is documented as a paused notice at this base. NFT/project/profile/admin/creator routes require a route-by-route audit before removal. Do not infer that changing this document changes those routes.

The target is one launchpad shell: launch discovery, creation, token detail/trading, creator launch management and required wallet/fee state. Deep links and transaction recovery must survive the transition. Redirects must not convert an old token address into a different asset or discard pending transaction state.

## Existing RMT identity

The [baseline preservation evidence](RMT_LAUNCH_BASELINE_EVIDENCE.md) identifies V6 launch 0 as the official V6 issuance and distinguishes its token and curve from the earlier V4 issuance. It records the pinned factory and receipt evidence, protected execution consumers, and operational retirement work. Prior product retirement and current onchain provenance are separate records.

## Runtime retirement evidence required

For each removed domain, record imports and shared consumers, entry routes/API handlers, background schedules, dependency/lockfile impact, data retention and rollback. Run affected checks and visual comparisons. Removing a menu item alone does not stop a worker or remove its cost. Service shutdown, production configuration and data deletion require a separate owner-authorized action.

See the [Curve V1 review and release gates](RMT_LAUNCH_CURVE_V1.md) and the [historical scope reset](RMT_LAUNCHPAD_RESET_2026-11-11.md). The [prior system map](archive/terminal-scope-2026-11-11/ACTIVE_SYSTEM_MAP.md) is a verbatim historical snapshot.
