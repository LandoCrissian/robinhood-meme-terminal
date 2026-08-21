# CCFF00 Community Engine architecture V1

**Status:** PLANNING ONLY / FUTURE IMPLEMENTATION INPUT  
**Chain:** Robinhood Chain mainnet, `chainId = 4663`  
**Implementation authority:** none until the owner explicitly clears the current terminal-completion lane and separately authorizes this project.

## 1. Purpose

Build an autonomous community utility that:

1. derives the current public CCFF00 holder population directly from Robinhood Chain;
2. collapses multiple Squares held by the same current owner address into one allocation seat;
3. discovers free NFT mint opportunities on Robinhood Chain;
4. rejects unsafe, unknown or low-confidence mints;
5. acquires only zero-mint-price NFTs while spending capped ETH for network gas;
6. distributes acquired NFTs fairly and unpredictably among active community seats;
7. delivers each allocated NFT into one canonical ERC-6551 account belonging to the selected holder's current CCFF00 Squares;
8. accepts voluntary ETH for gas without granting contributors extra allocation rights;
9. exposes only narrow operator controls: `START`, `STOP`, and `WATCH PROJECT`/whitelist input;
10. later supports a separate RMT Pay utility where approved RMT usage permanently sends RMT to the conventional dead address while native gas funding remains separate.

The engine is not an NFT launch platform, does not mint RMT NFTs, does not custody user wallets, does not promise NFT value, and does not attempt to predict which acquired NFT will appreciate.

## 2. Canonical existing boundaries

Use VNext and existing RMT primitives. Do not create another terminal architecture.

### Reuse directly

- `apps/web/lib/vnext/distribution-ccff00.ts`
  - CCFF00 collection identity;
  - public supply counters;
  - current `ownerOf` reads;
  - canonical `getTokenBoundAccount` reads;
  - ERC-6551 registry/implementation/salt identity;
  - pinned-block snapshot/runtime evidence.
- `apps/web/lib/vnext/distribution-ccff00-owner-withdrawal-proof.ts`
  - evidence that the current CCFF00 owner controls the canonical token-bound account;
  - RMT transfer-out proof pattern.
- `apps/web/lib/vnext/distribution-domain.ts`
  - canonical JSON/hashes;
  - deterministic distribution manifests;
  - ERC-721/1155 identity and batching patterns.
- existing VNext transaction simulation, authorization and fail-closed verification patterns.

### Reuse as design/security reference only

`packages/contracts/src/RMTDistributionEngineV1.sol` provides useful patterns for replay protection, sender binding, exact asset ownership checks, post-transfer verification and absence of arbitrary-call/custody surfaces. The Collector must **not** inherit its current per-recipient RMT retirement economics. Collector acquisition/distribution is gas-funded and allocation-neutral.

`apps/indexer` has strong confirmation/reorg/idempotency patterns, but repository authority reserves that service for deployed RMT V6 compatibility/history. Do **not** extend it with CCFF00/community data merely for convenience. V1 should use bounded read-only CCFF00 RPC/log evidence. A dedicated persistent community-engine service requires a later explicit architecture decision only if scale proves it necessary.

## 3. Community census and identity semantics

### 3.1 Authoritative V1 eligibility unit

```text
one CURRENT OWNER ADDRESS holding >= 1 admitted public CCFF00
=
one active Community Engine seat
```

A wallet that currently owns six public Squares has one seat. A wallet that owns one public Square also has one seat.

The engine must never use `publicMinted` itself as the required NFT count for one fair community round. It must derive the number of unique current owner addresses at the admitted snapshot.

### 3.2 Public supply only in V1

Use the canonical public-mint range already defined by `distribution-ccff00.ts`. Founder/project reserve token IDs do not create V1 seats without a later explicit owner decision.

### 3.3 Current ownership beats original mint history

For each admitted snapshot:

```text
public token ID
→ ownerOf(tokenId) at snapshot block
→ canonical TBA at same snapshot block
→ group rows by current owner
```

If one original minter minted three Squares and later sold two to independent buyers, the next snapshot has three eligible current owners if each address holds one admitted Square.

### 3.4 Original mint provenance

A bounded read-only provenance reader should reconstruct the canonical ERC-721 creation event:

```text
Transfer(from = zeroAddress, to = initialRecipient, tokenId)
```

Store/hash at least:

- `tokenId`;
- `initialRecipient`;
- `transactionHash`;
- `blockNumber`;
- `blockHash`;
- `transactionIndex` when available;
- `logIndex`.

The initial recipient, not blindly `transaction.from`, is the original-mint identity because a relayer/agent may submit a transaction for another recipient.

For V1 scale, provenance can be produced by chunked logs scoped to the exact CCFF00 collection and an admitted collection-start boundary, then committed into a deterministic artifact. Original-mint events are immutable after finality, so the reader can incrementally extend a prior proven checkpoint without a new always-on indexer. If future scale requires durable service ownership, define that service separately rather than overloading `apps/indexer`.

Original-mint clustering is analytics and anti-abuse evidence only. It never permanently overrides current ownership.

### 3.5 Cross-wallet human identity is deliberately unsolved in V1

The engine must not infer that two unrelated addresses are the same human based on:

- common funding source;
- transfer graph;
- IP/device data;
- transaction timing;
- behavioral similarity;
- admin/operator guess.

That would create false-positive exclusion risk. A future optional cryptographic wallet-linking feature can merge addresses only when the controller of each address explicitly signs the relationship. V1 remains address-based and openly documents residual Sybil risk.

## 4. Census snapshot schema

A future `Ccff00CommunityCensusV1` should be deterministic and hash-bound.

```text
schemaVersion: 1
chainId: 4663
snapshotBlock
snapshotBlockHash
collection
collectionRuntimeHash
publicMinted
rows[]:
  tokenId
  currentOwner
  tokenBoundAccount
  activated
  accountRuntimeHash | null
ownerGroups[]:
  owner
  tokenIds[]
  tokenBoundAccounts[]
summary:
  uniqueCurrentOwners
  exactly1
  exactly2
  exactly3
  exactly4
  fivePlus
  maxSquaresPerOwner
provenanceCheckpoint
provenanceHash
censusHash
```

Canonicalize token IDs numerically and addresses by checksummed value with lowercase only for hash/sort normalization. No duplicate token ID or duplicate canonical TBA is admitted. Chain, snapshot block identity, collection runtime identity, registry, implementation and salt must fail closed exactly as the existing CCFF00 adapter does.

## 5. Persistent fairness state

The census is a snapshot; fairness state persists between snapshots once execution is authorized.

### Seat state

Key: current owner address.

```text
serviceLevel
firstSeenBlock
lastSeenBlock
active
lastAllocationBatch
```

`serviceLevel` increments only after a confirmed NFT delivery for that seat.

If an address leaves the community, preserve its history but mark the seat inactive. If it later re-enters, use:

```text
serviceLevel = max(previousServiceLevel, currentCommunityFloor)
```

so leaving/rejoining cannot create retroactive catch-up rights.

### New owner entry

A first-time owner enters at the current community floor:

```text
communityFloor = min(serviceLevel of active seats)
```

If no active seats exist, the floor is zero.

A new buyer therefore participates equally going forward but does not receive every historical round retroactively.

### Square delivery state

Key: CCFF00 token ID.

```text
deliveryCount
lastDeliveredBatch
lastDeliveredCollection
```

This state follows the Square as an onchain destination history. It does not create extra owner-seat entitlement.

## 6. Fair allocation invariant

At allocation time:

1. take a finalized admitted census;
2. load active seats;
3. compute `communityFloor`;
4. only seats with `serviceLevel == communityFloor` are eligible;
5. if inventory exceeds that cohort, serve the entire cohort once, increment confirmed seats, recompute the new floor, and continue with remaining inventory;
6. no seat may receive allocation `N+1` while another active seat is still waiting at `N`.

ETH contribution amount, RMT balance, number of Squares and wallet value are **not inputs** to seat weighting.

## 7. Randomness and reproducibility

### 7.1 Never use operator-controlled randomness

Production allocation must not depend on:

- `Math.random()`;
- server timestamps;
- an operator-supplied seed;
- a same-block hash chosen after inventory is known;
- a mutable database shuffle with no public commitment.

### 7.2 Commit before randomness exists

For every allocation batch:

1. reconcile the complete acquired inventory for the mint run;
2. canonical-sort inventory by `(collection, tokenId)` before hashing;
3. freeze the admitted census hash;
4. create `inventoryHash` and `batchCommitment`;
5. record a predetermined **future** randomness round/source while its output is still unknown;
6. publish/persist the commitment;
7. after the randomness becomes available, derive the deterministic seed;
8. compute assignments;
9. persist `allocationResultHash` before distribution begins.

Recommended generic derivation:

```text
seed = keccak256(
  DOMAIN_CCFF00_ALLOCATION_V1 ||
  chainId ||
  censusHash ||
  inventoryHash ||
  randomnessSourceId ||
  randomnessRound ||
  randomnessBytes
)
```

The first adapter candidate is a publicly verifiable future drand beacon round because the operator can precommit a round before its randomness exists. Keep the randomness source behind an adapter so an independently admitted Robinhood-native VRF can replace/add to it later.

### 7.3 Deterministic unbiased shuffle

Implement Fisher-Yates using keccak-derived 256-bit words and rejection sampling for each bounded index; do not use `word % bound` without rejection handling. Domain-separate recipient shuffle, inventory shuffle and per-owner Square tie-breaks.

Anyone with the census manifest, inventory manifest, randomness record and algorithm version must reproduce the exact assignments.

## 8. NFT/project diversity without value prediction

After recipient order and inventory order are independently randomized:

- prefer an NFT from a collection the selected seat has not previously received;
- if every remaining item is a repeated collection for that seat, take the next randomized item;
- never use floor price, rarity estimate, token price, marketplace bid, social momentum or operator preference in this selection.

A deterministic implementation can scan the shuffled remaining inventory for the first non-duplicate collection for the selected seat; if none exists, use the first remaining item. The rule and result must be hash-bound.

The engine makes no representation that two distributed NFTs have equal market value. Fairness means equal service opportunity and blind assignment, not equal financial outcome.

## 9. Selecting the destination Square

After a seat is selected:

1. obtain its currently held admitted Squares from the same census;
2. compute the minimum `deliveryCount` among those Squares;
3. restrict to Squares at that minimum;
4. use a domain-separated deterministic random tie-break;
5. resolve the canonical TBA from the census;
6. activate the canonical TBA if admission policy permits and the account is not yet deployed;
7. deliver only after the CCFF00 NFT-receipt/withdrawal canary has proven the exact deployed account behavior.

Owning more Squares therefore creates more possible destination wallets but not more seat-level allocation weight.

## 10. Acquisition discovery

Discovery adapters may propose candidates; they never authorize execution.

### Candidate sources

- OpenSea Drops API, if a live Robinhood capability probe passes;
- explicit operator `WATCH PROJECT` input (OpenSea URL, mint URL, collection/mint contract address and optional known whitelist information);
- admitted onchain/explorer discovery adapters added later.

OpenSea currently exposes APIs to list drops and build ready-to-sign mint transaction data containing target, calldata and native `value`. Provider output remains advisory until locally verified.

### Watch-project semantics

A watch record may contain:

```text
source URL(s)
expected collection/mint contract
expected stage window
expected zero-price stage
expected collector allowlist status
optional collector-specific Merkle proof/data
notes/source evidence
```

`WATCH PROJECT` means **prioritize observation**, never “execute regardless of policy.” A watched project failing safety checks is rejected exactly like an automatically discovered project.

## 11. Allowlist/whitelist behavior

### Collector-address allowlist

Ideal case: a project allowlists the dedicated CCFF00 Community Collector address for a quantity. The engine verifies eligibility, stage, quantity, zero price and exact proof before minting.

### Individual holder allowlist

If a project allowlists each holder EOA rather than the collector, the centralized collector cannot impersonate those addresses. Automatic centralized minting is allowed only if the mint protocol explicitly supports a valid delegated payer/recipient/gift/relayer mechanism whose authorization is verified.

The engine does not create burner wallets or bypass creator wallet limits.

## 12. Mint adapter model

Automation is adapter-bound.

A mint adapter pins:

- admitted chain;
- target/proxy/implementation identity requirements;
- accepted function selector(s);
- ABI decoding rules;
- quantity field semantics;
- recipient semantics;
- allowlist proof semantics if applicable;
- expected native value behavior;
- expected receipt events;
- exact postconditions.

Start with the smallest well-understood ERC-721 mint surfaces. Unknown custom contracts remain observe-only until a new adapter is reviewed and tested.

ERC-1155 can be added behind a separate adapter/canary after ERC-721 is proven.

## 13. Free-mint safety policy

Automatic acquisition requires all applicable conditions to pass immediately before signing:

```text
chainId == 4663
target has code
target/proxy implementation identity is admitted
selector/adapter is admitted
mint native value == 0
quantity <= creator/project wallet limit
quantity <= local per-run cap
stage is currently active
allowlist proof/eligibility is exact when required
collector has no unrelated token approvals
collector has no RMT/CCFF00/user assets
exact transaction simulation succeeds
estimated gas <= per-transaction cap
project/run gas <= per-run cap
daily gas budget remains available
expected mint receipt/postconditions are known
engine state == RUNNING
```

Do not architect around Alchemy's legacy Transaction Simulation API because its documentation currently announces deprecation on 2026-09-30. Prefer existing RMT/viem simulation plus fork rehearsal and provider-neutral `eth_call`/gas-estimation/trace capabilities where available.

### Transaction postconditions

After confirmation:

- status must be success;
- exact expected NFT creation/transfer events must exist;
- acquired quantity must equal the intended quantity or the run fails reconciliation;
- collector ownership/balance must match the acquired inventory;
- no unexpected ETH value transfer beyond network gas is accepted;
- no unrelated asset delta is accepted.

Never infer acquired token IDs from sequential numbering alone; parse receipt events and verify ownership/balances.

## 14. Quality/provenance gate

Security and quality are separate decisions.

### Hard safety gate

Binary pass/fail from the mint adapter and transaction evidence.

### Quality/provenance score

Versioned evidence may include:

- verified/known contract provenance;
- creator/project identity evidence;
- Robinhood ecosystem relevance;
- stable metadata/media availability;
- nontrivial unique minter/holder activity;
- watch-list/community provenance;
- obvious copy/spam/abuse indicators.

Do not treat marketplace verification, follower counts or mint velocity as proof of quality. Each is manipulable and may only be one bounded signal.

Initial implementation should run quality scoring in observer mode and record why a candidate would be admitted/rejected. Autonomous quality admission is enabled only after false-positive/false-negative review on real Robinhood examples.

## 15. Collector signer boundary

The production collector must be an isolated address/account created solely for this engine.

It must never be:

- RMT admin wallet;
- RMT treasury/Safe;
- protocol deployer;
- CCFF00 holder wallet;
- general trading wallet.

Target steady state:

```text
ETH: small capped operating balance
RMT: 0
CCFF00: 0
ERC-20 approvals: 0
valuable inventory: 0 except transient acquired NFTs awaiting committed distribution
```

A compromised collector key therefore cannot access protocol/user treasuries. Gas-funding architecture must cap exposure further.

Current `metamask-agent-wallet-preflight.mjs` intentionally does not authorize transaction use. Do not weaken that boundary as a shortcut. A future signer admission is a separate, explicit canary/release task.

## 16. Distribution to CCFF00 TBAs

For each committed assignment:

```text
collector owns NFT
→ canonical selected CCFF00 TBA resolved from admitted census
→ exact transfer simulated
→ transfer submitted
→ receipt reconciled
→ ownerOf(NFT) / ERC-1155 balance proves destination
→ seat serviceLevel increments
→ Square deliveryCount increments
```

Use `safeTransferFrom` only after the exact CCFF00 account implementation has proven ERC-721 receiver compatibility. If it does not implement the safe receiver hook, a tightly bound `transferFrom` route may be admitted only after the canary proves:

- destination is the canonical TBA;
- post-transfer `ownerOf` equals that TBA;
- the current CCFF00 owner can execute the NFT back out of the TBA.

No allocation counter increments before confirmed ownership at the destination.

## 17. Mandatory CCFF00 canary

Before mass NFT distribution, run an external ERC-721 canary against the existing CCFF00 canary IDs already used by RMT (`470`, `471`, `472`), or a later explicitly admitted equivalent set.

For each canary prove:

1. canonical TBA derivation/runtime;
2. account activation if required;
3. external ERC-721 receipt;
4. exact NFT ownership inside the TBA;
5. current Square owner can control the TBA;
6. NFT can be transferred back out under owner control;
7. no CCFF00/RMT balance changed unexpectedly.

Mass delivery remains fail-closed until all admitted canaries pass.

## 18. Engine state machine

```text
STOPPED
  │ START
  ▼
WATCHING
  │ candidate
  ▼
INSPECTING
  ▼
VERIFYING
  ▼
SIMULATING
  ├─ reject → WATCHING
  ▼ pass
WAITING_FOR_STAGE
  ▼
MINTING
  ▼
RECONCILING_ACQUISITION
  ▼
INVENTORY_COMMITTED
  ▼
WAITING_FOR_RANDOMNESS
  ▼
ALLOCATING
  ▼
DISTRIBUTING
  ▼
RECONCILING_DISTRIBUTION
  └────────────→ WATCHING
```

### STOP semantics

`STOP` must be checked at every pre-sign boundary. It prevents any **new** transaction from being signed/submitted.

It cannot cancel an already broadcast blockchain transaction. The system must continue read-only reconciliation for already submitted transactions, persist the final inventory state, then remain paused.

### START semantics

`START` resumes observation and queued work only after re-verifying:

- current chain head/finality;
- candidate stage/eligibility;
- target runtime/implementation identity;
- collector balance/budget;
- idempotency records.

No stale pre-stop transaction plan may be blindly reused.

## 19. Idempotency and durable state

Every acquisition and distribution must have deterministic keys.

Suggested domains:

```text
candidateId = hash(source + collection + mint target + stage identity)
mintRunId = hash(candidateId + collector + quantity + stage + policyVersion)
acquisitionItemId = hash(mintRunId + collection + tokenId)
allocationBatchId = hash(censusHash + inventoryHash + fairnessVersion)
assignmentId = hash(allocationBatchId + seat + squareTokenId + collection + tokenId)
```

A process restart, duplicate webhook, RPC retry or scheduler retry must never mint/distribute twice merely because the previous response was lost.

Use confirmed receipts plus deterministic keys; never treat “request returned an error” as proof a transaction was not submitted.

Persisting this state does not itself authorize a new universal indexer. Start with the narrowest storage already appropriate to the future engine runtime; define a separate service only when implementation authority and operational need are explicit.

## 20. Gas funding

### V1 principle

Anyone may voluntarily send ETH to the future gas-funding address/vault. Contribution amount creates **zero** seat weight, queue priority, rarity preference or project preference.

Funding ledger and allocation engine are separate modules with no shared weighting field.

### Future gas vault candidate

Only after collector canaries justify it, consider an immutable-purpose `CCFF00CollectorGasVaultV1` with:

- ETH receive/deposit only;
- fixed/admitted collector destination;
- no arbitrary recipient;
- bounded refill amount;
- bounded refill per epoch/day;
- public accounting events;
- emergency pause under admitted governance;
- no connection to allocation rights.

The exact contract is not approved by this planning document.

### Terminal revenue later

Do **not** change `RMT_EXECUTION_V1` or existing revenue policy now. After the collector has a proven operating history, RMT operations/treasury may voluntarily fund the gas vault or a separately reviewed versioned revenue policy may allocate a defined amount. That is a new economics decision, not an implication of this architecture.

## 21. External infrastructure references and admission posture

Verified as planning inputs on 2026-08-21; each still requires a live capability probe at implementation time.

- Robinhood Chain documents first-class ERC-4337 account abstraction, gas sponsorship, batching and session-key support: `https://docs.robinhood.com/chain/`
- Alchemy currently lists Robinhood Mainnet/Testnet with Bundler, Gas Sponsorship and ERC-20 Gas Payments support: `https://www.alchemy.com/docs/wallets/supported-chains`
- OpenSea Drops API can list drops and build mint transactions with explicit minter/quantity and returned target/calldata/value: `https://docs.opensea.io/docs/mint-from-a-drop`
- OpenSea mint transaction endpoint: `https://docs.opensea.io/reference/build_drop_mint_transaction`
- OpenSea drop listing endpoint: `https://docs.opensea.io/reference/get_drops`

Provider support can change; live probes are part of admission and provider failure must fail closed or degrade to observer mode.

## 22. What V1 deliberately does not solve

- proving two unrelated addresses are one human;
- guaranteeing equal financial value of distributed NFTs;
- guaranteeing any free mint has future value;
- bypassing creator allowlist/per-wallet rules;
- arbitrary custom-contract auto-minting;
- automatic sale of acquired NFTs;
- staking or yield generation from community assets;
- RMT-to-ETH market selling for gas;
- changing RMT supply semantics;
- changing current terminal fee economics.

## 23. Release gates

Implementation remains sequential:

1. read-only live census;
2. read-only mint provenance artifact;
3. observer-only mint discovery/evidence;
4. deterministic fairness simulator;
5. external ERC-721 CCFF00 receipt/withdrawal canary;
6. isolated low-balance collector canary;
7. limited production acquisition/distribution with explicit owner authorization;
8. gas vault only after operational evidence;
9. RMT Pay compatibility preflight;
10. RMT Pay utility activation only after separate authorization.

No later gate inherits approval from an earlier gate.
