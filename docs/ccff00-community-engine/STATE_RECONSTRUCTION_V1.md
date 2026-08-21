# CCFF00 Community Engine state reconstruction and versioning V1

**Status:** PLANNING ONLY — FUTURE RUNTIME RECOVERY/MIGRATION AUTHORITY  
**Package relevance:** primarily H, with read-only implications for A–F and future K.

The Community Engine must not depend on one mutable database row being permanently correct. Durable storage is an operational cache/index over evidence; critical fairness/inventory/payment state should be independently reconstructable from canonical artifacts and confirmed chain receipts.

## 1. Source-of-truth hierarchy

### Level 1 — onchain canonical facts

Authoritative for:

```text
CCFF00 ownerOf(tokenId)
canonical TBA configuration/runtime at a block
NFT ownerOf / ERC1155 balances
collector balances
transaction receipt/status/block
RMT balances/allowances
RMT dead-address balance
contract/runtime identities
```

### Level 2 — immutable/hash-bound Community Engine evidence

Authoritative for decisions not natively represented as chain state:

```text
mint plan
inventory manifest
fairness checkpoint
allocation commitment
verified randomness record
allocation result
assignment
repair assignment
RMT Pay policy
public proof packet
```

### Level 3 — derived durable runtime tables

Operational accelerators:

```text
current seat serviceLevel
Square deliveryCount
collection receipt history
candidate current state
watch priority
pending work queues
current gas budget counters
current operator mode
```

Critical Level-3 fairness/history state must be rebuildable from Level-1/2 evidence.

## 2. Append-only event journal

Package H should strongly consider one append-oriented internal journal/table for state-changing Community Engine facts.

Conceptual event envelope:

```ts
type CommunityJournalEventV1 = {
  eventId: Hex;
  schemaVersion: 1;
  eventType: string;
  occurredAt: string;
  chainId: 4663 | null;
  blockNumber: UintString | null;
  blockHash: Hex | null;
  transactionHash: Hex | null;
  subjectId: Hex | string;
  evidenceHash: Hex;
  payloadHash: Hex;
};
```

The journal does not store secrets/private keys.

## 3. Suggested state-changing journal events

At minimum:

```text
ENGINE_MODE_REQUESTED
WATCH_CREATED
WATCH_DISABLED
CANDIDATE_OBSERVED
MINT_PLAN_ADMITTED
MINT_SUBMISSION_STARTED
MINT_TX_HASH_KNOWN
MINT_TX_UNCERTAIN
MINT_CONFIRMED
MINT_FAILED
INVENTORY_COMMITTED
ALLOCATION_COMMITTED
RANDOMNESS_VERIFIED
ALLOCATION_RESULT_COMMITTED
DELIVERY_SUBMISSION_STARTED
DELIVERY_TX_HASH_KNOWN
DELIVERY_TX_UNCERTAIN
DELIVERY_CONFIRMED
DELIVERY_FAILED
REPAIR_REQUIRED
REPAIR_ASSIGNMENT_COMMITTED
REPAIR_CONFIRMED
COLLECTOR_GAS_FUNDED
AUTOPAUSE_TRIGGERED
RMT_PAY_POLICY_ADMITTED
RMT_PAY_SUBMISSION_STARTED
RMT_PAY_CONFIRMED
RMT_PAY_FAILED
```

Not every read/provider observation needs permanent journal storage; retain enough to audit state transitions and decisions.

## 4. Fairness state reconstruction

The current `CommunitySeatStateV1.serviceLevel` should be derivable from confirmed Community Engine final deliveries.

Conceptually:

```text
serviceLevel(owner)
=
count of confirmed final seat-level Community Engine deliveries credited to owner
adjusted only by explicitly versioned migration/entry semantics
```

However, new-owner floor initialization means simply counting deliveries is not sufficient to reconstruct the *numeric* service level for addresses that joined late.

Therefore journal/evidence must preserve a deterministic **seat admission checkpoint**:

```ts
type CommunitySeatAdmissionV1 = {
  owner: Address;
  firstAdmittedCensusHash: Hex;
  firstAdmittedBlock: UintString;
  initialServiceLevel: UintString;
  admissionPolicyVersion: number;
  admissionHash: Hex;
};
```

For re-entry, preserve:

```ts
type CommunitySeatReentryV1 = {
  owner: Address;
  censusHash: Hex;
  previousServiceLevel: UintString;
  communityFloor: UintString;
  reentryServiceLevel: UintString;
  policyVersion: number;
  reentryHash: Hex;
};
```

Then reconstruction is deterministic:

```text
initial/reentry level
+ confirmed credited deliveries after that checkpoint
```

## 5. Square state reconstruction

`deliveryCount(tokenId)` is simpler:

```text
deliveryCount
=
number of confirmed Community Engine final deliveries to that Square
```

Reconstruct from confirmed delivery/repair receipts.

Store Square token ID, destination TBA, collection/token ID and final receipt identity in each credited delivery evidence.

## 6. Collection coverage reconstruction

For each seat/current address history:

```text
hasReceivedCollection(owner, C)
```

is true when a confirmed final Community Engine delivery credited to that seat has collection `C`.

Repair recipients receive the coverage credit; departed original assignment does not.

Collection coverage must be reconstructable from delivery history, not mutable boolean flags only.

## 7. Mint-run inventory reconstruction

For each mint run:

1. read admitted mint plan;
2. identify canonical confirmed acquisition transaction;
3. parse adapter-defined acquisition events;
4. verify collector final ownership at acquisition/finality block;
5. reproduce inventory manifest/hash.

A database inventory row without matching receipt/evidence is not authoritative.

## 8. Assignment reconstruction

Given:

```text
inventory manifest
allocation census
fairness state checkpoint
fairness policy
randomness policy
verified randomness record
```

re-run `FairAllocationV1` and require exact `allocationResultHash`.

Persisted assignment rows are valid only if they match that deterministic result or a linked deterministic repair artifact.

## 9. Repair reconstruction

Repair history is append-only:

```text
original assignment
→ repair reason
→ Tier-1 standby selection OR Tier-2 repair commitment/randomness
→ final repair assignment
→ delivery receipt
```

Do not overwrite original `ownerSeat`/token assignment fields to make current tables simpler.

A current materialized view can point to `effectiveFinalAssignmentId`, but audit history remains intact.

## 10. Transaction-attempt reconstruction

Transaction attempt records combine provider state and chain state.

If DB loses an attempt row but the operation has a known deterministic plan/nonce/tx hash elsewhere:

- query chain/provider;
- reconstruct attempt chronology as far as evidence permits;
- if send/no-send boundary remains ambiguous, classify `UNCERTAIN` rather than inventing `NOT_SUBMITTED`.

Do not manufacture missing timestamps or provider IDs as factual evidence.

## 11. Database-loss recovery tiers

### Tier R0 — no loss

Normal restart/reconciliation.

### Tier R1 — derived-table loss, journal/evidence intact

Rebuild:

```text
seat state
Square state
collection coverage
current run statuses
```

from journal + canonical receipts/artifacts.

### Tier R2 — journal partly lost, public/hash-bound artifacts + chain intact

Reconstruct conservative state from:

- checked-in/offsite evidence backups if admitted;
- public proof artifacts;
- chain receipts/logs;
- signed/versioned policy manifests.

Any unreconstructable pending operation becomes `REPAIR_REQUIRED`/manual security review, not guessed.

### Tier R3 — critical evidence unavailable

STOP engine. Do not reset fairness to zero or start a new clean database as if history never happened.

Owner/security recovery decision required.

## 12. Backup scope

Future runtime backup should include at minimum:

```text
journal/events
policy manifests/hashes
watch records
mint plans
inventory manifests
allocation commitments/results
randomness records
assignment/repair artifacts
transaction attempt IDs/hashes
seat admission/reentry checkpoints
confirmed delivery proof references
RMT Pay policy/receipts
```

Do not back up signer private keys inside the same general application database backup.

Signer credentials follow provider/secret-management recovery procedures.

## 13. Artifact immutability

Once an artifact hash is referenced by a later artifact, do not edit it in place.

Changes create a new schema/version/artifact.

Examples:

```text
FairnessPolicyV1 -> V2
MintAdapter seadr... v1 -> v2
RmtPayPolicy version 1 -> 2
```

Historical proof continues using the old exact hash/version.

## 14. Schema versioning

Every persisted structured artifact must use:

```text
schemaVersion
```

Parsers:

- reject unknown future version by default;
- never silently coerce unknown fields;
- migrations are explicit functions/scripts with tests;
- original raw/hash evidence is retained where possible.

Do not make parser “lenient” merely to ease a future migration; evidence domains should fail closed.

## 15. Policy versioning

Separate policies must have independent versions/hashes:

```text
fairnessPolicyVersion
randomnessPolicyVersion
qualityPolicyVersion
mintAdapterVersion
gasPolicyVersion
collectorReleasePolicyVersion
repairPolicyVersion
RmtPayPolicyVersion
```

Do not use one global `version=2` to ambiguously change every domain.

## 16. Fairness-policy migration

If owner later changes fairness semantics (e.g. fairness epochs/Sybil mitigation), do not reinterpret historical V1 deliveries under new policy.

Migration must define:

1. exact transition block/census;
2. old service state checkpoint;
3. mapping from old state to new state;
4. whether service levels reset/normalize/carry forward;
5. impact on pending inventory/assignments;
6. public migration artifact/hash;
7. tests proving no silent extra entitlement/loss.

Historical V1 allocation proofs remain valid under V1.

## 17. Collector rotation migration

A new collector does not reset:

- fairness state;
- inventory history;
- collection coverage;
- candidate history.

Rotation artifact should bind:

```text
old collector
new collector
reason
transition block/time
pending inventory disposition
pending nonce/tx reconciliation status
old/new signer policy evidence
rotationHash
```

Do not activate new collector while old collector has unresolved `UNCERTAIN` tx unless recovery explicitly handles the nonce/asset implications.

## 18. Inventory migration during collector rotation

If old collector still safely owns committed inventory:

Preferred order:

1. finish deterministic deliveries from old collector if signer still trustworthy; or
2. under compromise/rotation policy, move each exact committed NFT to the new collector with an explicit migration transaction/evidence while preserving original inventory/assignment identity;
3. then resume delivery.

No generic bulk sweep to admin/treasury.

Migration tx is operational custody transfer, not a new acquisition/allocation.

## 19. Mint-adapter version migration

If a mint family upgrades runtime or semantics:

- old adapter remains valid only for historical plans bound to old runtime;
- new candidate plans require new adapter/runtime evidence;
- do not retroactively relabel old plans;
- if runtime changes between plan and sign, old plan invalidates.

## 20. Randomness-network migration

If drand Quicknet changes/deprecates or another VRF is adopted:

- old batches keep exact source/chainHash/round/record;
- new randomness policy version names new source;
- no re-verification of historical outputs using different network;
- transition applies from explicit policy boundary.

## 21. Gas-policy migration

Increasing spend caps is a security/economics change.

New gas policy version requires:

- measured evidence;
- owner/release approval as applicable;
- explicit effective boundary;
- no retroactive change to old run budget claims.

Decreasing caps can still strand pending work; migration must account for committed inventory delivery obligations.

## 22. RMT Pay policy migration

RMT Pay pricing/utility changes create new policy hashes.

Never mutate old receipts to current price.

If a utility is retired:

- stop admitting new intents after boundary;
- reconcile existing submitted intents;
- historical burns remain attributed to old policy.

## 23. Rebuild command posture

Package H may eventually provide read-only/admin recovery tools such as conceptually:

```text
rebuild fairness state
rebuild inventory status
verify all allocation results
verify all confirmed delivery credits
```

These tools should default to dry-run/diff output before mutating derived tables.

No recovery tool can sign blockchain transactions merely because it found inconsistency.

## 24. Invariant reconciliation job

A periodic read-only invariant job can verify:

```text
seat materialized state == reconstructed journal/receipt state
Square counts == confirmed deliveries
collection coverage == confirmed deliveries
pending inventory owner == collector
confirmed delivered NFT owner == recorded canonical TBA at receipt
allocationResultHash recomputes
randomness record verifies
```

Mismatch:

```text
AUTOPAUSE / REPAIR_REQUIRED
```

not automatic database overwrite without evidence.

## 25. Public proof as recovery aid

Publishing/sanitizing proof packets improves not only transparency but disaster recovery: externally persisted proof hashes/artifacts can help verify local reconstruction after data loss.

Do not rely solely on public UI hosting as backup; maintain independent durable artifact backups when runtime exists.

## 26. Integrity checkpoint

Periodically create a deterministic aggregate state checkpoint:

```ts
type CommunityStateCheckpointV1 = {
  schemaVersion: 1;
  throughJournalEventId: Hex;
  throughBlock: UintString;
  throughBlockHash: Hex;
  seatStateHash: Hex;
  squareStateHash: Hex;
  collectionCoverageHash: Hex;
  pendingInventoryHash: Hex;
  pendingAssignmentsHash: Hex;
  policySetHash: Hex;
  checkpointHash: Hex;
};
```

This accelerates recovery while remaining verifiable against prior evidence.

Exact checkpoint cadence is Package H operations policy, not fixed now.

## 27. No fairness reset shortcut

Explicitly forbidden recovery:

```text
DB lost -> set everyone serviceLevel=0
```

or:

```text
start new epoch so old state doesn't matter
```

unless the owner intentionally authorizes a public policy migration with full evidence/impact analysis.

## 28. No “current owner gets historical credit rewrite”

When a Square transfers, old delivery history stays attributed to:

- the seat that actually received the service credit at delivery time; and
- the Square token ID that actually received the NFT.

Do not rewrite old seat-credit history to the Square's new owner.

New owner starts/continues according to owner-address admission/fairness policy.

## 29. State privacy

Critical reconstruction requires no offchain PII.

Persist only public wallet/chain/protocol state and operational metadata necessary for the engine.

Do not add identity heuristics or IP/device data to make reconstruction “easier.”

## 30. Package H acceptance additions

Before production, prove:

- derived fairness state can be rebuilt from an empty materialized-state database using preserved evidence/journal/receipts;
- rebuilding twice is idempotent;
- tampered artifact/hash is rejected;
- missing evidence yields explicit unresolved state, not guessed values;
- seat late-entry/reentry levels reconstruct exactly;
- repair-delivery credit reconstructs to final recipient only;
- pending uncertain tx blocks unsafe state reconstruction/next signing;
- state checkpoint verifies;
- collector rotation fixture preserves fairness/inventory.

## 31. V1 operational claim

A correctly implemented Community Engine should be able to say:

> The database makes operation efficient, but confirmed chain evidence plus hash-bound Community Engine artifacts define the history. Losing a derived table does not erase or reset community fairness.

That is the standard future Package H should meet.
