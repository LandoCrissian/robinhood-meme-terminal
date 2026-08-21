# CCFF00 Community Engine reference interfaces V1

**Status:** PLANNING ONLY — NON-EXECUTABLE REFERENCE SHAPES  
**Purpose:** give future Codex implementation-shaped boundaries without adding runtime code to the paused domain.

These are reference TypeScript-style interfaces/function contracts. Latest `main` conventions win for exact syntax/location, but semantics should remain stable unless the owner changes a locked decision.

## 1. Design rule

Pure domain modules should accept already-fetched evidence and return deterministic values.

Network/provider access belongs in server/CLI adapters.

Signing/submission belongs in a later separately admitted execution boundary.

Preferred direction:

```text
provider/RPC adapter
    ↓
validated evidence
    ↓
pure deterministic domain
    ↓
hash-bound plan/result
    ↓
separate signer/submission adapter (later packages only)
    ↓
receipt reconciliation
```

## 2. Common primitives

Reference aliases:

```ts
type Address = `0x${string}`;
type Hex = `0x${string}`;
type UintString = string; // canonical base-10 unsigned integer
```

Every admitted schema should carry:

```ts
schemaVersion: number;
chainId: 4663;
```

where applicable.

## 3. Package A — census domain

Reference row:

```ts
type Ccff00CommunityCensusRowV1 = {
  tokenId: UintString;
  currentOwner: Address;
  tokenBoundAccount: Address;
  activated: boolean;
  accountRuntimeHash: Hex | null;
};
```

Owner group:

```ts
type Ccff00CommunityOwnerGroupV1 = {
  owner: Address;
  tokenIds: UintString[];
  tokenBoundAccounts: Address[];
  squareCount: number;
};
```

Summary:

```ts
type Ccff00CommunityCensusSummaryV1 = {
  publicMinted: number;
  uniqueCurrentOwners: number;
  ownersWithExactly1: number;
  ownersWithExactly2: number;
  ownersWithExactly3: number;
  ownersWithExactly4: number;
  ownersWith5Plus: number;
  maxSquaresPerOwner: number;
  activatedTbas: number;
  uniqueTbas: number;
};
```

Artifact:

```ts
type Ccff00CommunityCensusV1 = {
  schemaVersion: 1;
  chainId: 4663;
  sourceSnapshotHash: Hex;
  snapshotBlock: UintString;
  snapshotBlockHash: Hex;
  collection: Address;
  collectionRuntimeHash: Hex;
  registry: Address;
  registryRuntimeHash: Hex;
  accountImplementation: Address;
  accountImplementationRuntimeHash: Hex;
  erc6551Salt: Hex;
  publicStartTokenId: UintString;
  publicMinted: UintString;
  rows: Ccff00CommunityCensusRowV1[];
  ownerGroups: Ccff00CommunityOwnerGroupV1[];
  summary: Ccff00CommunityCensusSummaryV1;
  censusHash: Hex;
};
```

Pure builder concept:

```ts
function buildCcff00CommunityCensusV1(
  snapshot: Ccff00PublicSnapshotV1
): Ccff00CommunityCensusV1;
```

Parser concept:

```ts
function parseCcff00CommunityCensusV1(
  value: unknown
): Ccff00CommunityCensusV1;
```

Required behavior:

- `coverage == full_public`;
- exact public row count/range;
- unique token IDs/TBAs;
- canonical grouping/sorting;
- hash recomputation on parse;
- no network access inside builder/parser.

## 4. Package B — provenance domain

Row:

```ts
type Ccff00MintProvenanceRowV1 = {
  tokenId: UintString;
  initialRecipient: Address;
  transactionHash: Hex;
  blockNumber: UintString;
  blockHash: Hex;
  transactionIndex: number | null;
  logIndex: number;
};
```

Artifact:

```ts
type Ccff00MintProvenanceV1 = {
  schemaVersion: 1;
  chainId: 4663;
  collection: Address;
  collectionStartBlock: UintString;
  throughBlock: UintString;
  throughBlockHash: Hex;
  rows: Ccff00MintProvenanceRowV1[];
  summary: {
    uniqueOriginalRecipients: number;
    exactly1: number;
    exactly2: number;
    exactly3: number;
    exactly4: number;
    fivePlus: number;
    maxOriginalRecipientCount: number;
  };
  provenanceHash: Hex;
};
```

Reference builder:

```ts
function buildCcff00MintProvenanceV1(input: {
  collection: Address;
  collectionStartBlock: bigint;
  throughBlock: bigint;
  throughBlockHash: Hex;
  logs: CanonicalErc721TransferLog[];
  admittedPublicStartTokenId: bigint;
  admittedPublicMinted: bigint;
}): Ccff00MintProvenanceV1;
```

Log fetching/chunking remains outside the pure builder.

## 5. Package C — candidate domain

Status enum concept:

```ts
type CommunityMintCandidateStatusV1 =
  | "WOULD_INSPECT"
  | "WOULD_REJECT"
  | "UNKNOWN_ADAPTER"
  | "PROVIDER_UNAVAILABLE"
  | "NOT_ACTIVE"
  | "NOT_FREE";
```

Normalized candidate:

```ts
type CommunityMintCandidateV1 = {
  schemaVersion: 1;
  chainId: 4663;
  candidateId: Hex;
  sourceId: string;
  sourceReference: string;
  collection: Address;
  mintTarget: Address;
  stageId: string;
  startTime: UintString | null;
  endTime: UintString | null;
  observedMintValueAtomic: UintString | null;
  maxPerWallet: UintString | null;
  remainingSupply: UintString | null;
  allowlistMode:
    | "NONE"
    | "COLLECTOR"
    | "INDIVIDUAL_MINTER"
    | "SIGNED"
    | "TOKEN_GATED"
    | "UNKNOWN";
  providerEvidenceHash: Hex;
  observedAt: string;
  status: CommunityMintCandidateStatusV1;
  reasons: string[];
  candidateHash: Hex;
};
```

Normalization concept:

```ts
interface CommunityMintDiscoveryAdapterV1 {
  readonly sourceId: string;
  observe(input: DiscoveryInput): Promise<unknown>;
  normalize(raw: unknown): CommunityMintCandidateV1[];
}
```

Provider adapter has no signing method.

## 6. WATCH PROJECT control input

Reference operator input:

```ts
type CommunityWatchProjectInputV1 = {
  sourceUrl?: string;
  collection?: Address;
  mintTarget?: Address;
  expectedStartTime?: UintString;
  expectedEndTime?: UintString;
  expectedZeroPrice?: boolean;
  expectedCollectorAllowlist?: boolean;
  collectorProofData?: unknown;
  note?: string;
};
```

Normalized watch record should have deterministic identity and bounded/sanitized fields.

There must be **no** field such as:

```ts
forceApprove: true
skipSafety: true
preferredRecipients: Address[]
```

## 7. Package D — mint adapter contract

Reference adapter identity:

```ts
type CommunityMintAdapterDefinitionV1 = {
  adapterId: string;
  adapterVersion: number;
  chainId: 4663;
  contractFamily: string;
  admittedSelectors: Hex[];
  proxyValidationMode: "DIRECT" | "EIP1967" | "EIP1167" | "EXACT_KNOWN";
  recipientSemantics: string;
  quantitySemantics: string;
  priceSemantics: "NATIVE_VALUE_ZERO";
  allowlistSemantics: string;
};
```

Decoded request:

```ts
type DecodedMintRequestV1 = {
  collection: Address;
  target: Address;
  selector: Hex;
  minter: Address;
  payer: Address;
  recipient: Address;
  quantity: UintString;
  decodedMintPriceAtomic: UintString;
  transactionValueAtomic: UintString;
  stageIdentity: string;
  proofIdentityHash: Hex | null;
};
```

Adapter interface concept:

```ts
interface CommunityMintAdapterV1 {
  readonly definition: CommunityMintAdapterDefinitionV1;

  matches(input: {
    target: Address;
    selector: Hex;
    runtimeEvidence: MintRuntimeEvidenceV1;
  }): boolean;

  decode(input: {
    target: Address;
    calldata: Hex;
    value: bigint;
    collector: Address;
  }): DecodedMintRequestV1;

  readStage(
    client: ReadOnlyChainClient,
    decoded: DecodedMintRequestV1,
    blockNumber: bigint
  ): Promise<MintStageEvidenceV1>;

  expectedPostconditions(
    decoded: DecodedMintRequestV1
  ): MintPostconditionV1[];
}
```

Signing is not part of the adapter.

## 8. Mint runtime evidence

Reference shape:

```ts
type MintRuntimeEvidenceV1 = {
  blockNumber: UintString;
  blockHash: Hex;
  collection: Address;
  collectionRuntimeHash: Hex;
  target: Address;
  targetRuntimeHash: Hex;
  proxyImplementation: Address | null;
  proxyImplementationRuntimeHash: Hex | null;
};
```

## 9. Mint plan

Reference unsigned plan:

```ts
type CommunityMintPlanV1 = {
  schemaVersion: 1;
  chainId: 4663;
  planVersion: 1;
  candidateId: Hex;
  adapterId: string;
  adapterVersion: number;
  collector: Address;
  collection: Address;
  target: Address;
  selector: Hex;
  calldataHash: Hex;
  nativeValueAtomic: "0";
  quantity: UintString;
  stageIdentityHash: Hex;
  runtimeEvidenceHash: Hex;
  eligibilityEvidenceHash: Hex | null;
  fairnessPreflightHash: Hex;
  estimatedGas: UintString;
  validFrom: UintString;
  expiresAt: UintString;
  policyVersion: number;
  planHash: Hex;
};
```

Critical field:

```ts
nativeValueAtomic: "0"
```

not merely `string` after parse/admission.

## 10. Fairness preflight before mint

To enforce one-mint-run/one-floor-cohort:

```ts
type CommunityFairnessPreflightV1 = {
  censusBlock: UintString;
  censusHash: Hex;
  communityFloor: UintString;
  collection: Address;
  eligibleFloorSeats: Address[];
  eligibleCount: number;
  requestedQuantity: UintString;
  admittedQuantity: UintString;
  preflightHash: Hex;
};
```

Reference function:

```ts
function planMintQuantityForFairnessV1(input: {
  floorSeats: CommunitySeatStateV1[];
  collectionReceiptHistory: CollectionReceiptHistoryV1;
  creatorMaxQuantity: bigint;
  authoritativeRemainingSupply: bigint | null;
  localMaxQuantity: bigint;
}): CommunityFairnessPreflightV1;
```

If exact mint semantics force quantity above the admitted count, automatic execution must stop.

## 11. Package E — verified randomness record

Reference:

```ts
type VerifiedRandomnessRecordV1 = {
  schemaVersion: 1;
  sourceId: string;
  chainHash: Hex;
  round: UintString;
  randomness: Hex;
  signature: Hex;
  previousSignature: Hex | null;
  verified: true;
  verificationImplementationVersion: string;
  recordHash: Hex;
};
```

Allocator accepts only `verified: true` parsed evidence produced by the randomness verifier, not raw HTTP JSON.

## 12. Allocation commitment

Reference:

```ts
type CommunityAllocationCommitmentV1 = {
  schemaVersion: 1;
  chainId: 4663;
  mintRunId: Hex;
  acquisitionTxHash: Hex;
  allocationAnchorBlock: UintString;
  allocationAnchorBlockHash: Hex;
  allocationAnchorTimestamp: UintString;
  censusHash: Hex;
  inventoryHash: Hex;
  fairnessStateHash: Hex;
  fairnessPolicyHash: Hex;
  randomnessPolicyHash: Hex;
  derivedRandomnessRound: UintString;
  commitmentHash: Hex;
};
```

The future round is derived from anchor timestamp + fixed policy, not operator input.

## 13. Inventory item/manifest

Reference item intentionally excludes value/rarity:

```ts
type CommunityInventoryItemV1 = {
  collection: Address;
  tokenId: UintString;
  acquisitionTxHash: Hex;
  acquisitionLogIndex: number;
};
```

No fields:

```text
floorPrice
rarity
bid
estimatedValue
```

Manifest:

```ts
type CommunityInventoryManifestV1 = {
  schemaVersion: 1;
  chainId: 4663;
  mintRunId: Hex;
  collection: Address;
  items: CommunityInventoryItemV1[];
  inventoryHash: Hex;
};
```

## 14. Persistent seat state

Reference:

```ts
type CommunitySeatStateV1 = {
  owner: Address;
  serviceLevel: UintString;
  firstSeenBlock: UintString;
  lastSeenBlock: UintString;
  active: boolean;
  lastConfirmedAllocationBatch: Hex | null;
};
```

No weighting field.

## 15. Persistent Square state

Reference:

```ts
type CommunitySquareStateV1 = {
  tokenId: UintString;
  deliveryCount: UintString;
  lastConfirmedDeliveryBatch: Hex | null;
  lastConfirmedCollection: Address | null;
};
```

Square state follows the Square/token ID, not the current owner.

## 16. Collection receipt history

Reference:

```ts
type CollectionReceiptHistoryV1 = {
  owner: Address;
  collections: Address[];
  historyHash: Hex;
};
```

This tracks confirmed Community Engine collection coverage, not all NFTs the wallet has ever owned.

## 17. Allocation assignment

Reference:

```ts
type CommunityAssignmentV1 = {
  assignmentId: Hex;
  mintRunId: Hex;
  ownerSeat: Address;
  sourceServiceLevel: UintString;
  collection: Address;
  tokenId: UintString;
  squarePreferenceOrder: UintString[];
  selectedSquareTokenId: UintString;
  selectedTokenBoundAccount: Address;
  status:
    | "PLANNED"
    | "WAITING_DELIVERY"
    | "SUBMITTED"
    | "CONFIRMED"
    | "UNCERTAIN"
    | "REPAIR_REQUIRED";
};
```

The operator cannot edit `ownerSeat`, `tokenId` or preference order after commitment.

## 18. Allocation result

Reference:

```ts
type CommunityAllocationResultV1 = {
  schemaVersion: 1;
  chainId: 4663;
  commitmentHash: Hex;
  randomnessRecordHash: Hex;
  selectedSeats: Address[];
  shuffledInventory: CommunityInventoryItemV1[];
  assignments: CommunityAssignmentV1[];
  allocationResultHash: Hex;
};
```

Required:

```text
assignments.length == inventory.items.length
```

and selected seats are unique for one V1 mint-run batch.

## 19. Distribution-time ownership verifier

Reference pure/server boundary:

```ts
type SquareOwnershipRefreshV1 = {
  checkedAtBlock: UintString;
  checkedAtBlockHash: Hex;
  owner: Address;
  ownedPreferenceTokenIds: UintString[];
};
```

Function concept:

```ts
function selectCurrentSquareFromCommittedPreferenceV1(input: {
  assignedOwner: Address;
  preferenceOrder: UintString[];
  currentOwnersByTokenId: Map<UintString, Address>;
}): UintString | null;
```

No operator substitute argument exists.

## 20. Transaction attempt record

Later runtime reference:

```ts
type CommunityTransactionAttemptV1 = {
  operationId: Hex;
  operationKind: "MINT" | "DELIVERY" | "TBA_ACTIVATION" | "RMT_PAY";
  planHash: Hex;
  collectorOrSigner: Address;
  nonce: UintString | null;
  transactionHash: Hex | null;
  state:
    | "NOT_SUBMITTED"
    | "SUBMISSION_STARTED"
    | "HASH_KNOWN"
    | "UNCERTAIN"
    | "CONFIRMED_SUCCESS"
    | "CONFIRMED_FAILURE";
  lastCheckedAt: string;
};
```

`UNCERTAIN` blocks unsafe retry.

## 21. Engine operator state

Reference:

```ts
type CommunityEngineMode =
  | "STOPPED"
  | "OBSERVER"
  | "CANARY"
  | "LIMITED_PRODUCTION";
```

Runtime status:

```ts
type CommunityEngineControlStateV1 = {
  requestedRunning: boolean;
  admittedMode: CommunityEngineMode;
  effectiveMode: CommunityEngineMode;
  stopReason: string | null;
  updatedAt: string;
};
```

`START` cannot promote beyond `admittedMode`.

## 22. WATCH PROJECT normalized record

Reference:

```ts
type CommunityWatchRecordV1 = {
  watchId: Hex;
  createdAt: string;
  active: boolean;
  normalizedSourceUrl: string | null;
  collection: Address | null;
  mintTarget: Address | null;
  expectedStageWindow: {
    start: UintString | null;
    end: UintString | null;
  };
  expectedZeroPrice: boolean | null;
  expectedCollectorAllowlist: boolean | null;
  evidenceHash: Hex;
};
```

No winner/recipient fields.

## 23. Gas funding record

Reference funding observation:

```ts
type CommunityGasContributionV1 = {
  transactionHash: Hex;
  blockNumber: UintString;
  contributor: Address;
  amountAtomic: UintString;
};
```

This type must not be importable/required by the pure fairness allocator. Architectural dependency tests may enforce the separation later.

## 24. Package J/K — RMT Pay policy

Reference:

```ts
type RmtPayPolicyV1 = {
  schemaVersion: 1;
  chainId: 4663;
  policyVersion: number;
  rmtToken: Address;
  rmtRuntimeHash: Hex;
  burnDestination: "0x000000000000000000000000000000000000dEaD";
  utilityId: string;
  targets: Address[];
  selectors: Hex[];
  burnAmountAtomic: UintString;
  maxSponsoredGas: UintString;
  validFrom: UintString;
  expiresAt: UintString | null;
  policyHash: Hex;
};
```

No DEX/router target may appear in an admitted protocol-utility policy unless the owner explicitly reverses the no-sell design (not V1).

## 25. RMT Pay receipt

Reference:

```ts
type RmtPayReceiptV1 = {
  schemaVersion: 1;
  chainId: 4663;
  utilityId: string;
  policyHash: Hex;
  payerControlAddress: Address;
  rmtSourceAddress: Address;
  ccff00TokenId: UintString | null;
  transactionHash: Hex;
  blockNumber: UintString;
  blockHash: Hex;
  burnAmountAtomic: UintString;
  deadBalanceBeforeAtomic: UintString;
  deadBalanceAfterAtomic: UintString;
  sourceBalanceBeforeAtomic: UintString;
  sourceBalanceAfterAtomic: UintString;
  utilityPostconditionHash: Hex;
  gasSponsored: boolean;
  receiptHash: Hex;
};
```

Required arithmetic:

```text
sourceBefore - sourceAfter == burnAmount
deadAfter - deadBefore == burnAmount
```

for a direct burn path.

## 26. Reference function ownership

Pure domain functions should look conceptually like:

```ts
buildCcff00CommunityCensusV1(snapshot)
buildCcff00MintProvenanceV1(logEvidence)
normalizeCommunityMintCandidateV1(providerEvidence)
buildCommunityMintPlanV1(candidate, adapterEvidence, fairnessPreflight)
verifyCommunityMintPlanV1(plan, freshEvidence)
buildCommunityInventoryManifestV1(receiptEvidence)
deriveCommunityRandomnessRoundV1(anchor, policy)
verifyRandomnessRecordV1(rawBeacon, pinnedNetwork)
buildCommunityAllocationV1(inputs)
selectCurrentSquareFromCommittedPreferenceV1(...)
reconcileCommunityDeliveryV1(assignment, chainEvidence)
verifyRmtPayPolicyV1(policy)
reconcileRmtPayReceiptV1(...)
```

Network/signer functions should remain separately named/admitted, e.g.:

```ts
read...
observe...
simulate...
submit...
reconcile...
```

Do not hide signing inside a function whose name sounds like validation/building.

## 27. Dependency direction

Desired logical dependencies:

```text
CCFF00 snapshot ──> census
                      │
                      ├─> fairness preflight ──> mint plan
                      │                         │
provider observation ─> candidate ─> adapter ──┘
                                                │
                                         future submission
                                                │
                                         acquisition receipt
                                                │
                                             inventory
                                                │
acquisition block ──> historical census ────────┤
                                                │
verified randomness ────────────────────────────┤
                                                ▼
                                           allocation
                                                │
                                         delivery/reconcile
```

Gas contribution data is deliberately absent from that graph until the separate collector gas-budget check; it never points into allocation.

RMT Pay is a later sibling domain, not a dependency of NFT allocation.

## 28. Error/result style

Prefer explicit structured status/error codes over parsing human strings.

Conceptual result:

```ts
type DomainResult<T, C extends string> =
  | { ok: true; value: T }
  | { ok: false; code: C; detail?: string };
```

For existing RMT domains that currently throw fail-closed `Error`s, follow local convention rather than introducing a repository-wide result abstraction. The important requirement is stable machine-classifiable error codes at service/operator boundaries.

## 29. What this document does not authorize

It does not authorize creating these types/files in `main` today. It only narrows the future implementation shape so Codex can map the design into current repository conventions when each package is opened.
