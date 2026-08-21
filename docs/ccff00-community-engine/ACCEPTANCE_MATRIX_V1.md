# CCFF00 Community Engine acceptance matrix V1

**Status:** PLANNING ONLY — FUTURE OPENAI CODEX ACCEPTANCE AUTHORITY  
**Purpose:** remove ambiguity about when each bounded package is complete and when it must stop.

This matrix is subordinate to current repository authority and explicit owner decisions. A package passing its acceptance criteria does not authorize the next package, deployment, mainnet spend, signer enablement, production worker, RMT economics change or merge.

## 1. Global rules for every future Codex package

Every package must begin by:

1. fetching latest `main`;
2. reading current `AGENTS.md`, `docs/ARCHITECTURE_FREEZE.md`, `docs/ACTIVE_SYSTEM_MAP.md`, `docs/TERMINAL_COMPLETION_GATE.md`;
3. reading all current files under `docs/ccff00-community-engine/`;
4. checking recent/open PR overlap for intended paths;
5. creating a fresh bounded branch from latest `main`;
6. recording exact base SHA before edits;
7. preserving all production gates unless explicitly authorized otherwise.

Every package must end with:

- exact base/head SHA;
- exact files changed;
- focused tests and results;
- relevant typecheck/build/release/security checks;
- live evidence hashes/blocks when applicable;
- unresolved blockers;
- next-package recommendation;
- explicit STOP without continuing automatically.

## 2. Global forbidden shortcuts

Unless the exact package explicitly authorizes the action, Codex must not:

- use an admin/treasury/deployer wallet as collector;
- introduce a private key;
- sign or broadcast a transaction;
- deploy a contract;
- change production environment variables;
- enable a worker/cron;
- create a second terminal architecture;
- extend `apps/indexer` with CCFF00/community data;
- hide execution inside `apps/market-indexer`;
- modify `RMT_EXECUTION_V1` economics;
- route RMT through a DEX for gas;
- auto-merge or self-merge a PR;
- treat provider data as final execution authority;
- infer same-human identity across unrelated wallets.

## 3. Package A — read-only CCFF00 Community Census

### Inputs

- canonical current CCFF00 adapter;
- Robinhood Chain RPC;
- one pinned admitted block.

### Required outputs

`Ccff00CommunityCensusV1` containing at least:

```text
schemaVersion
chainId
snapshotBlock
snapshotBlockHash
collection
collectionRuntimeHash
publicMinted
rows[]
ownerGroups[]
summary
censusHash
```

### Required summary

```text
publicMinted
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

### Required tests

- current owner with one Square => one seat;
- current owner with three Squares => one seat containing three token IDs;
- two independent owners => two seats;
- transferred Square changes current-owner grouping;
- founder/project reserve ID is rejected/excluded;
- duplicate token ID fails;
- duplicate canonical TBA fails;
- wrong chain fails;
- wrong block hash fails;
- wrong collection runtime fails;
- wrong registry/implementation/salt fails;
- canonical ordering produces stable hash;
- input row order permutation cannot change census hash.

### Required CI/repo checks

At minimum:

```text
focused new smoke tests
existing distribution-ccff00 smoke/readiness
pnpm --filter web typecheck
```

If changed code participates in terminal release lane, run the affected existing release checks required by current repo authority.

### Forbidden in Package A

- no logs/provenance scanning;
- no database;
- no API route;
- no UI;
- no NFT provider;
- no signer;
- no transaction.

### Pass condition

The tool can produce one deterministic current-owner census from a pinned live block, and all fail-closed tests pass.

### Stop condition

Return census metrics and stop.

---

## 4. Package B — original mint provenance

### Inputs

- exact CCFF00 collection;
- independently verified deployment/start block;
- finalized ERC-721 Transfer logs.

### Required outputs

`Ccff00MintProvenanceV1`:

```text
schemaVersion
chainId
collection
collectionStartBlock
throughBlock
throughBlockHash
rows[]:
  tokenId
  initialRecipient
  transactionHash
  blockNumber
  blockHash
  transactionIndex|null
  logIndex
summary
provenanceHash
```

### Required tests

- only `Transfer(from=zero)` counts as mint provenance;
- transfer between users never changes initial recipient;
- duplicate mint provenance for same token ID fails;
- public range filtering is exact;
- reserve IDs do not become public community provenance rows unless separately requested for analytics;
- wrong collection fails;
- wrong start boundary fails;
- reorged/noncanonical block evidence fails;
- canonical ordering/hash deterministic;
- historical original minter never overrides current census entitlement.

### Required live evidence

- exact scanned block range;
- exact event count;
- exact unique original recipients;
- 1/2/3/4/5+ original recipient distribution;
- maximum original receipt count.

### Forbidden

- no current-seat modification;
- no wallet heuristics;
- no database service;
- no signer.

### Pass condition

Every admitted public token ID has exactly one canonical initial recipient or a clearly reported blocker.

### Stop condition

Publish/report deterministic artifact and stop.

---

## 5. Package C — Observer Mode discovery

### Inputs

- OpenSea Drops capability probe;
- optional operator WATCH input;
- explorer/onchain enrichment adapters.

### Required normalized candidate schema

```text
candidateId
source
chainId
collection
mintTarget
stageId
startTime
endTime
mintValueAtomic
maxPerWallet|null
remaining|null
allowlistMode
providerEvidenceHash
observedAt
status
reasons[]
```

### Required statuses

```text
WOULD_INSPECT
WOULD_REJECT
UNKNOWN_ADAPTER
PROVIDER_UNAVAILABLE
NOT_ACTIVE
NOT_FREE
```

### Required tests

- duplicate provider/watch discovery deduplicates to same candidate identity;
- WATCH input cannot force approval;
- nonzero-price candidate rejected;
- wrong chain rejected;
- malformed URL/address rejected;
- provider timeout degrades to observer error, not execution;
- stale stage identified;
- unknown custom selector remains unknown/observe-only.

### Forbidden

```text
NO PRIVATE KEY
NO SIGNER
NO BROADCAST
NO GAS
```

### Pass condition

Observer identifies real Robinhood candidates and explains exactly why each would proceed or stop.

### Stop condition

Capture examples and stop.

---

## 6. Package D — mint admission/safety plan

### Inputs

- normalized candidate;
- admitted mint adapter;
- current chain/runtime evidence;
- modeled collector address/balance policy.

### Required plan fields

```text
planVersion
chainId
candidateId
collection
collectionRuntimeHash
mintTarget
mintTargetRuntimeHash
proxyImplementation|null
proxyImplementationRuntimeHash|null
selector
calldataHash
nativeValueAtomic
quantity
stageIdentityHash
eligibilityEvidenceHash|null
validFrom
expiresAt
estimatedGas
policyVersion
planHash
```

### Required hard checks

- exact chain 4663;
- exact native value zero;
- target code exists;
- admitted selector;
- decoded quantity exact;
- decoded recipient/minter semantics exact;
- current stage active;
- creator max-per-wallet respected;
- local max quantity respected;
- allowlist proof binds correct minter/payer when applicable;
- collector contains no forbidden assets/approvals;
- exact simulation passes;
- gas within limits;
- expected receipt events/postconditions defined.

### Required adversarial tests

- provider target substitution;
- calldata selector substitution;
- quantity tampering;
- native value tampering;
- stage expiration;
- implementation upgrade after plan;
- proof for another address;
- repeated/used signed-mint proof where applicable;
- gas estimate above cap;
- unexpected approval requirement;
- malformed receipt expectations;
- plan replay after expiry.

### Forbidden

No signer or broadcast.

### Pass condition

Known-safe fixture produces `WOULD_MINT` plan; every mutated field invalidates or changes the plan hash and/or fails admission.

### Stop condition

Report plans and stop.

---

## 7. Package E — Fair Allocation V1

### Inputs

- census;
- seat fairness state;
- Square delivery state;
- inventory manifest;
- prior collection history;
- verified/test randomness record.

### Required properties

P1. **Seat equality**

```text
seatWeight(owner) == 1
```

regardless of Square count.

P2. **Least-served-first**

No seat receives next service while another active seat has a lower service level.

P3. **Contribution neutrality**

Changing ETH contribution data cannot change output.

P4. **Value blindness**

No price/floor/rarity/hype input exists in the allocation API.

P5. **Square fairness**

Within a selected owner, only Squares at that owner's minimum delivery count are candidates.

P6. **Project diversity**

Prefer a collection not previously received by that seat when possible, using only collection identity/history.

P7. **Determinism**

Same canonical inputs + same verified randomness => exact same result hash.

P8. **Tamper evidence**

Changing census, inventory, fairness state or randomness changes result/commitment and invalidates prior assignments.

### Required simulations

At minimum:

- 2 seats / 1 NFT;
- 2 seats / 3 NFTs;
- 100 seats / 17 NFTs;
- 100 seats / 250 NFTs;
- one owner with 1 Square vs one owner with 10 Squares;
- new owner joins after several rounds;
- owner exits/re-enters;
- Square moves between owners;
- repeated collections dominate inventory;
- every seat has received same project already;
- contribution ledger radically changed;
- randomness replay;
- inventory mutation after commitment;
- simulated 10,000+ allocation steps with property assertions.

### Required randomness tests

- future round committed before bytes known;
- wrong chain hash rejected;
- wrong round rejected;
- invalid signature rejected;
- modulo-bias-free bounded integer generation tested;
- domain separation produces independent recipient/inventory/Square streams.

### Pass condition

Property tests and deterministic vectors pass without any value/contribution/whale weighting.

### Stop condition

No live NFT movement. Stop.

---

## 8. Package F — CCFF00 ERC-721 canary harness

### Required proof sequence

For each admitted canary Square:

1. canonical collection/TBA configuration verified;
2. canonical TBA activated if required;
3. external ERC-721 moved into TBA;
4. post-transfer NFT owner exactly TBA;
5. current CCFF00 owner proven to control TBA;
6. NFT moved back out under owner control;
7. no unexpected CCFF00/RMT balance delta;
8. all transaction/receipt/runtime evidence hash-bound.

### Required test modes

- local/fork harness before live canary;
- safe receiver supported path if applicable;
- ordinary transfer fallback only if exact implementation requires it;
- wrong TBA rejected;
- wrong owner rejected;
- wrong NFT rejected;
- unexpected callback/transfer behavior rejected.

### Forbidden

No mass distribution.

### Pass condition

Exact deployed account behavior is mechanically proven.

### Stop condition

Return canary evidence and stop.

---

## 9. Package G — isolated collector canary

### Authorization prerequisite

Separate owner approval + exact tiny gas budget.

### Preflight must prove

```text
collector != RMT admin
collector != treasury/Safe
collector != deployer
collector != trading wallet
collector != holder wallet
RMT balance == 0
CCFF00 balance == 0
no forbidden approvals
ETH balance <= approved cap
engine state == approved canary mode
```

### One-mint acceptance

- one admitted zero-price mint;
- exact calldata/value plan;
- pre-sign runtime recheck;
- exact gas budget;
- receipt success;
- acquired token IDs parsed from logs;
- collector ownership reconciled;
- no unrelated balance delta;
- no automatic distribution in same package unless separately authorized.

### Failure acceptance

Any uncertainty => no retry until tx/nonce reconciled.

### Stop condition

Report exact gas/receipt/inventory and stop.

---

## 10. Package H — limited runtime

### Architecture prerequisite

Explicit service-ownership decision. Do not place execution in `apps/indexer` or `apps/market-indexer`.

### Required operator API

```text
START
STOP
WATCH PROJECT
```

No recipient-selection API.
No “force mint” bypass.
No “reroll allocation.”

### Required durable records

```text
candidate
mintRun
transactionAttempt
acquiredInventory
allocationCommitment
randomnessRecord
assignment
deliveryAttempt
fairnessState
operatorState
```

### Required recovery tests

- crash before broadcast;
- crash after broadcast/before response;
- crash after receipt/before DB update;
- crash after allocation commitment;
- crash during partial distribution;
- STOP during each state;
- RPC outage;
- provider outage;
- reorg before finality;
- stale candidate on restart;
- duplicate queue delivery.

### Initial production caps

Must be explicitly reviewed; no implied defaults from this document.

### Pass condition

Small canary window completes with no duplicate mint/distribution and reproducible allocation evidence.

### Stop condition

Do not broaden adapters or caps automatically.

---

## 11. Package I — gas vault

### Prerequisite

Runtime has demonstrated operational need for pooled/refill funding.

### Candidate contract invariants

```text
accept ETH
fixed collector destination
no arbitrary target
bounded refill
bounded time-window spend
public accounting
governance emergency pause only
no allocation weighting
no generic execute/delegatecall
```

### Required tests

- zero deposit rejected if desired by final contract semantics;
- wrong collector impossible;
- over-cap refill rejected;
- epoch/day cap enforced;
- pause blocks release but not accounting;
- reentrancy resisted;
- arbitrary-call surface absent;
- donor address/amount never affects allocation state.

### Forbidden

No automatic change to terminal revenue routing.

### Pass condition

Foundry/adversarial/security gates pass and deployment remains separately authorized.

---

## 12. Package J — RMT Pay compatibility preflight

### Required deployed identity evidence

- exact RMT address;
- exact runtime hash;
- exact chain 4663;
- ordinary `transfer/approve/transferFrom` behavior;
- exact dead address constant.

### Required payment-source evidence

1. normal admitted wallet/account can authorize RMT burn;
2. canonical CCFF00 TBA owner can authorize RMT movement.

### Required gas evidence

- selected sponsorship provider supports exact chain/account path at implementation time;
- user can complete selected test utility with zero user-funded native ETH;
- sponsor pays native gas separately.

### Atomicity requirement

Burn + utility success must be one atomic outcome for any non-refund-capable dead-address payment.

### Required no-sell proof

Test/trace must show no call to admitted DEX/router/pool as part of RMT Pay settlement.

### Required accounting

```text
sourceRmtBefore - sourceRmtAfter == burnAmount
deadBefore + burnAmount == deadAfter
utility postcondition == success
```

If allowance path used:

```text
allowanceAfter == expected zero/exact residual policy
```

### Pass condition

Current RMT works; no token redeployment/migration is required.

### Stop condition

No public RMT Pay activation.

---

## 13. Package K — RMT Pay utility

### Product prerequisite

Separate explicit owner decision on:

- which utilities are payable in RMT;
- exact RMT price or price tier;
- sponsored gas budget/caps;
- public burn/accounting disclosure.

### Required policy binding

```text
policyVersion
chainId
utilityId
targets
selectors
burnDestination
burnAmount|maxBurnAmount
gasCap
validFrom
expiry
simulationRequirement
policyHash
```

### Required safety

- burn destination immutable/exact;
- no DEX conversion;
- no treasury settlement;
- no arbitrary contract sponsorship;
- atomic utility outcome;
- exact event/balance reconciliation;
- public metrics truthful about nominal supply vs effective circulation.

### Pass condition

Only explicitly admitted utilities can consume RMT and each successful payment is independently auditable.

---

## 14. Cross-package quality gates

The following should be used whenever relevant to changed files, subject to current repository instructions at implementation time:

```text
focused smoke/unit tests
pnpm --filter web typecheck
pnpm test:terminal-release (when canonical VNext/release paths are affected)
pnpm check:repo
pnpm audit:production
git diff --check
secret scan / gitleaks
Foundry build/test for contract packages
Slither/security gate for new contracts
```

Do not blindly run expensive global lanes when the current repository instructions explicitly prescribe a narrower gate; do not skip a required gate because a package appears small.

## 15. Evidence naming convention

Future artifacts should be explicit and versioned, for example:

```text
CCFF00_COMMUNITY_CENSUS_V1
CCFF00_MINT_PROVENANCE_V1
CCFF00_MINT_CANDIDATE_V1
CCFF00_MINT_PLAN_V1
CCFF00_INVENTORY_MANIFEST_V1
CCFF00_ALLOCATION_COMMITMENT_V1
CCFF00_RANDOMNESS_RECORD_V1
CCFF00_ALLOCATION_RESULT_V1
CCFF00_DELIVERY_RECEIPT_V1
CCFF00_COLLECTOR_PREFLIGHT_V1
RMT_PAY_POLICY_V1
RMT_PAY_RECEIPT_V1
```

Every evidence artifact must contain a schema version and deterministic canonical hash where applicable.

## 16. Owner decision points

Owner approval is explicitly required before:

1. Package G live signer/gas canary;
2. Package H limited production runtime;
3. Package I contract deployment;
4. any terminal revenue funding decision;
5. Package J production-fund use if any;
6. Package K pricing/economics activation;
7. broadening mint adapters beyond separately reviewed surfaces.

Planning, read-only evidence and local/fork tests do not imply those approvals.
