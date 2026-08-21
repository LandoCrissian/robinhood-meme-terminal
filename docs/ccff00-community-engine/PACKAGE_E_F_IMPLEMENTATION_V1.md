# CCFF00 Community Engine Packages E/F implementation packet V1

**Status:** PLANNING ONLY — FUTURE OPENAI CODEX IMPLEMENTATION PACKET  
**Packages:** E = Fair Allocation/randomness; F = CCFF00 external ERC-721 custody canary harness  
**Live signing:** absent by default; any live F canary requires separate explicit authorization after harness/fork proof.

# Package E — deterministic Fair Allocation V1

## 1. Objective

Prove mechanically that Community Engine NFT assignments are:

- least-served-first;
- one current owner address = one seat;
- independent of Square count;
- independent of ETH contributions;
- independent of NFT price/rarity/hype;
- deterministic/reproducible from committed inputs and verified randomness;
- bounded to one fairness-floor cohort per mint run.

Package E is pure logic + randomness verification. It moves no NFT.

## 2. Preconditions

- Packages A–D accepted;
- current census artifact format stable;
- mint plan includes fairness quantity preflight;
- fresh implementation branch from latest `main`;
- read:

```text
DECISION_REGISTER_V1.md
SPEC_CONSISTENCY_V1.md
FAIRNESS_RANDOMNESS_V1.md
FAIRNESS_VECTORS_V1.md
DATA_MODEL_V1.md
REFERENCE_INTERFACES_V1.md
THREAT_MODEL_V1.md
ERROR_CODES_V1.md
ACCEPTANCE_MATRIX_V1.md
this packet
```

## 3. Preferred files

Pure domain:

```text
apps/web/lib/vnext/community-engine-fairness.ts
apps/web/lib/vnext/community-engine-randomness.ts
apps/web/lib/vnext/community-engine-fairness-smoke.ts
```

Server randomness adapter only:

```text
apps/web/lib/server/vnext-community-engine-drand.ts
```

Fixtures/vectors as appropriate:

```text
apps/web/lib/vnext/fixtures/community-engine-fairness-v1/
```

No database/worker/signer/UI in Package E.

## 4. Pure allocator boundary

Allocator should accept already validated values, conceptually:

```ts
buildCommunityAllocationV1({
  census,
  seatStates,
  squareStates,
  collectionReceiptHistory,
  inventoryManifest,
  acquisitionEvidence,
  fairnessPolicy,
  randomnessPolicy,
  verifiedRandomness
})
```

It must **not** accept:

```text
ETH contributions
wallet net worth
RMT balance
NFT floor
rarity
bid
social score
operator preferred owners
operator seed
```

Dependency review/test should make those omissions intentional.

## 5. Fairness state normalization

At allocation anchor census:

For every current owner seat:

### Existing active address

Load persistent prior service level.

### First-seen address

Initialize:

```text
currentCommunityFloor
```

computed among surviving known active seats under policy.

### Returning address

Initialize:

```text
max(previousServiceLevel, currentCommunityFloor)
```

### Address no longer in census

Mark inactive for this allocation; history remains stored but it is not a candidate.

Do not mutate persistent state inside pure allocation planning; produce projections/result only.

## 6. Current collection coverage

For mint-run collection `C`, eligible seats are:

```text
active
AND serviceLevel == communityFloor
AND no prior confirmed Community Engine receipt from C
```

If policy later changes to allow duplicate collection rounds, that requires a new explicit policy/version; V1 does not silently cycle coverage.

## 7. Quantity invariant

Before allocation:

```text
inventory.items.length <= eligibleFloorSeats.length
```

Else hard reject:

```text
COMMUNITY_ALLOCATION_INVENTORY_EXCEEDS_FLOOR_COHORT
```

This is a defense-in-depth assertion even though Package D should have capped acquisition quantity before mint.

## 8. Acquisition-block census anchor

Allocation input must prove:

```text
census.snapshotBlock == acquisition.confirmedBlockNumber
census.snapshotBlockHash == acquisition.confirmedBlockHash
```

If not:

```text
COMMUNITY_ALLOCATION_CENSUS_ANCHOR_MISMATCH
```

Do not fetch “latest” inside allocator.

Historical census retrieval belongs in server/CLI pre-allocation code and must use archive-capable chain reads.

## 9. Randomness policy type

Versioned policy concept:

```ts
type CommunityRandomnessPolicyV1 = {
  version: 1;
  sourceId: "drand-quicknet";
  chainHash: Hex;
  genesisTime: UintString;
  periodSeconds: UintString;
  randomnessLeadSeconds: UintString; // no implicit default
  policyHash: Hex;
};
```

`randomnessLeadSeconds` is CE-D06, resolved during Package E with an explicit reviewed fixed value before production use. Tests can use fixture values before the production value is approved.

## 10. Round derivation

Given anchor Unix timestamp `T_anchor`:

```text
target = T_anchor + randomnessLeadSeconds
```

For a beacon with `genesisTime` and `periodSeconds`:

```text
round = ceil((target - genesisTime) / periodSeconds) + 1
```

Use integer arithmetic.

Test exact boundary cases:

- target exactly on a round start;
- target one second after round start;
- target before genesis => reject;
- huge uint timestamps within safe bigint bounds.

The derived round is part of commitment. There is no operator round input.

## 11. drand adapter separation

Server adapter:

```text
fetch exact derived round
→ verify chain/network identity
→ cryptographically verify threshold signature
→ normalize VerifiedRandomnessRecordV1
```

Allocator sees only the verified record.

### Multi-relay behavior

May query multiple official/compatible relays for availability.

Accept only responses that cryptographically verify and agree for exact chain/round.

Relay ordering/latency cannot affect output.

### Outage behavior

If exact round not available/verified:

```text
WAIT
```

No fallback round or blockhash.

## 12. Root commitment/seed

Define exact ABI/canonical-byte encoding during implementation and freeze with vectors.

Logical inputs:

```text
chainId 4663
allocation anchor block hash
census hash
inventory hash
fairness-state checkpoint hash
fairness policy hash
randomness policy hash
drand chain hash
drand round
verified randomness bytes
```

Do not use ambiguous delimiter-free UTF-8 concatenation.

## 13. Domain-separated random streams

At minimum:

```text
SEAT_SHUFFLE
INVENTORY_SHUFFLE
SQUARE_TIE_BREAK
REPAIR_ORDER
```

Word derivation includes domain + counter + root seed.

Using one domain's word/counter in another domain is a test failure.

## 14. Unbiased bounded draws

Use rejection sampling exactly as fairness spec/vectors define.

Implementation should expose a pure helper with direct edge-vector coverage.

Test bounds:

```text
1
2
3
5
10
17
large cohort values
```

For bound 1 return 0 without unnecessary/random failure.

## 15. Seat shuffle/select

Procedure:

1. canonical-sort eligible owner addresses by lowercase bytes;
2. Fisher-Yates with `SEAT_SHUFFLE`;
3. select first `inventoryCount`;
4. selected owners unique.

No weighted sampling.

## 16. Inventory shuffle

Procedure:

1. canonical-sort by collection bytes then numeric token ID;
2. Fisher-Yates with independent `INVENTORY_SHUFFLE`;
3. pair index-for-index with selected seats.

Inventory schema intentionally lacks market value/rarity.

## 17. Square preference order

For each selected owner:

1. take Squares owned in acquisition-block census;
2. lookup persistent Square delivery count;
3. identify minimum count;
4. select only Squares at minimum for first preference tier;
5. canonical-sort and shuffle tier with deterministic `SQUARE_TIE_BREAK` domain scoped to owner/assignment;
6. optionally append higher-count tiers only for explicit deterministic repair/fallback policy if specialized fairness spec allows it; default primary selection remains minimum count;
7. store preference order in assignment.

Because the selected seat may transfer a Square before delivery, the committed preference order is required for later ownership refresh.

## 18. Assignment/result hash

Every assignment binds:

```text
mintRun
owner seat
source serviceLevel
collection/tokenId
Square preference order
initial selected Square/TBA
```

Result binds complete ordered assignment set + commitment/randomness record.

Parser/replayer must recompute hashes.

## 19. Package E vector suite

Implement all normative `FAIRNESS_VECTORS_V1.md` cases.

Additional property tests:

- random seat count 1–1000;
- each owner 1–20 Squares;
- arbitrary reachable service floor states;
- inventory 0–eligible cohort size;
- arbitrary Square delivery counts;
- arbitrary prior collection histories;
- repeated runs over sequential projects;
- random insertion/removal/re-entry before next batch;
- same inputs repeatedly yield exact same bytes/hash;
- permuting input arrays before canonicalization yields same result;
- contribution/value side datasets have no path into result.

## 20. Package E public verifier prototype

Optional within E if bounded and useful: a read-only function/CLI that takes fixture proof packet and recomputes result.

No web UI required.

The ability to reproduce is more important than a visualization.

## 21. Package E completion report

```text
fairness policy version
randomness policy fixture/version
production leadSeconds decision: approved/deferred
current drand network identity revalidated yes/no
vector count passed
property cases passed
exact commitment/encoding definitions
sample result hash
known limitations
```

Then STOP.

---

# Package F — CCFF00 external ERC-721 custody proof

## 22. Objective

Prove the exact canonical CCFF00 TBA implementation can:

```text
receive a third-party transferable ERC-721
hold it
be controlled by the current Square owner
transfer the NFT back out
```

without unexpected CCFF00/RMT balance changes.

This proof is required before mass delivery.

## 23. Preferred files

Conceptually:

```text
apps/web/lib/vnext/ccff00-nft-custody-proof.ts
apps/web/lib/vnext/ccff00-nft-custody-proof-smoke.ts
apps/web/scripts/vnext-ccff00-nft-custody-canary.ts
```

Potential Foundry harness/fixture if needed:

```text
packages/contracts/test/... test-only ERC721 fixture
```

Do not deploy a new production TBA.

## 24. Reuse existing proof structures

Reuse where appropriate:

- CCFF00 collection/registry/implementation/salt constants;
- snapshot evidence;
- `Ccff00ProofTransactionV1`/receipt-log styles;
- runtime hash expectations;
- owner-control verification approach.

Do not duplicate owner/TBA derivation.

## 25. External ERC-721 test fixture

For local/fork tests, use a minimal standard transferable ERC-721 fixture with:

- deterministic mint to collector/test sender;
- standard `transferFrom`;
- standard `safeTransferFrom`;
- no royalty/custom transfer hooks necessary.

Purpose is to test TBA receiver/control semantics, not NFT-project quirks.

## 26. Determine safe receiver capability empirically

Before selecting production delivery method:

### Test A — `safeTransferFrom`

Simulate/execute in local/fork harness to canonical TBA implementation.

If it succeeds and `ownerOf` becomes TBA, record receiver compatibility.

### Test B — if safe transfer fails because receiver hook absent

Evaluate standard `transferFrom` with exact destination/postcondition.

Do not treat any other revert as proof ordinary transfer is safe.

Production method decision CE-D08 is resolved only from exact evidence.

## 27. Canary token IDs

Current RMT canary set:

```text
470
471
472
```

Before using them in a future live canary:

- verify they remain appropriate public minted Squares;
- verify exact current owners/TBAs;
- obtain explicit live-canary authorization from those owner/control conditions as applicable;
- do not assume planning-time owner/control remains unchanged.

A local/fork harness can impersonate/fixture owner logic without a live holder transaction.

## 28. Proof artifact

Reference `Ccff00NftCustodyProofV1` should bind:

```text
schemaVersion
chainId
CCFF00 tokenId
current owner
canonical TBA
snapshot block/hash/census evidence
collection/registry/implementation/salt/runtime evidence
external NFT collection/runtime
test NFT tokenId
receipt method safeTransferFrom|transferFrom
receipt tx/receipt evidence
owner-control withdrawal tx/receipt evidence
NFT owner before/after each stage
CCFF00 balance before/after
RMT balance before/after
proofHash
```

For local/fork-only proof, transaction identity can be explicitly marked simulation/fork evidence rather than pretending it is mainnet.

## 29. Receipt postconditions

After inbound transfer:

```text
externalNft.ownerOf(tokenId) == canonicalTBA
```

and:

```text
CCFF00 token/RMT balances unchanged except explicitly expected none
```

No proof merely from Transfer event if `ownerOf` disagrees.

## 30. Withdrawal postconditions

Current Square owner invokes canonical TBA execution to call NFT transfer back to an approved test recipient.

After:

```text
externalNft.ownerOf(tokenId) == approvedRecipient
```

and TBA no longer owns NFT.

Verify caller is current owner under exact TBA authorization semantics.

## 31. Negative F tests

- wrong token ID/TBA pair;
- duplicate/noncanonical TBA;
- wrong owner caller;
- stale owner snapshot;
- wrong account implementation/runtime;
- wrong NFT collection/runtime;
- NFT not owned by inbound sender;
- safe transfer callback failure;
- post-transfer ownerOf mismatch;
- malicious/nonstandard NFT that does not move ownership normally;
- unexpected CCFF00 balance delta;
- unexpected RMT balance delta;
- replay/duplicate proof identity;
- withdrawal target not approved by test fixture/proof.

## 32. Live Package F boundary

Default Package F ends with test/fork harness.

A live mainnet canary is a **separate owner-authorized action** even if harness is green.

If authorized later:

- use a deliberately low/no-value transferable test NFT or explicitly accepted existing NFT;
- exact gas budget;
- no mass distribution;
- one canary at a time;
- reconcile before next;
- do not involve RMT treasury/admin assets.

## 33. Package F completion report

Codex reports:

```text
exact CCFF00 implementation/runtime tested
safeTransferFrom supported yes/no
ordinary transferFrom fallback needed yes/no
TBA receipt proof status
owner withdrawal proof status
balance invariants
all negative fixtures
whether a live canary remains necessary/authorized
```

Then STOP before collector signer Package G.

## 34. E/F combined gate

After E/F, but before any live collector, RMT should know two independent facts:

```text
WHO should receive an acquired NFT
→ proven by deterministic Fair Allocation V1

CAN a selected CCFF00 wallet safely hold/release it
→ proven by exact TBA custody canary
```

Neither proof requires trusting an autonomous production signer.
