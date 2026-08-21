# CCFF00 Community Engine Packages A/B implementation packet V1

**Status:** PLANNING ONLY — FUTURE OPENAI CODEX IMPLEMENTATION PACKET  
**Packages:** A = current-owner census; B = original-mint provenance  
**Execution authority:** none; both packages are read-only.

This packet narrows Packages A/B to concrete code boundaries so Codex does not redesign the holder model while implementing it.

## 1. Preconditions

Before Package A:

- owner has explicitly opened the Community Engine project;
- latest `main` architecture no longer blocks the package;
- Codex creates a fresh bounded branch from latest `main`;
- Codex reads `CODEX_START_HERE_V1.md`, `DECISION_REGISTER_V1.md`, `SPEC_CONSISTENCY_V1.md`, `DATA_MODEL_V1.md`, `ACCEPTANCE_MATRIX_V1.md`, and this packet;
- inspect latest `distribution-ccff00.ts` and affected tests before editing.

Package B begins only after Package A is reviewed/accepted.

## 2. Package A objective

Answer from one exact Robinhood Chain block:

> How many admitted public CCFF00 Squares exist, how many unique current owner addresses hold them, which Squares does each owner hold, and what is the canonical TBA for each Square?

No historical minter analysis yet.

## 3. Package A source reuse

Primary existing input:

```text
Ccff00PublicSnapshotV1
```

from:

```text
apps/web/lib/vnext/distribution-ccff00.ts
```

Package A should **not** duplicate:

- collection address;
- public range constants;
- registry;
- implementation;
- salt;
- TBA derivation;
- runtime verification;
- RPC full-public read implementation.

If a needed canonical field is not exported, make the smallest reviewed export/refactor possible.

## 4. Package A preferred files

Subject to latest-main conventions:

```text
apps/web/lib/vnext/ccff00-community-census.ts
apps/web/lib/vnext/ccff00-community-census-smoke.ts
apps/web/scripts/vnext-ccff00-community-census.ts
```

Optional checked-in synthetic fixture directory only if current test conventions justify it:

```text
apps/web/lib/vnext/fixtures/ccff00-community-census/
```

Do not add:

```text
API route
Firebase collection
Postgres table
new service/worker
UI page/component
signer/wallet code
```

## 5. Package A pure domain API

Recommended conceptual public functions:

```ts
export function buildCcff00CommunityCensusV1(
  snapshot: Ccff00PublicSnapshotV1
): Ccff00CommunityCensusV1;

export function parseCcff00CommunityCensusV1(
  value: unknown
): Ccff00CommunityCensusV1;

export function summarizeCcff00CommunityCensusV1(
  census: Ccff00CommunityCensusV1
): Ccff00CommunityCensusSummaryV1;
```

No network calls inside these functions.

## 6. Package A input admission

Builder requires:

```text
schemaVersion == existing snapshot version
adapterId == canonical CCFF00 adapter
chainId == 4663
coverage == full_public
snapshotBlock > 0
snapshotBlockHash != zero
collection/runtime identity valid
registry/runtime identity valid
account implementation/runtime identity valid
salt exact
publicStartTokenId exact
publicMinted within admitted supply
rows.length == publicMinted
```

The existing snapshot parser/reader should already prove most infrastructure fields; census builder still validates the assumptions it relies on rather than trusting an arbitrary object cast.

## 7. Package A row validation

For every row:

```text
tokenId is canonical unsigned integer
expected public token ID range is complete/no gaps
current owner != zero
TBA is valid nonzero EVM address
no duplicate tokenId
no duplicate canonical TBA
activated/runtime state is internally consistent
```

If existing snapshot fields include CCFF00/RMT balances, the census does not need to copy them unless they are necessary for a locked invariant. Keep the census focused on seat/destination identity.

## 8. Package A grouping algorithm

Input rows are not trusted to be sorted.

Canonical procedure:

1. sort rows numerically by token ID;
2. create owner map keyed by lowercase address for grouping only;
3. preserve checksummed owner value in artifact;
4. append token ID/TBA to owner group;
5. sort each group's token IDs numerically and TBAs in corresponding token-ID order;
6. sort owner groups by lowercase 20-byte owner address;
7. derive summary;
8. canonical-hash complete artifact excluding `censusHash`;
9. attach `censusHash`.

Input row ordering must not change output/hash.

## 9. Package A summary definitions

Let `squareCount(owner)` equal number of admitted public rows currently owned.

```text
publicMinted = rows.length
uniqueCurrentOwners = ownerGroups.length
ownersWithExactly1 = count(squareCount == 1)
ownersWithExactly2 = count(squareCount == 2)
ownersWithExactly3 = count(squareCount == 3)
ownersWithExactly4 = count(squareCount == 4)
ownersWith5Plus = count(squareCount >= 5)
maxSquaresPerOwner = max(squareCount)
activatedTbas = count(rows where activated)
uniqueTbas = unique(row.tokenBoundAccount).size
```

Required accounting invariant:

```text
sum(ownerGroup.squareCount) == publicMinted
```

and:

```text
exactly1 + exactly2 + exactly3 + exactly4 + fivePlus
== uniqueCurrentOwners
```

## 10. Package A hash domain

Use repository canonical JSON conventions.

Conceptual domain:

```text
RMT_CCFF00_COMMUNITY_CENSUS_V1
```

Do not use `JSON.stringify` on uncontrolled object key ordering as the security definition if existing `canonicalDistributionJson` can be reused.

Parser must recompute and compare hash.

## 11. Package A CLI

Preferred CLI behavior:

```text
pnpm --filter web <future-command>
```

Exact package-script name can follow latest conventions. Suggested eventual script:

```text
readiness:vnext-ccff00-community-census
```

### Default mode

Read one full-public snapshot and print concise JSON:

```json
{
  "mode": "read_only",
  "chainId": 4663,
  "snapshotBlock": "...",
  "snapshotBlockHash": "0x...",
  "publicMinted": 654,
  "uniqueCurrentOwners": 0,
  "ownersWithExactly1": 0,
  "ownersWithExactly2": 0,
  "ownersWithExactly3": 0,
  "ownersWithExactly4": 0,
  "ownersWith5Plus": 0,
  "maxSquaresPerOwner": 0,
  "activatedTbas": 0,
  "uniqueTbas": 0,
  "censusHash": "0x..."
}
```

The numbers above except `chainId` are shape examples, **not hard-coded expected live values**.

### Exact historical block

Support:

```text
--block=<uint>
```

using existing snapshot reader capability.

### Full artifact

Support an explicit flag such as:

```text
--full
```

or `--json=full`, following repository CLI conventions.

Full mode prints the deterministic artifact, not secrets.

### No file write by default

Default should print to stdout. If a `--out` option is later useful, keep it explicit and never overwrite existing evidence silently.

## 12. Package A synthetic test matrix

Required fixtures:

### A1 — one owner / one Square

```text
rows:
#1 -> Owner A -> TBA1

unique owners=1
exactly1=1
```

### A2 — one owner / three Squares

```text
#1 -> A -> TBA1
#2 -> A -> TBA2
#3 -> A -> TBA3

unique owners=1
exactly3=1
squareCount(A)=3
```

This is the direct regression for the user scenario motivating current-owner deduplication.

### A3 — mixed owner distribution

```text
A owns 1
B owns 2
C owns 3
D owns 5
```

Verify exact bucket counts and total rows.

### A4 — row-order permutation

Shuffle input rows repeatedly; output artifact/hash must remain identical.

### A5 — buyer transfer snapshot

Snapshot N:

```text
#2 -> A
```

Snapshot N+1:

```text
#2 -> B
```

Census builder must group based on each snapshot's current owner, not persisted historical grouping.

### A6 — duplicate token

Hard reject `CCFF00_CENSUS_DUPLICATE_TOKEN_ID`.

### A7 — duplicate TBA

Hard reject `CCFF00_CENSUS_DUPLICATE_TBA`.

### A8 — reserve/project ID

A row outside canonical current public range must not create a seat. Prefer hard reject malformed full-public snapshot rather than silently ignore unexpected rows.

### A9 — invalid infra/hash

Use existing CCFF00 fail-closed fixture patterns.

## 13. Package A live-read posture

The live command is read-only and should tolerate rate limiting with bounded retry/backoff consistent with existing CCFF00 readiness script.

Do not increase concurrency aggressively merely to make a one-time census faster.

On partial/unresolved row:

```text
FAIL WHOLE CENSUS
```

Do not report an apparently precise unique-owner count from incomplete data.

## 14. Package A completion report

Codex must report:

```text
BASE_SHA
HEAD_SHA
FILES_CHANGED
TESTS_RUN
TEST_RESULTS
LIVE_RPC_USED yes/no
SNAPSHOT_BLOCK
SNAPSHOT_BLOCK_HASH
PUBLIC_MINTED
UNIQUE_CURRENT_OWNERS
1/2/3/4/5+ distribution
MAX_SQUARES_PER_OWNER
ACTIVATED_TBAS
CENSUS_HASH
BLOCKERS
```

No need to publish individual owner addresses in normal chat output unless the owner asks.

Then STOP.

---

# Package B — original mint provenance

## 15. Package B objective

Answer separately:

> For each admitted public CCFF00 token ID, which address was its initial ERC-721 mint recipient, and how many original recipients received more than one Square?

This does **not** change allocation seats.

## 16. Package B required first step — deployment/start boundary

Do not begin `eth_getLogs` from block 0 by default and do not guess a start block.

First independently prove a canonical collection-start boundary using current repository/onchain evidence, for example:

- deployment receipt/address creation evidence;
- archive bytecode boundary where code first exists;
- authoritative checked-in deployment evidence if current repo contains it and it matches chain.

Artifact records:

```text
collectionStartBlock
```

and tests fail if caller substitutes an unverified boundary.

## 17. Package B preferred files

```text
apps/web/lib/vnext/ccff00-mint-provenance.ts
apps/web/lib/vnext/ccff00-mint-provenance-smoke.ts
apps/web/scripts/vnext-ccff00-mint-provenance.ts
```

Still no database/worker/UI.

## 18. Package B log topic

Canonical ERC-721 Transfer:

```text
Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
```

Mint provenance condition:

```text
from == 0x0000000000000000000000000000000000000000
```

The initial recipient is event `to`, not blindly transaction sender.

## 19. Package B bounded log reader

Server/CLI adapter concept:

```ts
async function readCcff00MintTransferLogsV1(input: {
  client;
  fromBlock: bigint;
  toBlock: bigint;
  chunkSize: bigint;
}): Promise<CanonicalErc721TransferLog[]>;
```

Requirements:

- exact collection address filter;
- exact Transfer topic;
- zero-address indexed `from` filter where provider supports it, plus local decode validation;
- bounded chunks;
- retry with maximum attempts/backoff;
- block identity evidence for final through block;
- deterministic merge/sort by blockNumber, txIndex, logIndex;
- duplicate log identity rejection.

## 20. Package B artifact validation

Expected admitted public token IDs:

```text
publicStart .. publicStart + publicMinted - 1
```

For each expected ID, exactly one mint provenance event must exist.

If missing or duplicate:

```text
FAIL COMPLETE PROVENANCE ARTIFACT
```

Do not fabricate initial recipient from current owner or transaction sender.

## 21. Package B grouping

Group by lowercase initial recipient for deterministic counting.

Summary buckets match current census style:

```text
uniqueOriginalRecipients
originalRecipientsWithExactly1
originalRecipientsWithExactly2
originalRecipientsWithExactly3
originalRecipientsWithExactly4
originalRecipientsWith5Plus
maxOriginalRecipientCount
```

## 22. Package B hash domain

Conceptual:

```text
RMT_CCFF00_MINT_PROVENANCE_V1
```

Artifact hash must include:

- exact collection;
- start boundary;
- through block/hash;
- all canonical rows;
- summary.

## 23. Package B optional incremental checkpoint

At current scale, a full bounded scan is acceptable if RPC provider limits allow it.

If incremental extension is useful, a prior artifact can be trusted only after:

- parsing/recomputing prior hash;
- confirming prior through-block hash remains canonical;
- matching collection/start boundary/schema;
- then scanning strictly after prior through block.

If checkpoint block was reorged, discard/rebuild from a safe prior point rather than append to stale evidence.

This is still an artifact workflow, not a universal always-on indexer.

## 24. Package B synthetic tests

### B1 — three mints same initial recipient

```text
#1 zero -> A
#2 zero -> A
#3 zero -> A
```

Expected:

```text
uniqueOriginalRecipients=1
exactly3=1
```

### B2 — later transfers ignored

```text
#1 zero -> A
#1 A -> B
#1 B -> C
```

Initial recipient remains A.

### B3 — transaction sender differs from event recipient

Synthetic tx sender X, event `to=A`.

Initial recipient must be A.

### B4 — duplicate mint event same token ID

Hard reject.

### B5 — missing public token ID

Hard reject.

### B6 — reserve token mint event

May be ignored for **public provenance artifact**, but must not enter public recipient counts. If implementation chooses to retain reserve analytics, separate the schema/domain explicitly; do not mix it into V1 public provenance.

### B7 — log order permutation

Canonical artifact/hash stable.

### B8 — wrong collection/start block

Hard reject.

## 25. Package B output relationship to Package A

Keep these metrics side-by-side, not merged into one entitlement number:

```text
CURRENT
uniqueCurrentOwners

HISTORICAL
uniqueOriginalRecipients
original multi-mint distribution
```

A future report may compare them, e.g.:

```text
public Squares = N
current unique owner seats = M
original unique recipients = K
```

but only `M` is V1 current seat count.

## 26. Package B completion report

Codex reports:

```text
BASE_SHA
HEAD_SHA
FILES_CHANGED
TESTS_RUN
COLLECTION_START_BLOCK
THROUGH_BLOCK/HASH
PUBLIC_TOKEN_EVENTS_FOUND
UNIQUE_ORIGINAL_RECIPIENTS
1/2/3/4/5+ original distribution
MAX_ORIGINAL_RECIPIENT_COUNT
PROVENANCE_HASH
BLOCKERS
```

Then STOP before provider/mint discovery.

## 27. A/B integration acceptance

Packages A/B are complete as a foundation when the repository can reproducibly answer, from chain evidence:

```text
Current owner seat census
      !=
Original mint recipient provenance
```

and prove both independently with deterministic artifacts/hashes.

No identity heuristics or NFT execution is required for this foundation.
