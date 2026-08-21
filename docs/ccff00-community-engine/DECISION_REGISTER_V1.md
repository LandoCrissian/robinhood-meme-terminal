# CCFF00 Community Engine decision register V1

**Status:** PLANNING ONLY — OWNER DECISIONS CAPTURED, RUNTIME NOT AUTHORIZED

This register distinguishes decisions already made from technical details intentionally deferred until measured evidence exists. Future OpenAI Codex work should not reopen locked product decisions merely because another implementation is easier.

## Locked decisions

| ID | Decision | Consequence |
| --- | --- | --- |
| CE-001 | One current owner address holding at least one admitted public CCFF00 = one V1 community seat. | Multiple Squares in one wallet do not multiply allocation odds. |
| CE-002 | Current ownership is authoritative; original mint clustering is analytics only. | A legitimate buyer becomes eligible; original minter history cannot permanently suppress the buyer. |
| CE-003 | Do not infer one human across unrelated wallets. | No funding-graph/IP/behavioral Sybil merges. Optional signed linking is future-only. |
| CE-004 | Founder/project reserve IDs do not create V1 public community seats. | Census uses canonical public-mint range only. |
| CE-005 | Voluntary ETH contribution gives zero allocation advantage. | Funding data is architecturally separated from fairness state. |
| CE-006 | Fairness is least-served-first. | No active seat reaches allocation `N+1` while another active seat remains at `N`. |
| CE-007 | One mint run is one V1 allocation batch. | Different projects naturally spread through the lowest service cohort; unrelated project inventories are not value-pooled. |
| CE-008 | Allocation census is anchored to the confirmed acquisition transaction block. | Operator cannot choose a later favorable holder snapshot. |
| CE-009 | Future randomness round is derived from acquisition-block timestamp + fixed versioned lead policy. | Operator cannot choose/reroll the round after seeing inventory. |
| CE-010 | NFT assignment ignores floor/rarity/bids/hype/PnL. | Financial outcome can differ, but assignment process remains blind. |
| CE-011 | Successfully acquired inventory cannot be cherry-picked. | No removing a token because it later looks valuable/undesirable. |
| CE-012 | Automatic acquisition uses only positive-allowlisted mint adapters. | Unknown/custom calldata remains observer-only. |
| CE-013 | Automatic free mint means exact native transaction `value == 0`. | Only native network gas may be spent by Collector V1. |
| CE-014 | One collector identity; no burner wallets to bypass project limits. | Respect creator per-wallet/allowlist rules. |
| CE-015 | Operator controls are START, STOP and WATCH PROJECT/whitelist input. | No operator winner/NFT selection or safety override. |
| CE-016 | Collector signer is isolated from RMT admin, treasury, deployer, trading and holder wallets. | Compromise blast radius is capped to small ETH + transient inventory. |
| CE-017 | CCFF00 NFT delivery goes to a canonical token-bound account only after exact receipt/withdrawal canary. | No assumed ERC-721 receiver compatibility. |
| CE-018 | Distribution rechecks current Square ownership before signing. | A sold Square never receives an NFT intended for the prior owner. |
| CE-019 | RMT Pay protocol utility sends RMT to `0x000000000000000000000000000000000000dEaD`. | Utility RMT is practically removed from circulation and visibly burn-addressed. |
| CE-020 | RMT Pay never automatically sells RMT for ETH. | No direct AMM sell pressure from protocol utility use. |
| CE-021 | Native gas funding and RMT burn settlement are separate accounting domains. | Gas exhaustion pauses capability; it does not trigger token selling. |
| CE-022 | Existing RMT token is retained. | No redeploy/migration merely to add `burn()` or `permit()`. |
| CE-023 | `apps/indexer` remains V6 compatibility only. | CCFF00 census/provenance starts as bounded read-only VNext-domain evidence. |
| CE-024 | Planning work remains isolated until terminal completion gate is explicitly cleared. | No runtime/worker/UI/signer/deployment work from this branch. |

## Locked RMT Pay accounting semantics

The conventional dead address is treated as a practical burn destination, but public wording must remain technically precise:

- the current RMT contract's immutable `totalSupply()` does **not** decrease;
- `balanceOf(0x...dEaD)` increases;
- the system reports nominal supply, dead-address balance and effective circulating supply separately;
- unlike `RMTRetirementSinkV1`, the dead address is not an RMT-deployed ownerless contract whose no-withdrawal bytecode is being proven; the selection is for conventional burn transparency/community recognition.

Do not claim a native ERC-20 `burn()` occurred when it did not.

## Deferred implementation decisions

These require evidence before selection.

| ID | Deferred decision | Required evidence |
| --- | --- | --- |
| CE-D01 | Exact live number of V1 community seats. | Package A live census at pinned block. |
| CE-D02 | Exact original multi-mint distribution. | Package B zero-address Transfer provenance artifact. |
| CE-D03 | OpenSea Drops live Robinhood API compatibility. | Package C capability probe. |
| CE-D04 | Exact Robinhood SeaDrop deployment(s)/runtime. | Package C/D onchain/runtime evidence. |
| CE-D05 | First autonomous quality threshold. | Observer-mode false-positive/false-negative review on real Robinhood mints. |
| CE-D06 | `randomnessLeadSeconds`. | Package E security/operational review; value must be fixed/versioned before production runs. |
| CE-D07 | Exact drand Quicknet identity at implementation date. | Package E revalidation; pin chain hash/public key/scheme/period/genesis. |
| CE-D08 | Safe `safeTransferFrom` vs exact `transferFrom` to CCFF00 TBA. | Package F exact deployed account canary. |
| CE-D09 | Collector wallet/account technology. | Package G signer/provider preflight; do not reuse existing privileged wallets. |
| CE-D10 | Mainnet quantity/gas/day/inventory caps. | Measured canary gas and limited-production data. |
| CE-D11 | Runtime service/storage technology. | Package H operational need and architecture decision; must support atomic/idempotent recovery. |
| CE-D12 | Gas vault deployment and numeric refill caps. | Package G/H measured gas + funding need. |
| CE-D13 | Gas vault collector rotation model. | Package I compare immutable vs delayed governance rotation. |
| CE-D14 | Terminal-revenue contribution to gas funding. | Separate future economics decision; current fee policy gives no implicit allocation. |
| CE-D15 | RMT Pay sponsorship provider/account model. | Package J live Robinhood AA/sponsorship compatibility proof. |
| CE-D16 | RMT Pay utility pricing in RMT. | Separate versioned economics/product decision; fixed prices/tiers preferred before oracle-metered gas equivalence. |
| CE-D17 | Atomic RMT burn + utility implementation pattern. | Package J exact CCFF00 TBA/account-abstraction proof. |
| CE-D18 | Optional multi-wallet identity linking. | Separate explicit-signature/privacy design; not needed for V1. |

## Explicitly rejected shortcuts

Do not implement these unless the owner later reverses the corresponding decision:

- one NFT entitlement per Square;
- donor-weighted allocation;
- funding-source/IP/behavior heuristics to merge wallets;
- operator-selected winners;
- operator-selected randomness seed;
- `Math.random()` allocation;
- latest-block snapshot chosen manually after seeing the mint;
- bare blockhash-only randomness;
- bare modulo random selection without rejection sampling;
- arbitrary custom-contract auto-calls;
- burner collectors to evade per-wallet mint limits;
- automatic NFT sale/liquidation;
- automatic RMT-to-ETH sale for gas;
- redeploying RMT just to get `burn()` or `permit()`;
- changing `RMT_EXECUTION_V1` to fund this without a separate economics decision;
- putting community execution inside `apps/indexer` or `apps/market-indexer` for convenience;
- using the planning branch as a stale runtime implementation base.

## Change-control rule

A locked decision changes only when the owner explicitly changes it and the planning/architecture records are updated before implementation relies on the new rule.

A deferred decision can be resolved by its designated bounded Codex package, but resolution of one deferred item does not authorize later packages, deployment or production activation.
