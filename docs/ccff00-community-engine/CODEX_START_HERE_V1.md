# OpenAI Codex — CCFF00 Community Engine start here

**Status:** FUTURE IMPLEMENTATION ENTRYPOINT — RUNTIME NOT YET AUTHORIZED  
**Planning branch:** `planning/ccff00-community-engine-v1`

This file exists to minimize Codex context/usage while preserving the decisions already worked out. Do not make Codex rediscover the system from scratch.

## 1. Before any Community Engine code

Codex must first inspect **current** repository authority from latest `main`:

```text
AGENTS.md
docs/ARCHITECTURE_FREEZE.md
docs/ACTIVE_SYSTEM_MAP.md
docs/TERMINAL_COMPLETION_GATE.md
```

If those files still say community/NFT work is paused, or the owner has not explicitly opened the assigned package, stop without runtime edits.

The planning branch is reference material only. Never use it as the runtime base.

```text
latest main
  ↓
fresh bounded Codex branch
  ↓
one package only
  ↓
review/report
  ↓
STOP
```

## 2. Planning front door

Read first:

```text
HANDOFF_INDEX_V1.md
DECISION_REGISTER_V1.md
SPEC_CONSISTENCY_V1.md
CODEX_PACKAGE_MANIFEST_V1.json
```

Use exactly one prompt from:

```text
CODEX_PROMPTS_V1.md
```

for the currently authorized package.

Do not send/execute the A–K prompts as one mega-task.

## 3. Specification precedence

If two planning documents appear to disagree:

1. current repository authority;
2. explicit later owner decision;
3. `DECISION_REGISTER_V1.md`;
4. `SPEC_CONSISTENCY_V1.md`;
5. specialized V1 domain spec;
6. broad `ARCHITECTURE_V1.md` overview;
7. examples/non-normative discussion.

Important normalized rule:

> V1 never lets one mint run spill into a second service level. Mint/acquisition quantity is bounded to the currently eligible fairness-floor cohort.

`FAIRNESS_RANDOMNESS_V1.md` + `FAIRNESS_VECTORS_V1.md` govern allocation semantics.

## 4. Global context every package should know

Keep this set small unless a package explicitly requires more:

```text
README.md
DECISION_REGISTER_V1.md
SPEC_CONSISTENCY_V1.md
INTEGRATION_MAP_V1.md
THREAT_MODEL_V1.md
ERROR_CODES_V1.md
ACCEPTANCE_MATRIX_V1.md
```

The package prompt/implementation packet then supplies the narrower technical context.

## 5. Package-specific reading map

### Package A — current Community Census

Read additionally:

```text
PACKAGE_A_B_IMPLEMENTATION_V1.md
DATA_MODEL_V1.md
REFERENCE_INTERFACES_V1.md
existing distribution-ccff00.ts
existing distribution-domain.ts
```

Do not read mint/provider/payment docs unless needed to understand a referenced type.

No provenance, database, signer, provider or UI work.

### Package B — original mint provenance

Read additionally:

```text
PACKAGE_A_B_IMPLEMENTATION_V1.md
DATA_MODEL_V1.md
OPERATIONS_FAILURES_V1.md relevant chain/reorg sections
```

Do not modify `apps/indexer`.

Original mint clustering remains analytics only.

### Package C — observer discovery + curation calibration

Read additionally:

```text
PACKAGE_C_D_IMPLEMENTATION_V1.md
DISCOVERY_SOURCES_V1.md
UPSTREAM_REUSE_V1.md
MINT_ADAPTERS_V1.md
QUALITY_POLICY_V1.md
QUALITY_CALIBRATION_V1.md
OPERATIONS_FAILURES_V1.md provider-failure sections
```

Current observer-source priorities include OpenSea, HoodMint, WATCH PROJECT and bounded Blockscout/onchain enrichment. Revalidate all live capabilities.

No signer.

### Package D — mint admission/safety plan

Read additionally:

```text
PACKAGE_C_D_IMPLEMENTATION_V1.md
MINT_ADAPTERS_V1.md
QUALITY_POLICY_V1.md
QUALITY_CALIBRATION_V1.md
ACQUISITION_INVENTORY_V1.md
GAS_COST_MODEL_V1.md
THREAT_MODEL_V1.md mint threats
DATA_MODEL_V1.md mint-plan/evidence schemas
REFERENCE_INTERFACES_V1.md
```

Key V1 boundary:

```text
mint to isolated collector first
→ reconcile/commit exact inventory
→ randomize later
```

Do not optimize into direct mint-to-winner/TBA in V1 merely to save one transfer.

No signer.

### Package E — Fair Allocation V1

Read additionally:

```text
PACKAGE_E_F_IMPLEMENTATION_V1.md
FAIRNESS_RANDOMNESS_V1.md
FAIRNESS_VECTORS_V1.md
DELIVERY_REPAIR_V1.md
IDENTITY_SYBIL_V1.md
ACQUISITION_INVENTORY_V1.md
DATA_MODEL_V1.md fairness/allocation schemas
REFERENCE_INTERFACES_V1.md
```

Package E should be mostly pure deterministic domain code/tests.

Important additions:

- preserve/hash the full shuffled original eligible-floor cohort so unused seats provide deterministic Tier-1 repair standby order;
- V1 is address-fair, not one-human-one-seat; do not add Sybil heuristics;
- no live NFT movement.

### Package F — CCFF00 NFT custody canary harness

Read additionally:

```text
PACKAGE_E_F_IMPLEMENTATION_V1.md
ACQUISITION_INVENTORY_V1.md
DELIVERY_REPAIR_V1.md relevant TBA/delivery behavior
DATA_MODEL_V1.md
THREAT_MODEL_V1.md delivery/TBA threats
OPERATIONS_FAILURES_V1.md reconciliation sections
existing distribution-ccff00-owner-withdrawal-proof.ts
```

Build harness/tests before any separately authorized live canary.

Resolve safeTransferFrom vs transferFrom from exact deployed TBA evidence.

### Package G — isolated collector canary

Read additionally:

```text
PACKAGE_G_H_IMPLEMENTATION_V1.md
ACQUISITION_INVENTORY_V1.md
MINT_ADAPTERS_V1.md
QUALITY_POLICY_V1.md
OPERATIONS_FAILURES_V1.md
THREAT_MODEL_V1.md
GAS_COST_MODEL_V1.md
GAS_FUNDING_V1.md collector/gas boundary
```

Requires explicit owner authorization and exact tiny gas budget.

Prefer first canary quantity 1 when the admitted mint semantics allow it.

### Package H — limited runtime

Read additionally:

```text
PACKAGE_G_H_IMPLEMENTATION_V1.md
DATA_MODEL_V1.md
OPERATIONS_FAILURES_V1.md
THREAT_MODEL_V1.md
FAIRNESS_RANDOMNESS_V1.md
DELIVERY_REPAIR_V1.md
IDENTITY_SYBIL_V1.md
ACQUISITION_INVENTORY_V1.md
MINT_ADAPTERS_V1.md
QUALITY_POLICY_V1.md
QUALITY_CALIBRATION_V1.md
GAS_COST_MODEL_V1.md
PUBLIC_PROOFS_V1.md
```

Before implementation, propose service/storage/single-writer ownership and get the architecture decision recorded. Do not place execution in `apps/indexer` or `apps/market-indexer`.

Repair must remain deterministic; no manual replacement-winner control.

### Package I — gas funding/vault

Read additionally:

```text
PACKAGE_I_J_K_IMPLEMENTATION_V1.md
GAS_FUNDING_V1.md
GAS_COST_MODEL_V1.md
THREAT_MODEL_V1.md gas-vault threats
existing ProtocolPurposeVault.sol only as architecture reference
```

A valid result is `DEFER GAS VAULT` if measured Package H operations do not justify a new contract.

No current terminal-revenue policy change is implied.

### Package J — RMT Pay compatibility

Read additionally:

```text
PACKAGE_I_J_K_IMPLEMENTATION_V1.md
RMT_PAY_V1.md
RMT_PAY_COMPATIBILITY_V1.md
THREAT_MODEL_V1.md RMT Pay threats
REFERENCE_INTERFACES_V1.md
existing FixedSupplyMemeToken.sol
existing CCFF00 owner-control proof
```

Do not redeploy RMT.

A valid result is `RMT_PAY_NOT_CURRENTLY_SAFE`.

### Package K — RMT Pay utility

Read additionally:

```text
PACKAGE_I_J_K_IMPLEMENTATION_V1.md
RMT_PAY_V1.md
RMT_PAY_COMPATIBILITY_V1.md
DATA_MODEL_V1.md payment policy/receipt schemas
REFERENCE_INTERFACES_V1.md
PUBLIC_PROOFS_V1.md
THREAT_MODEL_V1.md
```

Requires separate product/economics authorization.

## 6. Locked product rules Codex should not reopen

```text
one current owner address = one seat
Square count does not multiply odds
V1 does not claim one-human-one-seat
no cross-wallet human inference
current ownership beats original mint history
public-mint CCFF00 range only in V1
donations create zero allocation advantage
least-served-first fairness
one mint run stays within one fairness-floor cohort
acquisition block anchors allocation census
future randomness round is deterministic from fixed policy
no NFT value/rarity/hype weighting
mint into isolated collector first; commit inventory before winner/token pairing
no post-acquisition cherry-picking
known mint adapters only
free means exact native mint value == 0
one collector identity; no burner evasion
operator controls: START / STOP / WATCH PROJECT
collector isolated from admin/treasury/deployer/users
delivery repair is deterministic; operator cannot pick replacement winner
RMT Pay utility -> 0x000000000000000000000000000000000000dEaD
no automatic RMT -> ETH sale
collector gas funding and RMT Pay gas sponsorship are separate rails
no RMT redeployment for burn()/permit()
```

If an implementation would be easier by violating one of these, stop and report the conflict instead of changing the rule.

## 7. Deferred decisions Codex may resolve only in the designated package

Use `DECISION_REGISTER_V1.md` for the full register. Key examples:

```text
live unique owner count -> A
original multi-mint counts/deployment boundary -> B
OpenSea/HoodMint live technical capability -> C
exact first Robinhood mint-family adapter -> C/D
quality threshold -> after C calibration evidence
randomness lead seconds -> E
safeTransferFrom vs transferFrom to TBA -> F
collector technology -> G
numeric gas/quantity/day/inventory caps -> measured G/H evidence
runtime service/storage -> H architecture decision
gas vault/refill values/need -> I
RMT Pay sponsorship/account model -> J
RMT Pay utility price -> K owner economics decision
```

Do not resolve future-package decisions early simply because they are visible.

## 8. Build sequence

```text
A Census
  ↓
B Mint provenance
  ↓
C Observer discovery/curation calibration
  ↓
D Mint safety plans
  ↓
E Fairness/randomness proof
  ↓
F CCFF00 NFT custody proof
  ↓
G isolated collector one-mint canary
  ↓
H limited autonomous runtime
  ↓
I community gas vault if evidence shows need
  ↓
J RMT Pay compatibility
  ↓
K RMT Pay admitted utility
```

Passing one package never auto-authorizes the next.

## 9. What “clean handoff” means

Codex should not spend usage deciding:

- what fairness means;
- whether donors get extra odds;
- how many seats a whale gets;
- whether old minter or current owner controls entitlement;
- whether to guess same-human wallets;
- whether to use blockhash randomness;
- whether to assign token IDs before inventory is known;
- whether to sell RMT for gas;
- whether to redeploy RMT;
- whether to use arbitrary mint calldata;
- whether to merge Community Engine state into V6 indexer;
- whether a replacement winner is manually selected.

Those decisions are already made.

Codex implements one bounded primitive against current repository reality, proves it with evidence/tests, and stops.

## 10. First future Codex instruction

When the owner explicitly opens the project, use **Prompt A** from `CODEX_PROMPTS_V1.md` only.

The first concrete answer required from code is:

> At this exact pinned Robinhood block, how many admitted public CCFF00 Squares exist, how many unique current owner addresses hold them, and what are their canonical token-bound accounts?

Everything else builds on that evidence.
