# CCFF00 Community Engine specification consistency V1

**Status:** PLANNING ONLY — NORMATIVE CONSISTENCY / ERRATA RECORD  
**Purpose:** remove ambiguity created as the design became more precise over multiple planning passes.

This file does not create new product behavior. It records which newer locked/specialized rules supersede older generalized wording that may still exist elsewhere in the planning branch.

## 1. Precedence

If wording conflicts, use:

1. current repository authority on latest `main`;
2. explicit later owner decision;
3. `DECISION_REGISTER_V1.md`;
4. this consistency record;
5. specialized domain document for the exact topic;
6. broad `ARCHITECTURE_V1.md` overview;
7. examples/non-normative discussion.

The planning branch remains reference-only and does not override current RMT architecture authority.

## 2. Resolved conflict C-001 — one mint run may not spill into the next service level

### Older generalized wording

An earlier broad architecture draft described behavior equivalent to:

```text
if inventory exceeds the current floor cohort:
  serve entire cohort
  recompute floor
  continue assigning remaining inventory
```

That wording is superseded for V1.

### Normative V1 rule

From locked decision `CE-007` and `FAIRNESS_RANDOMNESS_V1.md`:

```text
ONE MINT RUN = ONE V1 ALLOCATION BATCH
```

and:

```text
acquiredQuantity <= eligible current fairness-floor cohort
```

One mint run cannot assign a second Community Engine allocation to any seat while another active seat remains at the prior service level.

### Required acquisition behavior

Before signing:

```text
admittedQuantity = min(
  creator/project wallet allowance,
  authoritative remaining supply when available,
  local max quantity policy,
  eligible current-floor seats without prior same-collection coverage
)
```

If the mint contract lets the collector choose quantity, use only the admitted quantity.

If the mint contract forces a quantity larger than the admitted cohort:

```text
DO NOT AUTO-MINT IN V1
```

Use an explicit reason such as:

```text
MINT_QUANTITY_EXCEEDS_FAIRNESS_COHORT
```

### Invalid example

```text
2 floor seats
3 NFTs in same mint run
A receives 1
B receives 1
A or B receives the 3rd
```

is invalid V1 behavior.

## 3. Resolved conflict C-002 — acceptance tests with inventory larger than cohort are rejection/cap tests

Any acceptance-matrix or simulation example such as:

```text
100 seats / 250 NFTs
```

must not be interpreted as authorization for a single V1 mint run to allocate 250 NFTs across multiple service levels.

It is useful only as an adversarial test proving one of the following:

- the acquisition quantity is capped at the eligible floor cohort before signing; or
- a forced oversized quantity is rejected/observe-only.

For accepted allocation-result tests, require:

```text
inventoryCount <= eligibleFloorSeatCount
```

## 4. Resolved conflict C-003 — current owner seat vs original minter

### Normative rule

```text
current owner address at admitted census = seat identity
```

Original mint recipient clustering is analytics/provenance only.

If Wallet A originally received/minted three Squares but later sells two to B/C:

```text
current seats = A, B, C
```

assuming each still holds at least one admitted public Square.

No provenance artifact can override `ownerOf` current-seat eligibility.

## 5. Resolved conflict C-004 — multiple Squares do not multiply odds

### Normative rule

```text
one current owner address = one seat = weight 1
```

whether that owner holds:

```text
1 Square
3 Squares
10 Squares
```

Square multiplicity affects only destination selection within the selected seat.

There is no `squareCount` multiplier in the allocation function.

## 6. Resolved conflict C-005 — Square ownership must be refreshed before delivery

An older conceptual description could be read as “the NFT is assigned to a Square and follows that Square even if sold before delivery.” That is not the selected V1 behavior for a pending assignment.

### Normative rule

The acquisition-block census determines the selected **seat** and produces a deterministic preference order among Squares that seat owned at the anchor block.

Immediately before delivery signing:

1. re-read current ownership for the precommitted preference order;
2. choose the first Square still owned by the selected seat;
3. if none remain, mark `STALE_SEAT_OWNERSHIP` / repair-required;
4. do not send the pending gift to a Square that the selected seat already sold;
5. do not let the operator manually substitute another Square/seat.

Once an NFT has already been successfully delivered into a CCFF00 TBA, later transfer of that Square naturally transfers control of the TBA/inventory with the Square. This is distinct from pre-delivery ownership drift.

## 7. Resolved conflict C-006 — collection diversity is acquisition/eligibility policy, not value equalization

V1 tracks whether a seat has already received a confirmed Community Engine NFT from collection `C`.

For a new `C` mint run, the default eligible set is:

```text
current fairness-floor seats
AND
no prior confirmed Community Engine receipt from C
```

If every eligible floor seat already has `C`, automatic duplicate acquisition is disabled by default:

```text
COLLECTION_COVERAGE_COMPLETE
```

A second same-collection coverage round requires a new explicit policy version.

This rule uses only collection identity/history. It never compares floor price, rarity, bids or expected value.

## 8. Resolved conflict C-007 — donor data is outside allocation dependency graph

Normative implementation target:

```text
GasFundingLedger
     X
     X no dependency
     X
FairAllocationV1
```

The strongest implementation is that the pure allocator does not receive contribution data at all.

Any future function signature that accepts donor amount/weight as an allocation input violates locked decision `CE-005`.

## 9. Resolved conflict C-008 — randomness round is not operator-selected

Earlier conceptual planning described committing an arbitrary future randomness round before it existed.

The more precise V1 rule removes even that operator choice.

### Normative rule

```text
confirmed acquisition block timestamp
+ fixed versioned randomnessLeadSeconds
→ deterministic target time
→ first admitted drand round at/after target time
```

The operator does not choose the round after seeing inventory.

If the exact derived round is unavailable/unverifiable:

```text
WAIT
```

Do not silently use another valid round.

## 10. Resolved conflict C-009 — allocation census anchor

Normative V1:

```text
allocationAnchorBlock = confirmed acquisition tx block
allocationCensusBlock = allocationAnchorBlock
```

Use archive-capable reads to reconstruct canonical CCFF00 ownership/TBAs at that historical block.

Do not choose “latest” after seeing the project/token IDs/randomness.

If historical state is unavailable, stop and require a new reviewed policy rather than silently switching anchors.

## 11. Resolved conflict C-010 — service level changes only after confirmed delivery

Planning an assignment does not increment fairness state.

Submitting a transfer does not increment fairness state.

Only reconciled confirmed delivery to an admitted current-owned Square/TBA increments:

```text
seat.serviceLevel += 1
square.deliveryCount += 1
```

If a transaction is uncertain, the assignment remains unresolved and blocks unsafe retry/next-level allocation as required by the fairness/failure policy.

## 12. Resolved conflict C-011 — RMT Pay burn accounting

Normative protocol-utility flow:

```text
RMT source
→ 0x000000000000000000000000000000000000dEaD
```

No automatic DEX sale.

No treasury recycling.

No RMT→ETH conversion to finance gas.

Native gas sponsorship is a separate accounting rail.

Because current RMT has immutable nominal `totalSupply()` and no native burn method:

- `totalSupply()` remains unchanged;
- dead-address balance increases;
- public UI reports effective circulating supply separately;
- protocol-attributed RMT Pay burns are not assumed equal to total dead-address balance.

## 13. Resolved conflict C-012 — current RMT token is retained

No missing convenience feature (`permit`, native `burn`) is itself a reason to redeploy/migrate the token.

A redeploy would require a separate fundamental-contract defect decision. The Community Engine/RMT Pay planning found no such required migration.

## 14. Resolved conflict C-013 — Community Engine does not inherit Distribution Engine RMT retirement economics

`RMTDistributionEngineV1.sol` is a useful security reference for typed NFT transfer/postconditions.

Its existing per-recipient RMT retirement economics are **not** the Community Engine collector's economics.

Collector V1 acquisition/distribution is funded in native ETH gas and does not require a holder/collector RMT payment merely to receive a Community Engine NFT.

## 15. Resolved conflict C-014 — terminal revenue is future optional funding only

No current RMT terminal fee/revenue policy implicitly funds the Community Engine.

Future choices include:

- voluntary treasury/operations contribution; or
- separately versioned revenue-policy allocation.

Both require explicit later economics authority.

Do not modify `RMT_EXECUTION_V1` as part of Packages A–I unless a separate owner decision explicitly changes that boundary.

## 16. Resolved conflict C-015 — collector gas vs RMT Pay sponsor billing

The future Community Engine collector may eventually have an onchain ETH gas vault/refill mechanism.

RMT Pay gasless user actions may use a third-party account-abstraction sponsor/paymaster whose billing/funding mechanism is different.

Do not assume one gas pool automatically funds the other.

Treat them as independent until a later explicit treasury/ops integration is proven.

## 17. Resolved conflict C-016 — provider output never becomes signing authority

OpenSea or any other provider may:

- discover candidate;
- provide stage metadata;
- suggest/build transaction data.

RMT must independently:

- resolve target/runtime/proxy;
- decode selector/arguments;
- verify exact native value zero;
- verify quantity/recipient/allowlist semantics;
- simulate;
- bind an unsigned plan;
- refresh evidence immediately before any future signing.

There is no generic “trust provider transaction” path.

## 18. Resolved conflict C-017 — unknown custom mints remain observer-only

The fact that a contract is verified or that a transaction simulates successfully does not admit arbitrary mint calldata.

V1 automatic signing requires a positive-allowlisted versioned mint adapter with known semantics/postconditions.

Unknown selector/family:

```text
UNKNOWN_ADAPTER
```

not “try it and see.”

## 19. Resolved conflict C-018 — public proof claim is process fairness, not financial equality

Allowed future claim after evidence exists:

> Allocation is reproducible from the published acquisition, census, policy and verified randomness evidence.

Not allowed:

- equal NFT value guaranteed;
- safe investment;
- all projects trustworthy;
- one-human-one-seat/Sybil-proof;
- no smart-contract risk.

## 20. Codex requirement

Every future Community Engine implementation package should read this file if its task touches:

- fairness;
- ownership drift;
- quantity selection;
- randomness;
- gas/funding;
- RMT Pay;
- provider execution boundaries.

If an old example elsewhere conflicts with this record, do not implement both interpretations. Follow the precedence above and report the stale wording in the PR summary if it materially affected implementation.
