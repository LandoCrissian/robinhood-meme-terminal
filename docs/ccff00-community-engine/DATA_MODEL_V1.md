# CCFF00 Community Engine data model V1

**Status:** PLANNING ONLY — FUTURE IMPLEMENTATION INPUT  
**Chain:** Robinhood Chain `4663`  
**Authority:** none until the Community Engine project is explicitly opened after the current terminal-completion lane.

This document makes the Community Engine state model explicit so future OpenAI Codex work does not have to invent identity, fairness, restart, ownership-drift or accounting semantics while implementing execution.

## 1. Design rules

1. Onchain evidence is authoritative for CCFF00 ownership, token-bound accounts, NFT ownership and confirmed transactions.
2. One current owner address holding at least one admitted public CCFF00 is one V1 community seat.
3. Original mint history is analytics only and never overrides current ownership.
4. ETH contribution data is never an allocation-weight input.
5. Fairness state changes only after confirmed NFT delivery.
6. Allocation inputs and outputs are canonicalized and hash-bound before distribution.
7. A missing/ambiguous transaction result is not a failed transaction; it is an unresolved transaction that blocks unsafe retry.
8. Database/storage technology is deliberately not selected here. Packages A–E should remain deterministic domain/artifact work. Durable runtime storage is selected only when Package H is authorized.

## 2. Canonical serialization

Reuse the repository's canonical JSON/hashing style from the VNext distribution domain rather than introducing a second serialization convention.

Rules:

- decimal integer strings for uint256-compatible values;
- checksummed EVM addresses in human-facing artifacts;
- lowercase addresses only when explicitly used as canonical sort/hash keys;
- lowercase nonzero bytes32 hashes;
- token IDs sorted numerically, never lexicographically;
- addresses sorted by lowercase 20-byte value;
- arrays are sorted by their schema-defined key before hashing unless ordering is itself meaningful and committed;
- no unknown fields in admitted schema versions;
- every schema has an explicit domain separator and version.

## 3. `Ccff00CommunityCensusV1`

Derived from the existing canonical `Ccff00PublicSnapshotV1` at one pinned block.

```text
schemaVersion: 1
chainId: 4663
snapshotBlock
snapshotBlockHash
collection
collectionRuntimeHash
registry
registryRuntimeHash
accountImplementation
accountImplementationRuntimeHash
erc6551Salt
publicStartTokenId
publicMinted
rows[]
ownerGroups[]
summary
censusHash
```

### `rows[]`

Exactly one row per currently public-minted admitted Square:

```text
tokenId
currentOwner
tokenBoundAccount
activated
accountRuntimeHash | null
```

Invariants:

- exactly `publicMinted` rows;
- token IDs cover the full admitted public range without gaps/duplicates;
- no reserve/founder/project token ID enters V1;
- every `currentOwner` is nonzero;
- every token-bound account equals the canonical CCFF00 resolver result at the same snapshot block;
- no duplicate canonical TBA;
- `activated == true` only when runtime code exists and matches the admitted account identity rules.

### `ownerGroups[]`

```text
owner
tokenIds[]
tokenBoundAccounts[]
```

The two arrays correspond by deterministic token-ID order.

Invariants:

- one group per unique current owner;
- every census row belongs to exactly one group;
- no group is empty;
- one group equals one community seat in V1 regardless of group size.

### `summary`

```text
uniqueCurrentOwners
ownersWithExactly1
ownersWithExactly2
ownersWithExactly3
ownersWithExactly4
ownersWith5Plus
maxSquaresPerOwner
activatedTbas
uniqueTbas
```

The bucket counts must sum to `uniqueCurrentOwners`.

## 4. `Ccff00MintProvenanceV1`

Bounded, read-only artifact derived from canonical ERC-721 mint transfers.

```text
schemaVersion: 1
chainId: 4663
collection
deploymentBoundaryBlock
deploymentBoundaryEvidenceHash
throughBlock
throughBlockHash
rows[]
summary
provenanceHash
```

Each row:

```text
tokenId
initialRecipient
transactionHash
blockNumber
blockHash
transactionIndex | null
logIndex
```

Admission event:

```text
Transfer(
  from = 0x0000000000000000000000000000000000000000,
  to = initialRecipient,
  tokenId
)
```

Rules:

- use `initialRecipient`, not blindly `transaction.from`;
- exactly one creation event per admitted public token ID;
- duplicate creation events fail closed;
- reserve IDs can be retained in a separate diagnostic section if useful but cannot enter public-seat analytics;
- collection deployment/start boundary must be independently proven, not guessed;
- once finalized, a prior provenance checkpoint may be incrementally extended and re-hashed.

Provenance does not alter current eligibility.

## 5. `CommunitySeatStateV1`

Persistent only after runtime authorization.

Key:

```text
owner address
```

State:

```text
owner
serviceLevel
firstSeenBlock
lastSeenBlock
active
lastConfirmedAssignmentId | null
```

Rules:

- `serviceLevel` is a nonnegative integer count of confirmed seat-level NFT service events;
- increment only after the NFT is proven at the final admitted CCFF00 destination;
- a failed/reverted/stale assignment does not increment it;
- first-time owner enters at the current community floor;
- returning owner enters at `max(previousServiceLevel, currentCommunityFloor)`;
- selling all admitted public Squares marks the seat inactive at the next admitted census rather than deleting history.

## 6. `SquareDeliveryStateV1`

Key:

```text
CCFF00 tokenId
```

State:

```text
tokenId
deliveryCount
lastConfirmedAssignmentId | null
lastDeliveredCollection | null
lastDeliveredTokenId | null
```

`deliveryCount` follows the Square as destination history. It does not create extra owner-level entitlement.

When a selected seat owns multiple Squares, only Squares with the minimum delivery count are eligible first; deterministic randomness breaks ties.

## 7. Ownership drift between allocation and delivery

This is a mandatory safety/fairness case.

An allocation batch is built from a pinned census, but a Square can transfer before delivery. The engine must never blindly send an assigned NFT to a TBA whose Square is no longer owned by the selected seat.

Before each distribution signature:

1. re-read `ownerOf(selectedSquare)` at a fresh confirmed/preflight block;
2. require it still equals the assigned seat owner;
3. require the selected TBA still resolves canonically;
4. require collector ownership of the assigned NFT still holds.

If the selected Square changed ownership:

- do not deliver to it;
- try the precommitted deterministic Square preference order for other Squares belonging to the same seat from the admitted census;
- verify each candidate is still owned by that seat immediately before use;
- if the seat no longer controls any admitted Square from that census, mark the assignment `STALE_SEAT_OWNERSHIP` and do not increment service level.

The NFT is then reassigned using the batch's precommitted recipient fallback order or, if the batch repair rules cannot preserve the fairness invariant, placed into a new repair batch using a fresh census and fresh future randomness commitment.

Newly acquired Squares after the batch snapshot are not introduced into that batch. They participate in the next admitted census.

## 8. `WatchProjectV1`

Operator input is observation metadata, not execution authorization.

```text
schemaVersion: 1
watchId
createdAt
sourceUrls[]
collection | null
mintTarget | null
expectedStart | null
expectedEnd | null
expectedZeroPrice | null
collectorAllowlistExpected | null
allowlistEvidence | null
notes | null
status
```

Allowed statuses:

```text
ACTIVE
PAUSED
EXPIRED
RESOLVED
```

`WATCH PROJECT` never changes the mint safety policy or adapter allowlist.

## 9. `MintCandidateV1`

Normalized discovery record independent of provider.

```text
schemaVersion: 1
candidateId
chainId
sourceKind
sourceId
collection
mintTarget
stageId
stageStart
stageEnd
providerMintPriceAtomic | null
providerMaxPerWallet | null
providerRemainingSupply | null
providerEvidenceHash
observedAt
adapterHint | null
status
reasonCodes[]
```

`candidateId` must be deterministic from normalized source/collection/target/stage identity and must not depend on observation timestamp.

Discovery statuses:

```text
OBSERVED
NEEDS_ENRICHMENT
UNKNOWN_ADAPTER
REJECTED
ELIGIBLE_FOR_PLAN
EXPIRED
```

## 10. `MintEvidenceV1`

The local evidence envelope that can graduate a candidate toward a transaction plan.

```text
candidateId
verifiedAtBlock
verifiedBlockHash
chainId
collection
collectionRuntimeHash
mintTarget
mintTargetRuntimeHash
proxyImplementation | null
proxyImplementationRuntimeHash | null
adapterId
adapterVersion
selector
quantity
recipientSemantics
nativeValueAtomic
stageEvidence
allowlistEvidence | null
creatorLimitEvidence | null
simulationEvidence
gasEvidence
postconditionPolicyHash
evidenceHash
```

Provider claims are never sufficient by themselves. Exact chain reads and local decoding/simulation must agree.

## 11. `MintPlanV1`

Unsigned and non-executable by itself.

```text
schemaVersion: 1
planId
candidateId
evidenceHash
collector
target
calldata
nativeValueAtomic
quantity
collection
expiresAtBlock | expiresAtTime
policyVersion
maxGasAtomic
planHash
```

Hard invariant:

```text
nativeValueAtomic == 0
```

Any material state change after plan construction requires re-verification and a new plan hash. A plan created while execution is STOPPED/disabled never grants later signing authority.

## 12. Transaction-attempt state

A blockchain submission must be modeled independently from business state.

```text
transactionAttemptId
operationKind
operationId
sender
nonce | null
planHash
submissionState
transactionHash | null
firstAttemptedAt
lastCheckedAt
confirmedBlock | null
confirmedBlockHash | null
receiptStatus | null
```

Submission states:

```text
PLANNED
SUBMISSION_STARTED
HASH_KNOWN
SUBMISSION_AMBIGUOUS
CONFIRMED_SUCCESS
CONFIRMED_REVERT
DROPPED_PROVEN
```

Rules:

- timeout/network error after sending is `SUBMISSION_AMBIGUOUS`, not automatically safe to retry;
- do not issue a new independent transaction until sender nonce/known hash state is reconciled;
- if a replacement strategy is ever added, it must be an explicit versioned policy and preserve the intended target/calldata/value semantics;
- business state advances only from confirmed receipts/postconditions.

## 13. `AcquisitionInventoryV1`

After a successful mint run, parse actual receipt events and independently verify ownership.

```text
schemaVersion: 1
mintRunId
collection
collector
acquiredAtBlock
items[]
inventoryHash
```

Each item:

```text
collection
tokenId
acquisitionTransactionHash
acquisitionLogIndex
ownerVerified
```

Rules:

- never infer token IDs from sequential assumptions;
- every admitted item must be owned by the collector at inventory reconciliation;
- no duplicate `(collection, tokenId)`;
- inventory becomes immutable for allocation once committed;
- an unexpected inventory delta after commitment is a fatal execution halt until reconciled.

## 14. `RandomnessCommitmentV1`

```text
schemaVersion: 1
sourceId
sourceVersion
chain/network identity
censusHash
inventoryHash
fairnessVersion
futureRound
commitmentCreatedAt
commitmentHash
```

For the first drand candidate, pin at least:

```text
network = quicknet
chainHash = 52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971
round = predetermined future round
```

The round must be selected before its beacon exists.

## 15. `RandomnessRecordV1`

```text
commitmentHash
sourceId
round
signature
randomness
verificationStatus
verifiedChainHash
randomnessRecordHash
```

The engine must verify the beacon cryptographically using pinned network information/client logic rather than trusting a JSON response from one relay.

Multiple relays may be raced for availability, but identical verified round output is required.

## 16. `AllocationBatchV1`

```text
schemaVersion: 1
batchId
censusHash
inventoryHash
fairnessVersion
randomnessCommitmentHash
randomnessRecordHash
communityFloorBefore
recipientPreferenceOrder[]
inventoryPreferenceOrder[]
assignments[]
allocationResultHash
status
```

Statuses:

```text
COMMITTED
RANDOMNESS_VERIFIED
ALLOCATED
DISTRIBUTING
PARTIALLY_CONFIRMED
CONFIRMED
REPAIR_REQUIRED
HALTED
```

The recipient preference order must include deterministic fallback order so ownership drift can be handled without operator choice.

## 17. `AssignmentV1`

```text
assignmentId
batchId
seatOwner
seatServiceLevelBefore
squarePreferenceOrder[]
selectedSquare
selectedTba
collection
tokenId
status
reasonCode | null
distributionTransactionHash | null
confirmedBlock | null
```

Statuses:

```text
PLANNED
PRECHECKED
SUBMITTED
CONFIRMED
STALE_SQUARE_OWNERSHIP
STALE_SEAT_OWNERSHIP
REVERTED
REPAIR_REQUIRED
```

Only `CONFIRMED` increments both seat and Square counters.

## 18. Collection receipt history

For diversity only, maintain:

```text
seatOwner
collection
confirmedReceiptCount
```

This is not financial scoring. It exists only so a seat can preferentially receive a collection it has not already been served when possible.

Never store or use floor price, rarity rank, bids, PnL or token momentum as allocation inputs.

## 19. Funding ledger separation

Future gas-funding records:

```text
transactionHash
sender
amountWei
blockNumber
blockHash
sourceCategory
```

Source category may be:

```text
COMMUNITY_VOLUNTARY
RMT_OPERATIONS_VOLUNTARY
VERSIONED_REVENUE_POLICY
OTHER_ADMITTED
```

There is intentionally no foreign key or field from funding contribution into `CommunitySeatStateV1`, `AllocationBatchV1` or `AssignmentV1` that can increase odds/priority.

## 20. RMT Pay burn receipt

Future RMT Pay accounting is separate from Community Engine allocation.

```text
schemaVersion: 1
paymentId
utilityId
payerOwner
rmtSourceAccount
rmtAmountAtomic
burnAddress
burnTransactionHash
burnTransferLogIndex
utilityTransactionHash
atomicOperationId
gasSponsorKind
gasCostWei | null
confirmedBlock
paymentPolicyHash
receiptHash
```

For V1 protocol utility:

```text
burnAddress = 0x000000000000000000000000000000000000dEaD
```

A burn receipt is valid only when exact RMT source/dead-address deltas and the admitted utility success postcondition are proven. Do not record a successful paid utility from a burn-only transaction if the utility failed.

## 21. Privacy boundary

The engine needs public addresses and onchain ownership only.

Do not collect or use IP/device/browser fingerprinting to merge seats. Optional future wallet linking must be explicit cryptographic consent from every linked address and must be a separately versioned identity layer.

## 22. Storage migration principle

When Package H is eventually authorized, choose the smallest durable store that can provide:

- unique constraints for deterministic IDs;
- atomic state transitions/counter updates;
- append-only transaction evidence;
- restart-safe reconciliation;
- one-writer or explicit leader semantics;
- exportable canonical artifacts.

Do not pick a database now merely because one already exists elsewhere in the repository. Service/domain ownership comes first.
