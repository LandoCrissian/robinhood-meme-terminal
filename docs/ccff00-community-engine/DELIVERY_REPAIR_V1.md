# CCFF00 Community Engine deterministic delivery repair V1

**Status:** PLANNING ONLY — FUTURE AUTOMATED REPAIR POLICY  
**Goal:** resolve ownership drift/delivery failures without operator-selected winners or silent randomness rerolls.

This document refines `REPAIR_REQUIRED` into deterministic V1-compatible behavior while preserving original proof history.

## 1. Repair principle

A Community Engine assignment can fail after allocation for reasons outside recipient selection, such as:

- selected owner sold all committed Squares before delivery;
- selected Square/TBA no longer satisfies canonical runtime/configuration;
- transfer method becomes invalid under changed NFT state;
- a delivery transaction reorgs/fails and original delivery target is no longer valid.

Repair must not become:

```text
operator picks another holder
operator rerolls until happy
operator swaps in another NFT
```

Every repair is deterministic from public/persisted evidence.

## 2. Primary pre-delivery Square repair

Every selected seat assignment stores a deterministic Square preference order derived from acquisition-block ownership + Square delivery counts + precommitted randomness.

Immediately before signing:

```text
for square in preferenceOrder:
  if current owner(square) == assignedSeatOwner
     and canonical TBA/runtime valid:
        use square
        stop
```

If first preference was sold but a later preferred Square is still owned by the selected seat, delivery proceeds there.

No new randomness is required.

## 3. Seat-level ineligibility

If selected owner no longer owns **any** eligible Square from the committed preference set:

```text
PRIMARY_SEAT_INELIGIBLE
```

Do not send the NFT to a sold Square/new buyer under the original assignment because the V1 fairness unit was the selected owner seat, not the Square itself.

Do not increment the departed seat's service level.

## 4. Full eligible-seat shuffle, not only selected prefix

Package E should preserve/hash the full shuffled eligible floor cohort, not merely the first `q` selected seats.

Conceptually:

```text
eligibleSeatShuffle = [S0, S1, ... S(n-1)]
primarySeats = first q
standbySeats = remaining n-q
```

This does not create extra recipients; it creates a deterministic fallback order if a primary becomes objectively ineligible before delivery.

The full order is already determined by the same verified batch randomness.

## 5. Standby repair

For an unresolved inventory item whose primary seat is ineligible:

1. scan standby seats in their committed order;
2. skip any seat already used by this mint run;
3. skip any seat no longer active/holding an admitted public CCFF00 at the repair check;
4. skip any seat whose current service level is no longer eligible under the blocked fairness state;
5. skip any seat that has already received the same collection under confirmed Community Engine history;
6. first remaining seat becomes repair recipient;
7. derive/lookup that seat's deterministic Square preference order from the original batch root randomness and its acquisition-block Square set;
8. refresh current Square ownership as normal;
9. preserve a `RepairAssignmentV1` linking original assignment to standby replacement.

No new random beacon is needed for this first repair tier.

## 6. Why standby repair is fair

Standby seats:

- were in the same original acquisition-block fairness-floor cohort;
- passed the same collection-coverage filter;
- were placed in a public random order before any delivery drift occurred;
- were not selected initially only because acquired quantity was smaller than cohort size.

Using the first still-eligible standby does not favor donors, whales or operator choice.

## 7. Block fairness progress while unresolved

An unresolved assignment from floor `N` prevents the engine from issuing a new allocation that would advance another active seat from `N+1` to `N+2` while a valid `N` repair is pending.

Runtime should prioritize:

```text
reconcile/repair committed inventory
```

before acquiring new inventory that would advance fairness beyond the unresolved floor.

This keeps standby service levels from racing ahead before repair.

## 8. No standby available

This occurs when:

- acquired quantity equals full eligible cohort; or
- all standby seats became ineligible/covered before repair.

The NFT remains:

```text
COMMITTED_REPAIR_INVENTORY
```

It is not sold, swept, reassigned manually or dropped from proof history.

## 9. Tier-2 repair allocation

If no original standby remains, create a new deterministic **repair allocation** using current eligible community state.

Trigger is objective:

```text
original assignment has no eligible primary/standby recipient
AND collector still owns exact committed NFT
```

### Repair anchor

Use the confirmed block in which the runtime establishes the terminal original-cohort ineligibility condition, or another exact objectively defined block chosen by the final implementation policy.

The repair policy must define this mechanically; the operator cannot select a favorable block.

Record:

```text
repairAnchorBlock
repairAnchorBlockHash
repairAnchorTimestamp
```

### Repair census

Reconstruct exact current CCFF00 census at repair anchor.

### Repair eligibility

Use current least-served active seats under normal V1 rules, excluding:

- seat that no longer qualifies;
- seats already confirmed for same collection;
- any seat whose inclusion would violate current service floor.

### Repair randomness

Derive a new future repair randomness round from:

```text
repairAnchorTimestamp
+ fixed versioned repairRandomnessLeadSeconds
```

using the same cryptographically verified randomness infrastructure but a distinct domain:

```text
CCFF00_DELIVERY_REPAIR_V1
```

This is not a reroll of the original assignment; it is a new transparent allocation event caused by objective recipient unavailability.

## 10. Repair priority vs new mint runs

`COMMITTED_REPAIR_INVENTORY` should normally be allocated/delivered before spending ETH on additional free mints at the same/next fairness level.

Reasons:

- minimizes collector custody;
- avoids accumulating unresolved community assets;
- preserves fairness accounting;
- prevents gas budget being spent acquiring more while owned inventory is stranded.

Exact queue priority can be implemented deterministically.

## 11. Tier-2 repair quantity

Repair allocation handles existing inventory; there is no new mint purchase/quantity decision.

For one orphaned NFT:

```text
repair quantity = 1
```

For multiple orphaned items from the same blocked run, they may be repaired as one deterministic repair batch only if:

```text
repairInventoryCount <= current eligible repair floor cohort
```

Else split deterministically into floor-bounded repair batches; no repair batch spills across fairness levels.

## 12. Repair collection coverage

The same project-diversity rule applies:

```text
recipient has no confirmed Community Engine receipt from this collection
```

If all active eligible floor seats already have the collection:

- do not give duplicate merely to clear inventory;
- keep item committed and surface `REPAIR_COLLECTION_COVERAGE_BLOCKED`;
- future explicit duplicate-coverage policy or community state change may resolve it.

Do not burn/sell the NFT automatically.

## 13. Repair because NFT transfer behavior changed

If the assigned recipient is valid but NFT transfer itself becomes impossible/nonstandard after acquisition:

- do not change recipient merely because another TBA might accept it;
- prove whether collection globally changed transfer behavior;
- pause adapter/project;
- keep item committed;
- use an explicit compatibility repair only if a safe transfer method exists for the same recipient.

Recipient repair is not a workaround for a malicious/nontransferable NFT.

## 14. Reorg repair

If delivery tx is reorged before finality:

- assignment remains original;
- reconcile collector/NFT ownership;
- if original seat still eligible, submit fresh verified delivery under normal retry policy;
- do not select standby merely because a reorg happened.

Standby/tier-2 applies only when original seat becomes objectively ineligible.

## 15. Transaction failure repair

A confirmed delivery failure with unchanged valid recipient/TBA:

- diagnose failure;
- rebuild exact safe delivery plan if policy permits;
- same recipient remains bound.

Do not treat “one revert” as permission to choose another winner.

## 16. Repair state model

Conceptual:

```ts
type CommunityRepairStateV1 =
  | "NOT_REQUIRED"
  | "PRIMARY_SQUARE_FALLBACK"
  | "PRIMARY_SEAT_INELIGIBLE"
  | "STANDBY_SELECTED"
  | "TIER2_REPAIR_WAITING_CENSUS"
  | "TIER2_REPAIR_WAITING_RANDOMNESS"
  | "TIER2_REPAIR_ASSIGNED"
  | "REPAIR_SUBMITTED"
  | "REPAIR_CONFIRMED"
  | "REPAIR_COLLECTION_COVERAGE_BLOCKED"
  | "REPAIR_ASSET_INCOMPATIBLE";
```

## 17. Repair assignment evidence

Reference:

```ts
type CommunityRepairAssignmentV1 = {
  schemaVersion: 1;
  originalAssignmentId: Hex;
  inventoryItemId: Hex;
  repairTier: 1 | 2;
  repairReason: string;
  repairAnchorBlock: UintString | null;
  repairCensusHash: Hex | null;
  repairRandomnessRecordHash: Hex | null;
  replacementSeat: Address;
  squarePreferenceOrder: UintString[];
  selectedSquareTokenId: UintString;
  repairHash: Hex;
};
```

Original assignment remains immutable/history-linked.

## 18. Fairness accounting after repair

Only the **confirmed final recipient seat** increments service level.

Original departed/ineligible seat does not increment.

Square delivery count increments only for the actual final destination Square.

Collection receipt history increments only for final confirmed recipient.

## 19. New owner that bought the originally preferred Square

The new buyer is **not automatically the repair winner** merely because they now own the Square.

They can participate through current fairness rules/repair census like any other active seat.

This avoids a transfer becoming a way to directly purchase a pending random allocation.

## 20. Repair manipulation resistance

An attacker could try to transfer selected Squares away after seeing an assignment in hopes of affecting who receives the NFT.

Mitigations:

- original seat loses its allocation if it exits eligibility;
- it cannot designate the standby;
- standby order already committed before drift;
- tier-2 repair uses new mechanically anchored public randomness;
- original seller cannot force NFT to their buyer;
- no service credit for failed/departed seat.

There is little incentive to intentionally abandon a randomly won allocation unless trying to grief the system; gas/pending-inventory caps and repair priority bound the damage.

## 21. Public repair proof

Future public history should show:

```text
original assignment
reason original destination became invalid
standby order or tier-2 repair anchor
repair census/randomness when tier 2
final repair assignment
final delivery tx
```

Do not rewrite the original proof packet to make it appear repair never happened.

## 22. Operator controls

No new manual control is introduced.

Operator still has only:

```text
START
STOP
WATCH PROJECT
```

Repair runs automatically under the admitted policy while STARTED, or remains safely pending while STOPPED.

No `CHOOSE_REPLACEMENT_WINNER` action exists.

## 23. Repair tests

Package E/H tests should cover:

- selected first Square sold, second preference still owned → deterministic Square fallback;
- selected seat sells all Squares, one standby → standby chosen;
- two primary seats exit → first two eligible standbys in committed order;
- standby already used → skipped;
- standby received same collection in confirmed intervening history → skipped;
- no standby → tier-2 repair state;
- repair anchor deterministic;
- wrong repair randomness round rejected;
- repair census tamper rejected;
- new buyer of originally selected Square does not automatically inherit assignment;
- original departed seat gets no service increment;
- final repair recipient increments once;
- crash after repair delivery before DB update reconciles idempotently;
- operator cannot change replacement seat;
- repair inventory prioritized over new fairness-advancing mint run.

## 24. V1 automation outcome

With this policy, normal ownership drift no longer requires the operator to choose a winner.

The engine either:

```text
uses another still-owned committed Square
→ uses a precommitted original-cohort standby
→ creates a publicly verifiable tier-2 repair allocation
→ or stays safely pending if no fair recipient exists
```

All paths preserve transparent history and the user-facing START/STOP/WATCH operating model.
