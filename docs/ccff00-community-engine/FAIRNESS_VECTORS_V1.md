# CCFF00 Fair Allocation V1 — deterministic test vectors

**Status:** PLANNING ONLY — REFERENCE VECTORS FOR FUTURE CODEX IMPLEMENTATION  
**Normative source:** `FAIRNESS_RANDOMNESS_V1.md`

These vectors are synthetic. They do not identify real CCFF00 holders and do not authorize any live allocation.

## 1. V1 rule these vectors enforce

A single mint run may serve **only the current fairness-floor cohort**.

```text
quantity <= eligible current-floor seats
```

A mint run must never spill into the next service level. If the project forces a quantity larger than the eligible floor cohort, V1 rejects/observes that opportunity rather than assigning second-turn NFTs early.

This file therefore supersedes any earlier draft/vector that allowed one mint run to cross multiple fairness levels.

## 2. Reference allocation order

For one admitted mint run:

1. anchor the allocation census to the confirmed acquisition transaction block;
2. load persistent confirmed service levels;
3. compute the active `communityFloor`;
4. build only the cohort with `serviceLevel == communityFloor`;
5. remove seats already holding a confirmed receipt from this same collection when V1 collection-diversity policy applies;
6. require `inventory.length <= eligibleFloorCohort.length`;
7. canonical-sort and deterministically shuffle eligible seats;
8. canonical-sort and independently shuffle acquired inventory;
9. pair item `k` with selected seat `k`;
10. choose a destination from that seat's currently held least-served Squares using the precommitted deterministic Square preference order;
11. persist actual service/delivery counters only after confirmed NFT delivery.

## 3. Test-randomness interface

Allocation tests should not depend on live drand.

Use a deterministic fake source:

```text
nextBounded(domain, bound) -> integer where 0 <= value < bound
```

Production randomness tests separately prove:

```text
verified drand beacon
→ seed
→ domain-separated keccak stream
→ rejection sampling
→ bounded draws
```

Allocation correctness and external-randomness correctness must be independently testable.

## 4. Canonical shuffle convention

Addresses are canonical-sorted ascending by lowercase byte value before shuffling.

Inventory is canonical-sorted by collection address, then numeric token ID.

Square token IDs are canonical-sorted numerically.

For array length `n`, Fisher-Yates runs from `i=n-1` down to `1`:

```text
j = nextBounded(domain, i + 1)
swap(array[i], array[j])
```

One-item lists consume no draw.

## 5. Synthetic identities

```text
A = 0x0000000000000000000000000000000000000001
B = 0x0000000000000000000000000000000000000002
C = 0x0000000000000000000000000000000000000003
D = 0x0000000000000000000000000000000000000004

P1 = 0x1000000000000000000000000000000000000001
P2 = 0x1000000000000000000000000000000000000002
P3 = 0x1000000000000000000000000000000000000003
```

## 6. V1-01 — one NFT, two equal seats

Seats:

```text
A: serviceLevel=0, Squares=[101]
B: serviceLevel=0, Squares=[201]
```

Inventory:

```text
P1 #1
```

Recipient shuffle canonical `[A,B]`:

```text
bound=2 -> 0
```

Result:

```text
[B,A]
```

Expected assignment:

```text
P1 #1 -> B -> Square 201
```

After confirmed delivery:

```text
A=0
B=1
```

## 7. V1-02 — next project must serve the remaining floor seat

Start after confirmed V1-01:

```text
A=0
B=1
```

New mint run inventory:

```text
P2 #1
```

Only A is at the floor.

Expected:

```text
P2 #1 -> A -> Square 101
```

After confirmation:

```text
A=1
B=1
```

No randomness may allow B to advance to 2 while A remains at 0.

## 8. V1-03 — oversized mint run is rejected before signing

Seats:

```text
A=0
B=0
```

Eligible floor cohort size:

```text
2
```

Proposed project mint quantity:

```text
3
```

Expected:

```text
REJECT / OBSERVE
reason = MINT_QUANTITY_EXCEEDS_FAIRNESS_COHORT
```

The engine must **not** mint three and give one seat a second allocation.

If creator mechanics permit choosing quantity, plan quantity is capped at 2 subject to all other mint limits/policies. If the mint semantics force exactly 3, automatic V1 execution is not admitted.

## 9. V1-04 — whale Square count does not change seat weight

```text
A: serviceLevel=0, Squares=[101]
B: serviceLevel=0, Squares=[201,202,203,204,205,206,207,208,209,210]
```

Inventory quantity=2.

Required property:

```text
A receives exactly one seat-level assignment
B receives exactly one seat-level assignment
```

B's 10 Squares affect only destination selection for B's single allocation.

## 10. V1-05 — least-served Square only

A owns:

```text
Square 101 deliveryCount=3
Square 102 deliveryCount=2
Square 103 deliveryCount=2
```

Eligible Square set:

```text
[102,103]
```

Fake Square shuffle:

```text
bound=2 -> 0
```

Expected preference order:

```text
[103,102]
```

Expected first destination:

```text
Square 103
```

Square 101 is forbidden for this assignment.

## 11. V1-06 — same-project token IDs are randomly paired

Seats:

```text
A=0
B=0
C=0
```

Inventory:

```text
P1 #10
P1 #11
P1 #12
```

The seat shuffle and inventory shuffle use different randomness domains.

Required properties:

- each seat receives exactly one NFT;
- each token ID appears exactly once;
- changing only the inventory random stream may change tokenId-to-seat pairing without changing the selected floor cohort;
- operator has no tokenId assignment input.

## 12. V1-07 — prior same-collection receipt removes seat from collection cohort

Active service levels:

```text
A=2
B=2
C=2
```

Confirmed collection history:

```text
A already received P1
B has not received P1
C has not received P1
```

New P1 inventory quantity=2.

Eligible floor cohort for this collection:

```text
[B,C]
```

Expected:

- A is not selected for P1 in default V1 collection-coverage policy;
- B and C each receive one;
- no value/rarity input is considered.

## 13. V1-08 — every floor seat already has this collection

All active floor seats already have a confirmed P1 receipt.

New free P1 opportunity appears.

Expected default V1 behavior:

```text
OBSERVE / DO NOT AUTO-ACQUIRE DUPLICATES
reason = COLLECTION_COVERAGE_COMPLETE
```

A second collection-coverage round requires a new explicit policy version; it is not implied by V1.

## 14. V1-09 — new holder joins at current floor

Existing active state:

```text
A=5
B=5
C=6
```

Current floor=5.

New owner D appears in the next batch census.

Expected initialization:

```text
D=5
```

D participates going forward but receives no historical catch-up backlog.

## 15. V1-10 — re-entry cannot reset history

Before D exits:

```text
D previousServiceLevel=7
```

Community progresses while D is absent:

```text
currentFloor=10
```

D returns.

Expected:

```text
D = max(7,10) = 10
```

## 16. V1-11 — Square transfer changes destination ownership

Acquisition-block census:

```text
A owns [101,102]
B owns [201]
```

Assignment for A stores deterministic Square preference order:

```text
[102,101]
```

Before delivery, A sells Square 102.

Pre-distribution ownership check:

```text
102 no longer owned by A
101 still owned by A
```

Expected destination:

```text
Square 101
```

This fallback is deterministic from the precommitted preference order.

If A owns none of the preferred Squares anymore:

```text
STALE_SEAT_OWNERSHIP
```

No operator picks a substitute.

## 17. V1-12 — ETH contributions cannot affect allocation

Run X:

```text
A contributed 0 ETH
B contributed 10 ETH
```

Run Y:

```text
A contributed 100 ETH
B contributed 0 ETH
```

All normative allocation inputs/randomness are identical.

Expected:

```text
allocationResultHash(X) == allocationResultHash(Y)
```

Preferred implementation: contribution data is absent from allocator inputs entirely.

## 18. V1-13 — floor price/rarity cannot affect allocation

Run X presentation metadata:

```text
P1 #10 estimated rarity=common
P1 #11 estimated rarity=rare
```

Run Y reverses those labels.

Expected:

```text
allocationResultHash(X) == allocationResultHash(Y)
```

Preferred implementation: market-value/rarity fields do not exist in allocation inventory schema.

## 19. V1-14 — inventory mutation invalidates allocation evidence

Committed acquired inventory:

```text
P1 #10
P1 #11
```

After randomness becomes known, replace P1 #11 with P1 #99.

Expected:

```text
newInventoryHash != committedInventoryHash
```

Prior allocation result is invalid; do not preserve/reroll around the mutation.

## 20. V1-15 — acquisition-block census anchor is mandatory

Acquisition confirms in block `B`.

Operator attempts to use a later block `B+100` census because preferred wallets changed.

Expected:

```text
REJECT ALLOCATION_CENSUS_ANCHOR_MISMATCH
```

V1 census block must equal the confirmed acquisition anchor block under the normative fairness policy.

## 21. V1-16 — randomness round is deterministically derived

Acquisition block timestamp and fixed policy lead deterministically imply drand round `R`.

Operator supplies valid round `R+1`.

Expected:

```text
REJECT RANDOMNESS_ROUND_MISMATCH
```

Do not accept a different valid round.

## 22. V1-17 — invalid beacon signature

Round/JSON fields look valid, but threshold signature verification against the pinned admitted drand network identity fails.

Expected:

```text
REJECT RANDOMNESS_SIGNATURE_INVALID
```

Inventory stays committed and waits; no fallback randomness.

## 23. V1-18 — duplicate inventory identity

Same `(collection, tokenId)` appears twice.

Expected:

```text
REJECT INVENTORY_DUPLICATE_ASSET
```

before allocation/randomness consumption.

## 24. V1-19 — partial delivery does not let successful seat jump ahead

Floor cohort selected for one mint run:

```text
A level 4 -> assignment X
B level 4 -> assignment Y
```

X confirms; Y remains unresolved.

Persistent state:

```text
A=5
B=4
```

Until Y is resolved/confirmed or repaired, A is ineligible for a new level-5 allocation because an active seat remains at 4.

## 25. V1-20 — restart after confirmed transfer is idempotent

Assignment X confirms onchain but the process crashes before local state update.

Restart reconciliation must:

- load deterministic assignment ID;
- prove NFT ownership/receipt;
- mark X confirmed;
- increment seat once;
- increment Square once;
- submit no second transfer.

Property:

```text
reconcile(reconcile(state)) == reconcile(state)
```

## 26. V1-21 — quantity is capped by collection coverage

Floor cohort has 50 seats, but only 17 have not yet received P2.

Creator allows 40 mints.

Local max is 30.

Expected V1 acquisition quantity:

```text
min(40 creator limit, 30 local max, 17 uncovered floor seats) = 17
```

subject to authoritative remaining supply and all other adapter checks.

## 27. V1-22 — no eligible floor seat means no auto-mint

A free mint is safe technically, but current floor cohort eligible-for-collection count is zero.

Expected:

```text
OBSERVE
AUTO_MINT=false
reason=NO_ELIGIBLE_FAIRNESS_RECIPIENTS
```

The engine does not mint into inventory merely because gas is cheap.

## 28. Production bounded-draw reference

For bound `b > 0`, use rejection sampling over 256-bit words.

```text
M = 2^256
limit = floor(M / b) * b

if w >= limit:
  reject and draw next domain/counter word
else:
  value = w mod b
```

Tests must cover at least one bound that does not divide `2^256` and words on both sides of the rejection threshold.

## 29. Required property tests

Generate thousands of synthetic cases and assert:

```text
selectedSeatCount == inventoryCount
inventoryCount <= eligibleFloorCohortCount
all selected seats started at communityFloor
all selected seats unique within mint run
all assigned NFTs unique
all selected Squares are valid deterministic destinations for selected seat
Square count never changes seat weight
funding data cannot change result
value/rarity data cannot change result
same canonical inputs + same verified randomness => same allocation hash
```

Across sequential confirmed mint runs, assert:

```text
no active seat can receive service level N+1 while another active seat remains at N
```

## 30. Explicit invalid legacy vector

Any earlier development vector with semantics equivalent to:

```text
2 floor seats
3 NFTs in one mint run
serve both seats, then give third NFT to one of them
```

is **invalid for V1**.

Expected V1 outcome is to cap/reject the acquisition at the current eligible floor cohort before signing.
