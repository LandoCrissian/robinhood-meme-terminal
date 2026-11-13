# RMT Launch repository authority

## Owner decision for Task 018

RMT Launch is a dedicated token launchpad. LAMMB Empires remains a separate, parallel project. Preserve the existing RMT visual design and mobile/desktop interaction quality. Preserve the existing RMT token and its deployed curve/contract history; do not replace, migrate or reconfigure them as part of this cleanup.

New third-party launches use a separately versioned gas-only bonding-curve engine. Creation mints one fixed supply. Successful graduation uses actual curve backing and the same token in Uniswap v4 with permanent original-position custody. Draft parameters are review inputs. Preserve both the historical direct-to-v4 review and the existing deployed RMT assets. Use the [Curve V1 guide](docs/RMT_LAUNCH_CURVE_V1.md) for the active implementation and release gates.

Read before substantial work:

1. [Architecture and change boundary](docs/ARCHITECTURE_FREEZE.md)
2. [Observed runtime versus target scope](docs/ACTIVE_SYSTEM_MAP.md)
3. [Curve V1 implementation and acceptance](docs/RMT_LAUNCH_CURVE_V1.md)

## Scope

Keep launch creation, launch discovery, token details/trading, creator launch management and fee accounting needed for the launchpad. Reuse the existing design system and sound wallet/indexing components; do not redesign the site or create a second parallel terminal architecture.

General NFT browsing/marketplace products, unrelated RWA/stock-token browsing, social/community/profile/referral products, creator NFT/V7 products, general-purpose distribution, agents and chain-wide terminal intelligence are outside the forward product. Remove their public promotion and runtime dependencies in tested, reviewable stages. Source presence or an old CURRENT label does not reactivate them.

## Preservation and safety

- Do not delete or rewrite deployed contract source, deployment manifests, runtime hashes, receipts, user balances, recovery journals, databases or historical evidence. Preserve all old token/curve bindings until exact identity is reconciled from authoritative records.
- The README and V6 deployment record disagree about the status of historical launch 0. Do not select a current RMT token by ticker, name, memory or an isolated document. Preserve the existing stack; report the identity conflict rather than inventing a migration.
- Audit open PRs and shared consumers before deleting code. Drafts #575 and #581 are closed and excluded from the RMT Launch release path. Preserve generic wallet and settlement safeguards and historical evidence. LAMMB Empires remains independent.
- Keep exact wallet/account/chain/recipient binding, narrow approvals, explicit user confirmation, simulation, slippage/minimum-output checks, duplicate prevention and strict settlement reconciliation. Background work never signs or submits. RMT never holds private keys or seed phrases.
- The existing runtime's ZERO_X_ONLY execution boundary remains unchanged until a separately reviewed replacement is implemented and authorized. This is compatibility/security protection, not a renewed general-terminal roadmap. Existing provider-specific evidence and Stock Token execution exclusions remain binding wherever those paths remain reachable.
- Separate token deployment, funded onchain pool availability, RMT listing, external indexing and external routing. Never promise immediate listing everywhere, exchange acceptance, safety, price support or guaranteed liquidity.
- New factory/locker/router code requires adversarial tests, exact deployment/runtime verification and explicit release authorization. A standard v4 pool or source verification is not a security audit.
- Factories, curves, tokens, fee ledgers and LP custody are versioned deployments. Governance may approve discovery of a future factory through a delayed multisignature action. It may not rewrite an existing launch or move its assets. Preserve existing curve exits and fee claims across directory changes.
- No production deployment, environment change, contract transaction, existing-token migration, fee activation, cloud service shutdown, destructive data migration, merge or automation change is authorized by this scope reset.

## Validation and reporting

Make sequential, reviewable PRs. Preserve CSS, logo/artwork and responsive layout unless a specific removal requires a measured change. Run affected contract, indexer, web, wallet/recovery and mobile/desktop visual suites before claiming runtime cleanup complete. Do not weaken tests or delete security checks to make removal pass.

Report source changes, tests actually executed, remaining gaps and production state separately. Documentation-only work must not be described as functional code removal or a working new launch engine.

The prior authority files are preserved byte-for-byte in `docs/archive/terminal-scope-2026-11-11/` from base `6d0b8103bdad95367445a38e5f5327458baa9ab2`. Their product-roadmap statements are historical, not forward instructions. Their original relative links refer to the original repository locations. Narrow security/deployment records retain their evidentiary value; this reset does not certify that they are complete or current.
