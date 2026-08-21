# OpenAI Codex handoff — CCFF00 Community Engine

**Status:** FUTURE HANDOFF — DO NOT START RUNTIME WORK YET  
**Planning branch:** `planning/ccff00-community-engine-v1`

This document is the clean handoff for OpenAI Codex after the owner says the current RMT terminal-completion lane is finished and explicitly opens the CCFF00 Community Engine project.

## 0. Non-negotiable handoff rules

Before writing code, Codex must:

1. fetch the latest `main`;
2. read current `AGENTS.md`, `docs/ARCHITECTURE_FREEZE.md`, `docs/ACTIVE_SYSTEM_MAP.md`, and `docs/TERMINAL_COMPLETION_GATE.md`;
3. verify the owner has explicitly authorized this project to leave planning-only status;
4. fetch/read the planning documents from `origin/planning/ccff00-community-engine-v1`;
5. inspect all open/recent PRs and active branches that touch the intended files;
6. create a **new bounded branch from latest `main`** for the first implementation tranche;
7. never use this planning branch as a stale runtime base;
8. preserve existing VNext, execution, fee, funding, distribution and CCFF00 behavior unless the current bounded task explicitly requires a reviewed change.

Each work package below is a separate review boundary. Passing one package does not authorize the next.

No Codex task may merge its own PR, deploy a contract, mutate production environment variables, enable a signer/worker/provider/fee, spend mainnet ETH, or move treasury/community funds unless that exact action is separately authorized.

## 1. Package A — read-only CCFF00 Community Census

### Goal

Produce the exact live number of current community seats from the canonical public CCFF00 supply.

### Required behavior

Reuse `apps/web/lib/vnext/distribution-ccff00.ts` rather than creating another holder resolver.

At one pinned admitted Robinhood block:

- read canonical `publicMinted`;
- enumerate only the admitted public token IDs;
- read `ownerOf(tokenId)` and canonical `getTokenBoundAccount(tokenId)` at the same block;
- retain activation/runtime evidence already provided by the CCFF00 adapter;
- group rows by current owner address;
- produce deterministic `Ccff00CommunityCensusV1` evidence and hash.

Summary must report:

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
snapshotBlock
snapshotBlockHash
censusHash
```

### Identity invariant

```text
one current owner address holding >= 1 admitted public CCFF00 = one seat
```

A current owner holding 3 Squares must produce one seat containing 3 token IDs/TBAs.

### Fail-closed tests

Cover at least:

- one wallet holding multiple Squares collapses to one seat;
- three Squares held by one wallet = one seat;
- transfer to a buyer changes the current-owner grouping;
- reserve/project IDs cannot create V1 seats;
- duplicate token ID fails;
- duplicate canonical TBA fails;
- wrong chain fails;
- inconsistent block identity fails;
- incorrect collection/registry/implementation/salt/runtime evidence fails;
- census hash is deterministic under canonical input ordering.

### Deliverables

Prefer additions under existing VNext CCFF00 domain and a read-only script, for example only if consistent with current repository structure:

```text
apps/web/lib/vnext/ccff00-community-census.ts
apps/web/lib/vnext/ccff00-community-census-smoke.ts
apps/web/scripts/vnext-ccff00-community-census.ts
```

Do not add a database, signer, worker, API route or UI in this package.

### Stop condition

Report exact files/tests and live census numbers if RPC access is available. Stop. Do not continue to provenance/discovery automatically.

---

## 2. Package B — read-only original mint provenance

### Goal

Quantify how many original recipient addresses received multiple public Squares without treating that history as current entitlement.

### Architecture boundary

Do **not** extend `apps/indexer`; repository authority reserves it for deployed V6 compatibility/history.

At current scale, implement a bounded CCFF00-specific read-only log reader/artifact.

### Required evidence

Read canonical ERC-721 `Transfer` logs scoped to the exact CCFF00 collection where:

```text
from == 0x0000000000000000000000000000000000000000
```

For every admitted public token ID record:

```text
tokenId
initialRecipient
transactionHash
blockNumber
blockHash
transactionIndex when available
logIndex
```

Use an independently verified collection deployment/start boundary. Do not silently scan from an arbitrary guessed block.

### Summary

```text
uniqueOriginalRecipients
originalRecipientsWithExactly1
originalRecipientsWithExactly2
originalRecipientsWithExactly3
originalRecipientsWithExactly4
originalRecipientsWith5Plus
maxOriginalRecipientCount
provenanceHash
```

### Critical rule

Original mint clustering is analytics only. It cannot override the current-owner seat census.

No wallet-behavior/funding heuristics may merge unrelated addresses.

### Stop condition

Produce the deterministic artifact and tests. Stop.

---

## 3. Package C — Observer Mode NFT discovery

### Goal

Find free Robinhood NFT mint candidates without any transaction capability.

### Sources

Implement adapters, not a hard dependency:

1. live OpenSea Drops API capability probe;
2. operator `WATCH PROJECT` input;
3. optional explorer/onchain enrichment only when bounded and useful.

### OpenSea admission

Verify live support at implementation time. Do not assume the provider's chain enum still includes Robinhood merely because this planning document says it was available/relevant in August 2026.

A provider candidate must be normalized into internal evidence containing at least:

```text
source
collection
mintTarget
stage identity
start/end
mint price/value
max per wallet when known
supply/remaining when known
required proof/eligibility data when known
provider evidence timestamp/hash
```

### WATCH PROJECT

Input can be a URL/address plus optional known whitelist/stage information. It creates priority observation only. It can never override hard safety policy.

### Hard boundary

```text
NO PRIVATE KEY
NO SIGNER
NO WALLET SUBMISSION
NO MINT
NO GAS SPEND
```

### Output

For each candidate print/store a deterministic observer decision:

```text
WOULD_INSPECT
WOULD_REJECT
PROVIDER_UNAVAILABLE
UNKNOWN_ADAPTER
```

and explicit reasons.

Stop after real Robinhood examples are captured.

---

## 4. Package D — ERC-721 mint safety/admission engine

### Goal

Turn an observed free-mint candidate into a locally verified execution plan while keeping transaction submission disabled.

### V1 scope

Start with ERC-721 and the smallest known mint adapter(s). Unknown/custom selectors remain observe-only.

### Required hard checks

- `chainId == 4663`;
- target code exists;
- proxy/implementation/runtime identity meets adapter policy;
- exact selector/ABI semantics are admitted;
- exact native mint `value == 0`;
- quantity respects creator wallet limit and local policy cap;
- allowlist proof/eligibility is exact when required;
- collector model has no unrelated token approvals/assets;
- exact transaction simulation succeeds;
- gas estimate is within policy;
- receipt/postconditions are defined before any signer can later use the plan.

Use provider-neutral viem/RPC/fork patterns. Do not build a new dependency on Alchemy's legacy Transaction Simulation API because its docs announced deprecation for 2026-09-30.

### Plan binding

Hash-bind target, calldata, value, quantity, collection, stage, runtime/implementation evidence, expiration and policy version. A stale plan cannot be signed later without re-verification.

### Stop condition

No signer. Produce adversarial tests and `WOULD_MINT` plans for known-safe fixtures/live-observed candidates only. Stop.

---

## 5. Package E — deterministic Fair Allocation V1 simulator

### Goal

Prove fairness and randomness independently of mint execution.

### Inputs

```text
Ccff00CommunityCensusV1
persistent seat service levels
persistent Square delivery counts
synthetic/acquired inventory manifest
future randomness record
prior collection-receipt history
```

### Required invariant

No active seat may receive service level `N+1` while another active seat remains at `N`.

### New holder rule

New addresses enter at the current active community floor, not zero-history catch-up.

### Re-entry rule

`max(previousServiceLevel, currentCommunityFloor)`.

### Square rule

After selecting a seat, choose among that owner's currently held Squares with the minimum delivery count. Use deterministic randomness only to break ties.

### Project diversity rule

Prefer a remaining NFT from a collection the selected seat has not already received; do not use price/rarity/hype.

### Randomness

Implement a provider interface and a test adapter. The first public production candidate can be future-precommitted drand randomness, but the algorithm must not hard-code one provider.

Use canonical sorting + Fisher-Yates + rejection sampling + domain-separated keccak words. Publish reproducibility vectors.

### Adversarial simulation

Run large deterministic simulations covering:

- one seat with 1 Square vs one seat with 10 Squares;
- partial inventories smaller than seat count;
- inventory larger than seat count;
- owner entry/exit/re-entry;
- Square transfers;
- duplicate projects;
- randomness replay;
- altered inventory/census/randomness commitment;
- contribution data present but proven to have zero allocation effect.

Stop when fairness properties are mechanically demonstrated.

---

## 6. Package F — CCFF00 external ERC-721 receipt/withdrawal canary harness

### Goal

Prove the exact deployed CCFF00 TBA can safely hold and release a third-party ERC-721.

### Initial mode

Build harness/tests first. No live transaction until separately authorized.

### Canary proof requirements

For admitted canary token IDs (currently RMT uses `470`, `471`, `472`, subject to re-verification):

- exact canonical TBA;
- exact account runtime;
- activation path when needed;
- third-party ERC-721 receipt;
- `ownerOf` postcondition;
- current CCFF00 owner control;
- NFT withdrawal back out;
- CCFF00/RMT balances unchanged unexpectedly.

Determine empirically whether the exact implementation supports ERC-721 safe receiver hooks. Do not assume `safeTransferFrom` is valid. If only ordinary `transferFrom` is viable, admit it only with exact canonical-destination and withdrawal postconditions.

Stop before mass distribution.

---

## 7. Package G — isolated collector signer preflight and one-mint canary

**Requires separate owner authorization and explicit tiny gas budget.**

### Signer boundary

Create/admit a dedicated collector only. Never use:

- admin wallet;
- treasury/Safe;
- deployer;
- holder wallet;
- trading wallet.

Target balance profile:

```text
small capped ETH
0 RMT
0 CCFF00
0 unrelated ERC-20 approvals
0 persistent valuable inventory
```

Current MetaMask Agent Wallet transaction authorization remains disabled unless independently reviewed; do not weaken existing preflight as a shortcut.

### Canary

One approved zero-price NFT mint only, followed by exact receipt reconciliation. Distribution is a separate signed action/canary.

Stop and report gas, calldata/value, receipt, inventory and all postconditions.

---

## 8. Package H — limited Community Engine runtime

**Requires separate owner authorization after successful canaries.**

### Service ownership

Do not hide execution in `apps/market-indexer` or V6 `apps/indexer`. Repository authority says future execution workers are a separate explicit domain.

Before adding a new worker/service, propose the smallest service ownership and get the architecture decision recorded. A likely future shape may be a dedicated community-engine worker, but the name/location is not pre-approved by this document.

### Operator controls

Only:

```text
START
STOP
WATCH PROJECT
```

`WATCH PROJECT` cannot bypass safety.

`STOP` prevents new signing but continues read-only reconciliation of already-broadcast transactions.

### Durable states

At minimum persist deterministic candidate/mint-run/inventory/allocation/assignment identities so restart/retry cannot duplicate minting or delivery.

### Initial production caps

Hard-code/configure separately reviewed caps for:

- mint quantity per run;
- gas per transaction;
- gas per mint run;
- gas per day;
- maximum pending inventory;
- allowed adapters.

No autonomous contract-adapter expansion.

Stop after a deliberately small production canary window.

---

## 9. Package I — community gas funding vault design

Do not start this contract before the collector runtime has evidence that a vault is actually needed.

Candidate properties:

```text
accept ETH from anyone
fixed/admitted collector destination
no arbitrary recipient
bounded refill
bounded refill per epoch/day
public accounting events
emergency pause under admitted governance
no allocation entitlement linkage
```

No depositor receives extra NFT odds/priority.

Do not change current terminal revenue policy. Any future terminal-revenue funding is a separate economics/release decision.

Contract work requires normal Foundry/adversarial/security/deployment gates and no deployment without explicit authorization.

---

## 10. Package J — RMT Pay compatibility preflight

Do not redeploy RMT.

### Goal

Prove whether current RMT held in a wallet or CCFF00 TBA can be used for an approved utility while gas is sponsored separately and the RMT ends at:

```text
0x000000000000000000000000000000000000dEaD
```

### Must prove

- exact deployed RMT identity/runtime;
- ordinary RMT transfer/approval path works;
- dead-address payment causes no DEX interaction;
- exact CCFF00 TBA owner can authorize RMT movement;
- selected Robinhood AA/gas-sponsorship rail works on the exact chain/account setup;
- zero-native-ETH user experience on an admitted test path;
- burn + purchased onchain utility can be atomic;
- exact source/dead balance deltas;
- exact allowance cleanup if an approval-based pattern is used;
- no RMT sale/conversion;
- no token migration requirement.

Alchemy can be tested as a sponsorship/AA provider, but standard Alchemy ERC-20 gas settlement is not automatically the selected RMT settlement because RMT Pay V1 wants tokens at the dead address, not an application-controlled settlement wallet.

Stop after compatibility evidence. No public RMT Pay UI/activation.

---

## 11. Package K — RMT Pay V1 utility implementation

**Requires separate owner economics/product authorization.**

Implement only exact admitted utilities with versioned RMT burn amounts/pricing policy.

Preferred V1 economics:

```text
RMT protocol utility payment → dead address
native gas → separate sponsored gas budget
NO RMT → ETH swap
```

For onchain paid utility, require burn + utility success atomically where possible. Because dead-address RMT cannot be refunded, do not enable a “burn first, utility later” flow without a separately proven reconciliation design.

Public accounting must distinguish nominal `totalSupply`, dead-address burn balance, legacy retirement-sink balance and effective circulating supply.

---

# Master first-task prompt for Codex

Use this only after the owner explicitly opens the project:

```text
Work only on Package A: read-only CCFF00 Community Census.

Repository: LandoCrissian/robinhood-meme-terminal

Before editing:
1. fetch latest main;
2. read AGENTS.md, docs/ARCHITECTURE_FREEZE.md, docs/ACTIVE_SYSTEM_MAP.md, docs/TERMINAL_COMPLETION_GATE.md;
3. fetch and read origin/planning/ccff00-community-engine-v1/docs/ccff00-community-engine/README.md and ARCHITECTURE_V1.md;
4. inspect current CCFF00/distribution code and current open/recent PR overlap;
5. create a fresh bounded branch from latest main.

Implement ONLY the read-only Community Census described in Package A.

Hard boundaries:
- no signer/private key;
- no transactions;
- no mint discovery;
- no NFT execution;
- no gas vault;
- no RMT Pay;
- no database/service unless demonstrably required for this read-only census;
- do not modify apps/indexer for CCFF00 data;
- no UI;
- no production env change;
- no deployment;
- no merge.

Reuse distribution-ccff00.ts and canonical VNext hashing/fail-closed patterns.

At completion report:
- exact branch/base/head;
- exact files changed;
- focused tests and results;
- typecheck/relevant release checks;
- live census numbers if RPC access permits;
- blockers/unknowns;
- recommended Package B next step.

Stop after Package A.
```

## Final handoff principle

The project is intentionally decomposed so Codex never has to hold the entire system in one unbounded task. Each tranche begins from current `main`, proves one primitive, and stops for review. The Community Engine should become autonomous **only after** its inputs, safety policy, fairness algorithm, CCFF00 custody path and signer boundary have each been independently demonstrated.
