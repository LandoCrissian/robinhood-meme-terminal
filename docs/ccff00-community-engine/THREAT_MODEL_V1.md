# CCFF00 Community Engine threat model V1

**Status:** PLANNING ONLY — FUTURE IMPLEMENTATION INPUT  
**Scope:** CCFF00 census, free-mint acquisition, fair allocation, ERC-6551 delivery, gas funding and RMT Pay boundaries  
**Chain:** Robinhood Chain mainnet (`chainId = 4663`)

This document defines the failure and attacker model Codex must preserve when implementing the Community Engine. It does not authorize runtime work, signing, deployment, gas spending or changes to current RMT economics.

## 1. Security objective

The Community Engine is only useful if it can make a stronger claim than “a bot that mints free NFTs.” The intended claim is:

> The engine can discover and acquire admitted zero-mint-price NFTs with tightly bounded gas exposure, allocate them without operator favoritism, deliver them to canonical CCFF00 token-bound accounts, and recover safely from provider, chain, process and signer failures without creating a path to RMT treasury/user assets.

Security therefore includes four independent properties:

1. **asset safety** — no user/RMT treasury asset exposure;
2. **execution integrity** — only exact admitted zero-value mint/transfer actions execute;
3. **allocation integrity** — contributor status, wealth, operator preference and NFT value do not affect entitlement;
4. **operational integrity** — retry/restart/reorg/provider failures do not duplicate mints, assignments or deliveries.

A failure in any one property is release-blocking.

## 2. Protected assets and invariants

### 2.1 RMT and protocol assets

The collector must never be able to move:

- RMT treasury assets;
- RMT admin/deployer assets;
- arbitrary user assets;
- CCFF00 NFTs owned by holders;
- assets held in unrelated CCFF00 TBAs;
- arbitrary ERC-20 allowances from user wallets.

The collector signer is a distinct low-value execution identity.

### 2.2 Collector ETH

Collector ETH is intentionally exposed to network gas but must be bounded by:

- small operating balance;
- per-transaction gas cap;
- per-run gas cap;
- daily/epoch gas cap;
- maximum pending run count;
- stop/pause state.

Loss of the collector key must not expose more than the admitted operating balance and transient NFT inventory.

### 2.3 Acquired NFTs

An acquired NFT becomes protected inventory immediately after confirmed acquisition.

Once included in an admitted inventory manifest:

- it cannot be silently removed;
- it cannot be reassigned manually;
- it cannot be sold by the engine;
- it cannot be sent to the operator;
- it cannot be replaced with another NFT after randomness is known.

### 2.4 Fairness state

Seat `serviceLevel`, Square `deliveryCount`, allocation commitments and assignment hashes are integrity-critical state.

They must never be derived from:

- ETH contribution amount;
- RMT balance;
- wallet net worth;
- number of Squares owned;
- marketplace value;
- social identity;
- operator preference.

### 2.5 RMT Pay burn path

For future RMT Pay protocol utility:

```text
RMT → 0x000000000000000000000000000000000000dEaD
```

The utility path must not automatically:

- swap RMT for ETH;
- route through a DEX;
- send used RMT to treasury;
- recycle spent RMT;
- report nominal `totalSupply()` as reduced.

## 3. Trust boundaries

### Boundary A — Robinhood Chain RPC

RPC providers are data transports, not truth authorities.

Mitigations:

- exact chain ID checks;
- pinned block number + block hash;
- canonical contract/runtime identity checks;
- independent provider/fork verification for release-critical evidence where practical;
- finalized/admitted confirmation depth before irreversible fairness updates.

### Boundary B — marketplace/drop APIs

OpenSea or another provider may propose a candidate or transaction, but provider output is untrusted until locally decoded and verified.

Provider output must never directly authorize signing.

### Boundary C — explorer/source APIs

Blockscout/explorer metadata can enrich source/proxy/ABI evidence but cannot substitute for:

- `eth_getCode`;
- runtime hash;
- exact calldata decoding;
- simulation;
- receipt reconciliation.

### Boundary D — randomness provider

Randomness is untrusted until:

- source identity is pinned;
- the requested round is committed before output exists;
- the beacon/signature is verified;
- the round/source matches the stored commitment;
- derived seed reproduces locally.

### Boundary E — collector signer

The signer may sign only an exact plan already admitted by the engine. The signer cannot choose target/calldata/value/recipient independently.

### Boundary F — operator controls

Operator input is control-plane data, not execution authority.

`WATCH PROJECT` may increase observation priority but cannot bypass any hard safety condition.

`START` enables eligible work. `STOP` prevents new signing. Neither can rewrite allocations.

### Boundary G — CCFF00 ownership/TBA

Current `ownerOf` and canonical `getTokenBoundAccount` at the admitted snapshot are authoritative for seat/destination membership. Operator-maintained wallet lists are not.

## 4. Attacker classes

The implementation must assume at least the following attackers:

1. malicious NFT project creator;
2. compromised or malicious marketplace/drop API;
3. compromised RPC endpoint;
4. compromised collector signer;
5. malicious gas donor;
6. Sybil holder using multiple current addresses;
7. whale holding many Squares in one address;
8. operator/admin making an accidental or malicious input;
9. malicious NFT receiver/callback behavior;
10. malicious proxy implementation upgrade by an NFT project;
11. provider outage or stale provider cache;
12. process crash/restart during mint/distribution;
13. chain reorg near acquisition or distribution;
14. attacker front-running or competing for limited mint supply;
15. metadata-host compromise/content replacement;
16. randomness endpoint returning fabricated data;
17. user transferring a Square during a batch;
18. gas-price spike intended to exhaust the community budget;
19. malicious RMT Pay utility target attempting to consume burn without providing utility;
20. UI/accounting bug misrepresenting burned/circulating RMT.

## 5. Threat scenarios and required mitigations

## T01 — provider returns paid mint disguised as free

**Attack:** provider metadata says price is zero but returned transaction contains nonzero native value.

**Required mitigation:** exact transaction `value == 0` at the final pre-sign verification boundary. Any nonzero value is hard reject.

**Failure code:** `MINT_NONZERO_NATIVE_VALUE`.

## T02 — calldata target substitution

**Attack:** provider advertises one collection but returns calldata targeting another contract.

**Required mitigation:** plan binds collection, mint target, selector, decoded arguments and proxy/implementation identity. Target mismatch rejects.

**Failure code:** `MINT_TARGET_MISMATCH`.

## T03 — proxy changes after observation

**Attack:** project upgrades implementation after observer approval.

**Required mitigation:** runtime/implementation evidence is refreshed immediately before signing. A changed codehash invalidates the plan and forces re-admission.

**Failure code:** `MINT_RUNTIME_CHANGED`.

## T04 — malicious arbitrary call hidden in mint adapter

**Attack:** custom selector causes approvals/transfers/unrelated calls.

**Required mitigation:** automation is selector/adapter-bound. Unknown selector remains observe-only. The signer receives no arbitrary-call capability from provider data.

**Failure code:** `MINT_UNKNOWN_ADAPTER`.

## T05 — wallet-limit evasion pressure

**Attack:** project has one-per-wallet limit; engine creates burner wallets to collect more.

**Required mitigation:** one admitted collector identity in V1. No automatic wallet fan-out or burner creation.

**Failure code:** `MINT_CREATOR_LIMIT_REACHED`.

## T06 — individual holder allowlist misuse

**Attack:** collector tries to reuse another holder's Merkle proof or signature.

**Required mitigation:** verify the exact leaf/minter/payer semantics. If proof binds an individual EOA and the protocol lacks an admitted delegation mechanism, centralized execution is impossible and must fail closed.

**Failure code:** `MINT_COLLECTOR_NOT_ELIGIBLE`.

## T07 — gas griefing

**Attack:** malicious project constructs a free mint with pathological gas cost/revert behavior.

**Required mitigation:** simulation + gas estimate + per-tx/per-run/daily caps. Repeated failure increments candidate failure state and stops retries.

**Failure code:** `MINT_GAS_POLICY_EXCEEDED`.

## T08 — collector key compromise

**Attack:** attacker gains signer key.

**Required mitigation:** collector contains only capped ETH and transient NFTs, never protocol/user assets. Future gas vault can refill only a fixed collector under bounded policy. No arbitrary vault recipient.

**Residual risk:** capped ETH/transient inventory may be stolen before STOP is enacted.

## T09 — donor purchases allocation advantage

**Attack:** large ETH contributor expects preferential NFT allocation.

**Required mitigation:** funding ledger has no allocation-weight field. Tests must prove adding/removing contribution data leaves assignments unchanged for identical census/fairness/randomness/inventory inputs.

**Failure code:** `ALLOCATION_FUNDING_INPUT_PRESENT` if a future allocation API attempts to accept contribution weight.

## T10 — whale gains extra seat weight

**Attack:** wallet holding 10 Squares gets 10 recipient chances.

**Required mitigation:** seat key is current owner address. Multiple Squares are destination candidates only.

**Invariant:** `seatWeight == 1` for every active current owner.

## T11 — cross-wallet Sybil

**Attack:** one human controls several current owner addresses.

**V1 posture:** deliberately unresolved. Do not auto-merge by heuristics. Document residual Sybil risk.

**Future mitigation:** optional cryptographic wallet-linking requires signatures from each linked wallet.

## T12 — original-minter clustering punishes buyers

**Attack/bug:** historical minter address remains entitlement owner after Square sale.

**Required mitigation:** current `ownerOf` snapshot controls eligibility. Original mint provenance is analytics only.

## T13 — stale holder snapshot

**Attack/bug:** allocation uses owners from an earlier block after material transfers.

**Required mitigation:** every allocation batch binds one admitted `censusHash` and snapshot block. Delivery destination is taken from that same census. Before distribution, if policy requires freshness, a newer ownership read may abort/rebuild the batch; never silently substitute a new recipient after randomness without recomputing the commitment.

## T14 — operator cherry-picks valuable NFT

**Attack:** operator removes an NFT after seeing rarity/floor or reruns randomness.

**Required mitigation:** inventory is committed before randomness exists. Allocation seed binds inventory hash + census hash + exact randomness source/round. Any inventory mutation invalidates the result hash.

## T15 — randomness reroll

**Attack:** operator retries beacon rounds until preferred recipients appear.

**Required mitigation:** randomness source and future round are committed before output exists. There is exactly one admitted round for a batch. Failure to obtain/verify it pauses the batch rather than selecting a different round automatically.

**Failure code:** `RANDOMNESS_COMMITMENT_MISMATCH` or `RANDOMNESS_UNAVAILABLE`.

## T16 — forged randomness API response

**Attack:** HTTP endpoint returns fabricated bytes.

**Required mitigation:** locally verify beacon signature/chain identity and expected round. HTTP/TLS alone is insufficient.

## T17 — modulo bias

**Bug:** `word % n` biases Fisher-Yates indices.

**Required mitigation:** rejection sampling for bounded random integers. Publish test vectors.

## T18 — double mint after timeout

**Attack/bug:** submit succeeds but RPC response times out; retry sends second mint.

**Required mitigation:** transaction submission uncertainty enters reconciliation state. Never interpret request error as proof no tx exists. Deterministic `mintRunId`, nonce/tx lookup and receipt reconciliation must complete before retry eligibility.

## T19 — double distribution after restart

**Attack/bug:** process crashes after transfer but before local state update.

**Required mitigation:** assignment is deterministic; on restart verify chain ownership/receipt before submitting. Service level increments only once per confirmed assignment identity.

## T20 — reorg after apparent mint

**Attack/condition:** acquisition receipt is removed by reorg.

**Required mitigation:** no inventory commitment until required confirmation/finality depth is met. If reorg removes an admitted event before commitment, candidate returns to reconciliation. If a later deep reorg affects committed state, engine must STOP and require explicit recovery review.

## T21 — malicious ERC-721 receiver callback

**Attack:** `safeTransferFrom` invokes unexpected callback behavior on destination TBA.

**Required mitigation:** canary proves exact deployed TBA receiver behavior. Distribution path verifies ownership postcondition. If safe receiver support is absent, only a separately admitted tightly bound `transferFrom` path may be used.

## T22 — NFT has nonstandard transfer behavior

**Attack:** token reports success but ownership does not move as expected.

**Required mitigation:** post-transfer `ownerOf`/balance evidence must exactly match destination. Unsupported behavior fails closed.

## T23 — malicious metadata

**Attack:** NFT metadata points to scripts, huge files, local-network URLs, mutable phishing content or malicious media.

**Required mitigation:** metadata/media ingestion is separate from mint execution. Use bounded fetches, content-type/size controls, SSRF-safe URL policy, sanitization and no active script execution. A metadata failure may hide/flag presentation but must not mutate ownership/fairness state.

## T24 — marketplace value affects allocation

**Attack/bug:** floor price/rarity score changes assignment.

**Required mitigation:** value fields are forbidden inputs to allocation function. Quality score is pre-acquisition admission only; once inventory is admitted, assignment ignores value.

## T25 — project diversity rule creates hidden value bias

**Attack/bug:** “avoid duplicate project” accidentally selects by floor/rarity.

**Required mitigation:** diversity rule uses only collection identity and prior receipt history. Within eligible remaining items, selection follows deterministic randomized order.

## T26 — Square transfer during distribution

**Condition:** selected Square changes owner after census but before NFT delivery.

**V1 rule:** assignment is bound to the census and selected Square TBA. The NFT may still be delivered to that Square, and control follows the Square's current owner. This is consistent with “assets belong to the Square.”

**Optional stricter policy:** if ownership freshness is required, re-read owner before signing and abort the whole pending assignment/batch if changed; never silently redirect the NFT to another Square without recomputing allocation evidence.

## T27 — canonical TBA identity changes

**Attack/condition:** collection registry/implementation/salt/configuration changes.

**Required mitigation:** use the existing CCFF00 fail-closed runtime/configuration checks. Any canonical identity change invalidates current admission and stops delivery until reviewed.

## T28 — gas vault drains to arbitrary recipient

**Attack:** governance/compromised caller redirects community ETH.

**Required mitigation for any future vault:** fixed/admitted collector destination, bounded release, no arbitrary recipient, public events, no generic execute/call/delegatecall.

## T29 — terminal revenue automatically redirected without approval

**Attack/bug:** collector assumes current RMT fee revenue can fund itself.

**Required mitigation:** current economics do not imply Community Engine funding. Terminal revenue support requires a separate explicit economics decision/release.

## T30 — RMT Pay sells tokens to finance gas

**Attack/bug:** implementation uses a DEX to convert burned/collected RMT to ETH.

**Required mitigation:** burn path and gas sponsorship are separate. Automated RMT→ETH conversion is forbidden in V1.

## T31 — RMT burn succeeds but utility fails

**Attack/bug:** user irreversibly burns RMT and receives no utility.

**Required mitigation:** onchain paid utilities require atomic burn + utility success, or the utility is not admitted. Dead-address transfers cannot be refunded.

## T32 — fake RMT burn accounting

**Attack/bug:** UI counts unrelated dead-address holdings as protocol usage or claims totalSupply reduced.

**Required mitigation:** maintain separate metrics:

- nominal `totalSupply()`;
- total dead-address balance;
- protocol-attributed RMT Pay burn events/receipts;
- legacy immutable retirement-sink balance;
- effective circulating supply.

Never conflate them.

## T33 — RMT Pay arbitrary sponsorship drain

**Attack:** users burn tiny RMT amounts to sponsor expensive arbitrary calls.

**Required mitigation:** utility policy binds exact targets/selectors/max gas/max burn amount/version/expiry and requires simulation. No arbitrary-contract sponsorship in V1.

## T34 — stale execution plan after STOP/START

**Attack/bug:** engine resumes and signs calldata observed before pause.

**Required mitigation:** START revalidates stage, runtime, eligibility, gas budget and plan expiration. Stale plans cannot be reused.

## T35 — duplicate WATCH PROJECT input

**Condition:** same project is submitted repeatedly.

**Required mitigation:** normalized deterministic candidate ID deduplicates observations. Watch priority does not create duplicate mint runs.

## T36 — candidate spam / denial of service

**Attack:** many watch inputs or discovered junk exhaust provider quotas.

**Required mitigation:** bounded queue, normalized dedupe, per-source rate limits, size-limited inputs, provider timeouts and observer-only degradation. Signing capacity must never depend on processing every candidate.

## T37 — compromised quality signal

**Attack:** bought followers/volume/marketplace verification manipulates quality score.

**Required mitigation:** no single soft signal can pass hard safety. Quality scoring remains versioned, explainable and initially observer-only until calibrated on real data.

## T38 — collection contract self-destruct/redeploy semantics

**Attack/condition:** runtime identity at target changes between observation and execution.

**Required mitigation:** final pre-sign bytecode/codehash verification. If chain semantics allow address-code mutation, plan is invalidated on any mismatch.

## T39 — wrong-chain signing

**Attack/bug:** transaction is constructed for another EVM chain.

**Required mitigation:** chain ID is explicit in every domain/plan, wallet policy and provider request. Chain mismatch is hard failure.

## T40 — privacy-invasive identity merging

**Attack/bug:** engine correlates IP/device/funding graph to identify “same human.”

**Required mitigation:** forbidden by architecture. V1 identity is current owner address only. Any future linking is voluntary and cryptographic.

## 6. Security invariants Codex must encode as tests

The following are not comments; they should become executable tests as the relevant packages are implemented.

### Census invariants

```text
unique seat count == unique current owner addresses in admitted public rows
seat weight == 1 for every active seat
sum(ownerGroup.squareCount) == publicMinted
no reserve/project token ID contributes a V1 seat
one token ID maps to exactly one canonical TBA
```

### Allocation invariants

```text
max(active serviceLevel) - min(active serviceLevel) <= 1
```

During a partially completed batch, a seat may be one level ahead only after every lower-level seat selected earlier in the same deterministic sequence is accounted for. The final committed result must never skip a lower-level active seat in favor of an already-higher seat.

```text
contribution changes cannot change assignments
number-of-Squares changes seat weight by 0
value/rarity fields are absent from allocation input
one acquired NFT appears in at most one assignment
one assignment increments exactly one seat and one Square after confirmation
```

### Mint invariants

```text
native mint value == 0
chainId == 4663
selector is admitted
runtime evidence matches plan
quantity <= creator limit
quantity <= local cap
plan not expired
collector asset policy passes
```

### Collector invariants

```text
collector != admin
authorized collector != treasury
authorized collector != deployer
collector RMT balance == 0 at preflight
collector CCFF00 balance == 0 at preflight
unrelated ERC20 allowance count == 0 for admitted tracked tokens
```

### RMT Pay invariants

```text
burn destination == 0x000000000000000000000000000000000000dEaD
no DEX target in utility plan
no RMT→ETH swap calldata
burn amount is exact/versioned
burn + utility atomic for admitted onchain utility
nominal totalSupply reporting remains truthful
```

## 7. Severity model

### Critical

Any condition that can:

- move protocol/user assets;
- cause arbitrary signing;
- reroute burn destination;
- programmatically sell RMT against policy;
- manipulate allocation after randomness;
- mint with nonzero native purchase value;
- duplicate distribution materially.

Critical finding blocks all execution.

### High

Any condition that can:

- bypass gas caps;
- bypass wallet/quantity limits;
- admit changed runtime;
- forge randomness;
- increment fairness state without confirmed delivery;
- lose acquired inventory through restart/reconciliation error.

High finding blocks affected release package.

### Medium

Examples:

- observer/provider false positives;
- stale quality metadata;
- dashboard accounting mismatch that does not move funds;
- recoverable queue starvation.

Medium may still block public release depending on affected claim.

### Low / informational

Presentation-only or operational hardening findings without integrity impact.

## 8. Release posture after a suspected compromise

If any execution-critical invariant becomes uncertain:

1. set engine to STOPPED/PAUSED;
2. prevent all new signatures;
3. continue read-only reconciliation of already-broadcast transactions;
4. snapshot collector balances, pending inventory, nonce/tx state and fairness commitments;
5. do not reroll randomness or rebuild assignments silently;
6. identify last independently verified state;
7. require a new reviewed recovery plan before resuming.

If the collector signer is compromised, rotate to a new dedicated collector only after pending inventory is reconciled. Never “rescue” by granting treasury/admin authority to the compromised rail.

## 9. Explicit non-goals

V1 security does not claim to solve:

- one-human-one-wallet Sybil resistance;
- NFT future value prediction;
- creator honesty;
- immutability of offchain metadata;
- prevention of users selling their received NFTs;
- prevention of holders transferring/selling their CCFF00 Squares;
- guarantee that a free mint remains culturally valuable;
- universal safe automation for arbitrary NFT contracts.

The engine must be truthful about these limits.

## 10. Mandatory review checklist before any signer is authorized

- [ ] current repo architecture still admits the Community Engine domain;
- [ ] terminal completion gate/owner authorization is explicit;
- [ ] live census evidence is current and fail-closed;
- [ ] provenance reader uses verified collection start boundary;
- [ ] mint adapter list is explicit and minimal;
- [ ] exact zero-native-value invariant is mechanically enforced;
- [ ] runtime/proxy evidence is final-pre-sign checked;
- [ ] collector address is isolated from treasury/admin/deployer/user wallets;
- [ ] collector starting asset/allowance posture is clean;
- [ ] gas caps are configured and tested;
- [ ] randomness commitment/verification vectors pass;
- [ ] fairness property tests pass large simulations;
- [ ] CCFF00 ERC-721 receipt/withdrawal canaries pass;
- [ ] retry/restart/reorg reconciliation tests pass;
- [ ] STOP semantics prevent new signing;
- [ ] no current fee/revenue policy is modified implicitly;
- [ ] no RMT Pay implementation exists unless separately admitted;
- [ ] secrets/diagnostics remain sanitized;
- [ ] owner reviews the exact canary transaction budget before broadcast.
