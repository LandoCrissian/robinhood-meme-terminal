# CCFF00 Community Engine fairness and randomness V1

**Status:** PLANNING ONLY — FUTURE IMPLEMENTATION INPUT

This document pins the V1 fairness algorithm tightly enough that allocation can be independently reproduced and the operator cannot choose winners, reroll randomness or decide which project goes to which holder.

## 1. Core fairness unit

```text
one current owner address holding >= 1 admitted public CCFF00
=
one community seat
```

Square count is not seat weight.

ETH contribution, RMT balance, wallet value, social activity and original mint quantity are not seat weight.

## 2. Service-level invariant

Every active seat has:

```text
serviceLevel = number of confirmed Community Engine NFT allocations
```

At the start of a new allocation batch:

```text
communityFloor = min(serviceLevel of active seats)
```

Only seats at `communityFloor` can receive the next NFT batch.

V1 invariant:

> No active seat receives service level `N+1` while another active seat remains at `N`.

A service level changes only after confirmed NFT delivery to an admitted CCFF00 TBA.

## 3. One mint run = one allocation batch

V1 should not combine unrelated projects into one artificial inventory pool.

Example:

```text
183 active seats at level 0

Project A acquired: 20 NFTs
→ randomly select 20 of the 183 floor seats
→ after confirmed delivery those 20 become level 1

Project B acquired later: 30 NFTs
→ current floor is still 0
→ randomly select 30 from the remaining 163 level-0 seats

Project C acquired later: 5 NFTs
→ select 5 from the remaining level-0 seats
```

This naturally produces the desired community behavior: different holders receive different projects, but nobody gets a second Community Engine allocation while other active holders are still waiting for their first.

## 4. Acquisition quantity should respect fairness

Before a mint is signed, the engine already knows the approximate current floor cohort from a fresh preflight census.

Preferred V1 quantity:

```text
quantity = min(
  creator/project wallet allowance,
  remaining mint supply when authoritative,
  local max quantity policy,
  eligible floor seats that do not already have this collection
)
```

This avoids acquiring more same-project inventory than can be fairly/usefully distributed in the current floor cohort.

If exact project mint semantics force an unwanted quantity larger than the eligible cohort, V1 should reject/observe rather than intentionally create duplicate same-project gifts.

A later policy may allow second copies after all active seats have first-project coverage, but that is not implicit V1 behavior.

## 5. Final allocation census is deterministic from acquisition

To remove operator choice from the census snapshot, bind the allocation census to the acquisition transaction.

Recommended V1 rule:

```text
allocationAnchorBlock = confirmed acquisition transaction block
allocationCensusBlock = allocationAnchorBlock
```

After the mint has reached the required confirmation/finality policy, use archive-capable RPC reads to reconstruct the exact CCFF00 ownership/TBA census at that historical block.

Consequences:

- operator cannot wait for a preferred later holder snapshot;
- inventory and census share an immutable onchain anchor;
- holders who buy after the acquisition block join future batches;
- ownership drift before distribution is handled by the separate pre-distribution ownership checks/repair rules.

If future infrastructure cannot reliably serve historical state at the acquisition block, a new census-anchor policy requires explicit review; do not silently fall back to "latest".

## 6. Inventory is deterministic from acquisition receipt

For the mint run:

1. parse exact admitted collection mint events from the confirmed receipt;
2. verify each token's collector ownership;
3. sort by `(collection address bytes, numeric tokenId)`;
4. hash the complete inventory.

No operator can remove a token because it looks rare/valuable or add another token from outside that mint run.

```text
inventoryHash = hash(canonical complete acquired inventory)
```

## 7. Eliminate discretionary randomness-round selection

Do not let an operator choose a drand round after seeing inventory.

Derive the future round from immutable acquisition-block data and a versioned fixed lead-time policy.

Inputs:

```text
allocationAnchorBlock
allocationAnchorBlockHash
allocationAnchorBlockTimestamp
randomnessPolicyVersion
randomnessLeadSeconds
```

`randomnessLeadSeconds` must be an explicit positive policy constant fixed before the mint run; there is no permissive runtime default.

Target beacon time:

```text
targetTime = allocationAnchorBlockTimestamp + randomnessLeadSeconds
```

Then derive the first admitted drand round scheduled at or after `targetTime`.

Because the acquisition block/timestamp and policy are immutable/public, anyone can compute the same future round. No separate operator-selected commitment timestamp is necessary for this V1 model.

## 8. First randomness adapter candidate: drand Quicknet

Planning values verified from drand's public chain information on 2026-08-21:

```text
beaconId: quicknet
chainHash: 52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971
publicKey: 83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a
periodSeconds: 3
genesisTime: 1692803367
groupHash: f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e
schemeId: bls-unchained-g1-rfc9380
```

These are implementation-time inputs, not eternal truth. Package E must revalidate and then pin the admitted values/version in code/test fixtures.

Do not use the deprecated drand `fastnet` network.

## 9. Future-round calculation

For Quicknet round 1 beginning at `genesisTime`, the round start time is:

```text
roundStart(r) = genesisTime + (r - 1) * periodSeconds
```

For a target Unix time `T >= genesisTime`, select:

```text
futureRound = ceil((T - genesisTime) / periodSeconds) + 1
```

This is the first round whose scheduled start is at or after `T`.

Implementation must use integer arithmetic; no floating-point timestamps.

## 10. Beacon verification

Never trust `randomness` returned by one HTTP relay without signature verification.

Preferred JavaScript implementation uses the maintained drand client with verification enabled and pinned chain verification parameters.

At minimum verify:

```text
chain hash
public key
scheme
requested round
beacon signature
```

For drand, public randomness is derived from the verified threshold BLS signature. The implementation may use the verified client result or derive the documented randomness hash from the verified signature; it must not accept an unverified JSON value.

Multiple relays may be raced for availability. They must converge on the same valid round result.

## 11. Randomness outage semantics

If the exact derived future round cannot be retrieved/verified:

```text
WAIT
```

Do not:

- choose a different round;
- use a Robinhood block hash;
- use `Math.random()`;
- use current timestamp;
- use an operator seed;
- use a provider's random ordering.

A later deterministic emergency rule can be versioned if truly necessary, but V1's safe failure is to keep inventory committed and wait.

## 12. Allocation seed

Recommended domain-separated seed:

```text
seed = keccak256(
  "RMT_CCFF00_FAIR_ALLOCATION_V1" ||
  uint256(4663) ||
  allocationAnchorBlockHash ||
  censusHash ||
  inventoryHash ||
  randomnessPolicyHash ||
  uint256(drandRound) ||
  drandRandomness
)
```

Use an exact ABI/canonical-byte encoding specified by Package E; do not rely on ambiguous string concatenation in production.

## 13. Deterministic random word stream

Generate words by domain and counter:

```text
word(domain, counter) = keccak256(
  encode(seed, domain, counter)
)
```

Separate domains for:

```text
SEAT_SHUFFLE
INVENTORY_SHUFFLE
SQUARE_TIE_BREAK
REPAIR_ORDER
```

The same seed must not reuse an undifferentiated word stream for logically separate choices.

## 14. Unbiased Fisher-Yates

For a list length `n`, shuffle from `i = n - 1` down to `1`.

For bound `b = i + 1`, draw a 256-bit word `w` with rejection sampling:

```text
M = 2^256
limit = floor(M / b) * b

if w >= limit:
  reject word and draw next counter
else:
  j = w mod b
```

Swap elements `i` and `j`.

Do not use bare `keccakWord % b` without rejection handling.

Publish fixed reproducibility vectors in tests.

## 15. Seat selection

For a mint-run inventory size `q`:

1. load active seats from the acquisition-block census;
2. reconcile persistent service levels;
3. compute `communityFloor`;
4. build cohort `serviceLevel == communityFloor`;
5. remove seats already confirmed to have this collection when collection-diversity policy applies;
6. canonical-sort remaining seat addresses;
7. deterministic shuffle using `SEAT_SHUFFLE`;
8. select first `q` seats.

V1 acquisition planning should keep `q <= cohort size`, so one mint run does not cross a service-level boundary.

This restriction substantially simplifies fairness and failure recovery.

## 16. NFT-to-seat pairing

Within the mint run:

1. canonical-sort inventory;
2. independently shuffle inventory using `INVENTORY_SHUFFLE`;
3. pair shuffled item index `k` to shuffled selected seat index `k`.

The operator never sees a stage where they can pick a favorable NFT for a particular address.

If all NFTs in the run are the same collection, this still randomizes token IDs/traits across selected seats.

## 17. Selecting a Square for the selected seat

For each selected seat:

1. take the Squares owned by that seat in the acquisition-block census;
2. find minimum persistent `deliveryCount`;
3. keep only Squares at that minimum;
4. canonical-sort token IDs;
5. use a deterministic `SQUARE_TIE_BREAK` permutation;
6. store the entire resulting preference order, not only the first choice.

The full preference order supports deterministic ownership-drift fallback before delivery.

## 18. Distribution-time ownership drift

Immediately before signing a transfer, verify the selected seat still owns the selected Square.

If not, walk that seat's precommitted Square preference order and choose the first Square still owned by the seat.

If none remain:

```text
STALE_SEAT_OWNERSHIP
```

Do not send the NFT to the sold Square/TBA.

Use the precommitted seat fallback order only if doing so preserves the current service-level invariant. Otherwise defer the item to a repair batch derived from a fresh census and a new deterministic future round.

No operator substitute selection.

## 19. Distribution failure and service levels

Assignments are planned from one fairness snapshot, but service-level counters increment only on confirmed delivery.

If one transfer fails while others succeed:

- successful seats increment;
- failed seat does not increment;
- item remains controlled inventory;
- create deterministic repair state;
- do not plan a second-level allocation that could move a successful seat another level ahead while the failed seat/other floor seats remain behind.

This is another reason V1 should keep each mint run within one floor cohort.

## 20. New owner behavior

A new current owner appearing after the acquisition-block census does not enter that batch.

At the next batch:

```text
first-time serviceLevel = current active community floor
```

A returning address uses:

```text
max(previousServiceLevel, current active community floor)
```

No historical catch-up windfall.

## 21. Project coverage behavior

Track confirmed collection receipts by seat.

For a new mint of collection `C`, prefer/limit acquisition to seats at the current fairness floor with no prior confirmed `C` receipt.

This creates project diversity without assigning financial value.

Do not use:

- floor price;
- rarity;
- bids;
- social momentum;
- PnL;
- token price;
- operator preference.

If every active seat already has collection `C`, automatic duplicate acquisition is disabled by default in V1 unless a new policy explicitly opens a second collection-coverage round.

## 22. Fairness simulation requirements

Package E should mechanically prove at least:

- 1-Square holder and 10-Square holder have identical seat-level opportunity;
- ETH contributors and noncontributors have identical seat-level opportunity;
- partial project runs fill the lowest service cohort only;
- sequential different projects naturally spread across still-unserved seats;
- token IDs from the same collection are randomly paired;
- no owner can receive service `N+1` while an active owner remains at `N`;
- new owners enter at floor;
- re-entry cannot reset history;
- sold Square cannot receive stale seat's gift;
- changed inventory/census/block hash/randomness changes the allocation hash;
- same inputs always reproduce exactly;
- modulo-bias rejection vectors are deterministic;
- provider/relay ordering cannot affect verified output.

## 23. Public proof packet

A future allocation dashboard can expose one proof packet per mint run:

```text
mintRunId
acquisitionTxHash
allocationAnchorBlock
allocationAnchorBlockHash
censusHash
inventoryHash
fairnessPolicyHash
randomnessPolicyHash
drand chain hash
drand round
drand verified randomness
allocationResultHash
assignment summary
```

Anyone can use the open algorithm/test vectors to reproduce the result.

## 24. Why this is preferable to an operator lottery

The operator controls whether the engine is running and which projects receive priority observation. Once an admitted zero-price mint is acquired, the allocation outcome is mechanically determined from:

```text
onchain acquisition
onchain CCFF00 ownership
persistent confirmed fairness state
fixed policy
future externally verified randomness
```

There is no legitimate operator input for the winner list.
