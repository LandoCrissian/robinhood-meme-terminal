# CCFF00 Fair Allocation V1 — deterministic test vectors

**Status:** PLANNING ONLY — REFERENCE VECTORS FOR FUTURE CODEX IMPLEMENTATION  
**Purpose:** separate allocation correctness from production randomness-provider correctness.

These vectors are synthetic. They do not identify real CCFF00 holders and do not authorize any live allocation.

## 1. Reference allocation order

Future `FairAllocationV1` should follow this logical order:

1. canonicalize the admitted census and active seat state;
2. canonicalize inventory;
3. find the current minimum active `serviceLevel`;
4. select only seats at that level;
5. deterministically shuffle those eligible seats;
6. for each selected seat:
   - choose one of that owner's least-served currently held Squares;
   - choose an NFT from the deterministically shuffled remaining inventory;
   - prefer the first remaining NFT whose collection the seat has not previously received;
   - if no nonduplicate collection remains, use the first remaining NFT;
7. project that seat's service level +1 for purposes of planning subsequent rounds in the same allocation batch;
8. if inventory remains after every current-floor seat has one projected assignment, recompute the floor and continue;
9. produce immutable assignment/result hashes;
10. persist actual fairness counters only after confirmed delivery, not merely after planning.

## 2. Two randomness layers

Tests should separate:

### Layer A — allocation logic random stream

A deterministic fake source supplies bounded draw results directly.

Interface concept:

```text
nextBounded(domain, bound) -> integer where 0 <= value < bound
```

This makes exact allocation vectors easy to reproduce without depending on drand, hashing or provider code.

### Layer B — production seed expansion

Separately test:

```text
verified external randomness
→ domain-separated keccak words
→ rejection sampling
→ bounded draws
```

Layer B must reproduce the bounded-draw interface. Allocation logic must not know whether draws came from a fake source, drand or a future VRF adapter.

## 3. Canonicalization rules for vectors

Addresses are canonical-sorted ascending by lowercase byte value before shuffling.

Inventory is canonical-sorted by:

```text
collection address ascending
then tokenId numeric ascending
```

Square token IDs are numeric-sorted before Square tie-breaking.

The fake random stream is consumed only when a choice has more than one candidate. A one-item list consumes no draw.

### Fisher-Yates convention

For an array of length `n`, shuffle from `i = n - 1` down to `1`:

```text
j = nextBounded(domain, i + 1)
swap(array[i], array[j])
```

This convention is part of the vector contract.

## 4. Synthetic identities

Use these canonical synthetic owner addresses:

```text
A = 0x0000000000000000000000000000000000000001
B = 0x0000000000000000000000000000000000000002
C = 0x0000000000000000000000000000000000000003
D = 0x0000000000000000000000000000000000000004
```

Synthetic collections:

```text
P1 = 0x1000000000000000000000000000000000000001
P2 = 0x1000000000000000000000000000000000000002
P3 = 0x1000000000000000000000000000000000000003
```

## 5. Vector V1-01 — one NFT, equal seats

### Seats

```text
A: serviceLevel=0, Squares=[101]
B: serviceLevel=0, Squares=[201]
```

### Inventory

```text
P1 #1
```

### Fake bounded draws

Recipient shuffle, canonical `[A,B]`:

```text
bound=2 -> 0
```

Fisher-Yates swaps index 1 with 0, producing:

```text
[B,A]
```

### Expected assignment

```text
P1 #1 -> B -> Square 201
```

### Expected projected levels

```text
A=0
B=1
```

### Required assertions

- A receives nothing;
- B receives exactly one;
- service-level gap is exactly 1;
- no Square-count weighting exists.

## 6. Vector V1-02 — second NFT restores equality

Start from confirmed state after V1-01:

```text
A: serviceLevel=0
B: serviceLevel=1
```

Inventory:

```text
P2 #1
```

Only A is at the community floor. No recipient shuffle draw is consumed.

Expected:

```text
P2 #1 -> A -> Square 101
```

Projected/confirmed after delivery:

```text
A=1
B=1
```

This vector proves randomness never permits B to advance to level 2 while A remains at 0.

## 7. Vector V1-03 — inventory spans more than one fairness round

### Seats

```text
A=0, Square 101
B=0, Square 201
```

### Inventory canonical order

```text
P1 #1
P2 #1
P3 #1
```

### Fake draws

Recipient floor-0 shuffle `[A,B]`:

```text
bound=2 -> 1
```

No swap, order `[A,B]`.

Inventory shuffle from `[P1#1,P2#1,P3#1]`:

```text
bound=3 -> 0
bound=2 -> 1
```

Step 1 swaps index 2 with 0:

```text
[P3#1,P2#1,P1#1]
```

Step 2 keeps index 1:

```text
[P3#1,P2#1,P1#1]
```

### Expected first round

```text
P3 #1 -> A
P2 #1 -> B
```

Projected levels become:

```text
A=1
B=1
```

One inventory item remains. Recompute floor=1.

Second-round recipient shuffle uses next draw:

```text
bound=2 -> 0
```

Order `[B,A]`.

Expected final assignment:

```text
P1 #1 -> B
```

### Expected projected levels

```text
A=1
B=2
```

This is valid because both seats completed level 0 before B received its level-1 assignment.

## 8. Vector V1-04 — Square count does not change seat weight

### Seats

```text
A: serviceLevel=0, Squares=[101]
B: serviceLevel=0, Squares=[201,202,203,204,205,206,207,208,209,210]
```

### Inventory

Two NFTs:

```text
P1 #1
P1 #2
```

No matter what valid fake random draws are used, required property is:

```text
A receives exactly 1 seat-level assignment
B receives exactly 1 seat-level assignment
```

B must **not** receive ten chances.

Square selection only chooses which one of B's ten Squares receives B's single assignment.

## 9. Vector V1-05 — least-served Square selection

### Seat

```text
A serviceLevel=7
Squares:
  101 deliveryCount=3
  102 deliveryCount=2
  103 deliveryCount=2
```

Only Squares 102 and 103 are eligible destinations.

Canonical minimum set:

```text
[102,103]
```

Fake Square tie-break:

```text
bound=2 -> 0
```

Fisher-Yates produces `[103,102]`.

Expected selected Square:

```text
103
```

Square 101 is forbidden despite being owned by A because its delivery count is higher.

## 10. Vector V1-06 — project diversity

### Seat history

A has previously received:

```text
P1
```

### Remaining shuffled inventory

```text
P1 #9
P2 #4
P1 #10
```

The diversity rule scans from the front and chooses the first collection not already in A's history.

Expected:

```text
P2 #4 -> A
```

Remaining inventory preserves relative order of unselected items:

```text
P1 #9
P1 #10
```

No price, rarity or token ID preference is involved.

## 11. Vector V1-07 — project diversity fallback

A has previously received P1.

Remaining inventory:

```text
P1 #9
P1 #10
```

No unseen collection exists.

Expected selection:

```text
P1 #9
```

The engine does not skip A or invent a new project requirement.

## 12. Vector V1-08 — new holder joins at community floor

Existing active state:

```text
A=5
B=5
C=6
```

Current floor:

```text
5
```

New owner D appears in the next admitted census.

Expected initialization:

```text
D=5
```

D is immediately eligible alongside A/B but does not enter at zero and demand five historical catch-up allocations.

## 13. Vector V1-09 — re-entry cannot create catch-up exploit

Historical state before exit:

```text
A=8
B=8
C=8
D=7
```

D exits community.

Later active community progresses to floor 10.

D re-enters.

Rule:

```text
newLevel = max(previousLevel, currentFloor)
         = max(7,10)
         = 10
```

Expected:

```text
D=10
```

D cannot leave and re-enter to regain lower-level priority.

## 14. Vector V1-10 — Square transfer changes destination set, not history

Before census N:

```text
A owns Squares [101,102]
B owns [201]
```

Square 102 deliveryCount is 4.

Before census N+1, A transfers Square 102 to B.

Census N+1:

```text
A Squares=[101]
B Squares=[102,201]
```

Expected:

- A's seat service history remains keyed to owner A;
- B's seat service history remains keyed to owner B;
- Square 102 retains `deliveryCount=4` as destination history;
- future selection for B compares Square 102's count against Square 201's count;
- the transfer does not create an extra seat for either owner.

## 15. Vector V1-11 — ETH contribution neutrality

Run the exact same census, fairness state, inventory, history and fake random stream twice.

Run X funding metadata:

```text
A contributed 0 ETH
B contributed 10 ETH
```

Run Y funding metadata:

```text
A contributed 100 ETH
B contributed 0 ETH
```

Expected:

```text
allocationResultHash(X) == allocationResultHash(Y)
```

The cleanest implementation is for contribution metadata to be absent from allocation input entirely. If the future runtime happens to carry both records in one process, allocation code must not accept/read the funding ledger.

## 16. Vector V1-12 — NFT value neutrality

Same allocation inputs are run twice.

Run X presentation metadata says:

```text
P1 floor = 0.01 ETH
P2 floor = 10 ETH
```

Run Y reverses those values.

Expected:

```text
allocationResultHash(X) == allocationResultHash(Y)
```

Preferred implementation: floor/rarity/value fields do not exist in `AllocationInventoryItemV1` at all.

## 17. Vector V1-13 — inventory commitment mutation

Committed inventory:

```text
P1 #1
P2 #1
```

After randomness is known, replace P2 #1 with P3 #1.

Expected:

```text
newInventoryHash != committedInventoryHash
```

and the prior randomness/allocation commitment is invalid. The system must not “repair” the batch by preserving the old result.

## 18. Vector V1-14 — census mutation after commitment

Committed census has owners A/B.

After randomness is known, operator changes B to C in a local file.

Expected:

```text
newCensusHash != committedCensusHash
```

Prior result cannot be used.

## 19. Vector V1-15 — randomness round mismatch

Batch commits to:

```text
source=drand-quicknet-v1
round=R
```

Response is a valid beacon for round `R+1`.

Expected:

```text
REJECT RANDOMNESS_ROUND_MISMATCH
```

Do not silently use the next valid round.

## 20. Vector V1-16 — invalid randomness signature

Round and bytes are syntactically valid but signature verification against the pinned drand chain/public key fails.

Expected:

```text
REJECT RANDOMNESS_SIGNATURE_INVALID
```

Allocation remains waiting/paused; no fallback to `Math.random` or block timestamp.

## 21. Vector V1-17 — duplicate inventory identity

Inventory contains the same `(collection, tokenId)` twice.

Expected:

```text
REJECT INVENTORY_DUPLICATE_ASSET
```

before randomness commitment.

## 22. Vector V1-18 — assignment uniqueness

For every result:

```text
unique(collection, tokenId) count in assignments
==
assignment count
```

No acquired NFT may appear in more than one assignment.

## 23. Vector V1-19 — partial delivery does not falsely advance others

Planned assignments:

```text
A level 4 -> assignment X
B level 4 -> assignment Y
```

X confirms; Y is uncertain.

Persistent fairness state after reconciliation:

```text
A=5
B=4 until Y is confirmed
```

The engine must not allocate a new level-5 NFT to A while B remains at 4 merely because the planning batch originally contained Y.

The pending Y assignment remains bound to B until it is confirmed, definitively failed/recovered under policy, or the batch is explicitly rebuilt through a reviewed recovery path.

## 24. Vector V1-20 — restart after confirmed transfer

Assignment X is broadcast and confirms onchain, but process crashes before fairness database update.

On restart:

- deterministic assignment ID X is loaded;
- onchain ownership/receipt proves delivery;
- engine marks X confirmed;
- A serviceLevel increments once;
- Square deliveryCount increments once;
- no second transfer is submitted.

Required property:

```text
reconcile(reconcile(state)) == reconcile(state)
```

Idempotent reconciliation.

## 25. Production randomness adapter contract

The first public candidate is a future precommitted drand Quicknet round, but implementation must keep an adapter interface.

A verified randomness record should bind at least:

```text
schemaVersion
sourceId
chainHash
round
randomness
signature
previousSignature|null
verified=true
verificationImplementationVersion
recordHash
```

The implementation must revalidate current drand chain parameters at admission time and pin them in tests/configuration. Provider URLs are not identity.

## 26. Seed/domain separation

After a randomness record is verified, derive a root seed using the batch commitment.

Conceptually:

```text
root = keccak256(
  DOMAIN_ROOT
  || chainId
  || censusHash
  || inventoryHash
  || fairnessStateHash
  || sourceId
  || chainHash
  || round
  || randomness
)
```

Then derive independent streams:

```text
recipientSeed = keccak256(DOMAIN_RECIPIENT || root)
inventorySeed = keccak256(DOMAIN_INVENTORY || root)
squareSeed    = keccak256(DOMAIN_SQUARE || root)
```

A draw counter is included in each expanded word.

Changing one domain string must change only the relevant stream, not silently reuse words between decisions.

## 27. Bounded draw reference

For bound `b > 0` using 256-bit word `w`, avoid modulo bias.

Reference rejection threshold:

```text
limit = floor(2^256 / b) * b
```

If:

```text
w >= limit
```

reject the word and expand the next one.

Otherwise:

```text
value = w mod b
```

Tests should include bounds that do not divide `2^256` and explicit words above/below the threshold.

## 28. Property test suite

Codex should supplement these examples with generated/property tests asserting at least:

```text
for every active seat:
  final serviceLevel ∈ {floor, floor+1}
```

for a single batch that does not contain enough inventory to complete more than one additional partial round after any full rounds. More generally, after arbitrary batch size:

```text
max(projectedLevel) - min(projectedLevel) <= 1
```

for all active seats after the entire planned inventory is assigned.

Also assert:

```text
all assigned NFTs unique
all selected Squares owned by selected seat in bound census
all selected Squares have minimum deliveryCount for that owner at selection time
funding metadata cannot alter result
value metadata cannot alter result
same inputs/randomness => same canonical result hash
```

Run thousands of generated cases with varying:

- seat counts;
- Square multiplicity;
- initial service levels satisfying reachable fairness states;
- delivery counts;
- collection histories;
- inventory sizes;
- duplicate-collection density;
- entry/exit/re-entry events.

## 29. Failure behavior

A vector/test failure must fail closed. Do not attempt to “make randomness fairer” by rerolling until outputs look balanced; fairness comes from the least-served algorithm, not from selecting aesthetically pleasing random outcomes.

The engine is allowed to produce financially unequal outcomes because NFT future value is unknown. It is not allowed to produce unequal service opportunity due to operator choice, contribution amount or Square count.
