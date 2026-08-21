# CCFF00 Community Engine Packages G/H implementation packet V1

**Status:** PLANNING ONLY — FUTURE OPENAI CODEX IMPLEMENTATION PACKET  
**Packages:** G = isolated collector live canary; H = limited autonomous runtime  
**Critical boundary:** G is the first package that may involve a real signer/ETH, and only with separate explicit owner authorization.

# Package G — isolated collector signer + canary

## 1. Authorization prerequisite

Do not begin live Package G because Packages A–F passed automatically.

Require an explicit owner authorization naming:

- Package G;
- exact intended chain (Robinhood mainnet/testnet as applicable);
- exact maximum ETH budget;
- exact collector address/account once selected;
- whether the authorization covers acquisition only or also one delivery canary.

Without that approval, Package G may build/read-only preflight code only.

## 2. Objective

Prove one dedicated low-value collector can:

```text
receive tiny gas funding
→ sign exactly one previously admitted zero-price mint plan
→ reconcile acquisition
→ hold only the expected NFT(s)
→ optionally deliver one NFT under separately authorized canary
→ return to clean low-value state
```

without access to RMT admin, treasury, deployer, holder or trading assets.

## 3. Collector account selection

CE-D09 is resolved here.

Evaluate the minimum appropriate signer/account technology available in current RMT architecture at that time.

Selection criteria:

- chain 4663 support;
- exact programmatic signing policy capability;
- enforceable target/value/gas restrictions where possible;
- nonce/receipt observability;
- key isolation from web client;
- clean credential rotation/revocation;
- no requirement to share RMT treasury/admin credentials;
- operational support for STOP/revoke.

Do not choose a provider because it was named in planning; compare live supported options.

## 4. Collector identity must be new/dedicated

Preflight rejects if collector equals any known privileged/normal-use identity:

```text
RMT admin
treasury/Safe
protocol deployer
general trading wallet
known CCFF00 holder wallet
RMT Pay user wallet
```

If an address participates in another RMT privileged role later, it should cease being eligible as collector.

## 5. Preferred preflight files

Conceptually:

```text
scripts/community-engine-collector-preflight.mjs
scripts/community-engine-collector-preflight.test.mjs
```

or current equivalent under a newly approved execution service if architecture has changed.

Preflight is read-only until explicit submission stage.

## 6. Collector asset posture

Before funding/signing:

```text
RMT balance == 0
CCFF00 NFT balance == 0
no unrelated NFTs expected
no forbidden ERC20 allowances
no unrelated ERC20 balances above dust policy
native ETH <= approved operating cap
```

The exact tracked-token/allowance set should include at least RMT and any assets/routers exposed by current RMT context. Do not claim “all possible ERC20 approvals on chain are zero” without an index capable of proving it.

Use technically precise scope wording.

## 7. Gas funding canary

For first live canary, do **not** require a new gas-vault contract.

Use a small explicit ETH transfer from an owner-approved funding source to collector, bounded to the exact Package G budget.

Record:

```text
funding tx hash
amount
collector balance before/after
source category
```

Funding does not affect fairness.

## 8. One-mint canary selection

Candidate must already pass:

- Package C observer evidence;
- Package D known adapter/unsigned plan;
- curation quality policy;
- exact zero native mint value;
- current stage/eligibility;
- transferability admission;
- fairness quantity preflight.

For first canary, prefer quantity 1 even if creator allows more, unless the exact mint semantics cannot support it. If it cannot, choose another candidate rather than broadening canary risk.

## 9. Final pre-sign revalidation

Immediately before signing/broadcast:

- engine release mode allows Package G canary;
- STOP not requested;
- chain ID exact;
- collector address exact;
- collector nonce state known;
- collector ETH within budget;
- no forbidden asset/allowance drift;
- mint target/collection runtime unchanged;
- proxy implementation unchanged;
- exact stage active;
- exact mint price/value still zero;
- collector still eligible;
- quantity still admitted;
- gas estimate within exact canary cap;
- plan not expired;
- calldata hash equals reviewed plan;
- transaction value exactly zero.

Any change invalidates the signed-plan readiness and requires re-plan/review as policy dictates.

## 10. Signing interface must be narrow

Future signer function should accept an already verified mint plan, not arbitrary `{to,data,value}` from operator/provider.

Conceptually:

```ts
submitCommunityMintPlan(
  verifiedPlan: VerifiedCommunityMintPlanV1,
  collectorAuthority: CollectorAuthority
)
```

No generic admin route:

```ts
sendTransaction(anyTarget, anyCalldata)
```

inside the Community Engine control surface.

Underlying signer provider may technically support generic transactions; RMT wrapper/policy must not expose that as Community Engine behavior.

## 11. Submission state transition

Before external send call:

```text
NOT_SUBMITTED
→ SUBMISSION_STARTED
```

Persist/hash deterministic operation ID and plan hash **before** contacting signer/provider.

After known tx hash:

```text
HASH_KNOWN
```

If request errors after send boundary with no definitive status:

```text
UNCERTAIN
```

not NOT_SUBMITTED.

## 12. Uncertain canary rule

If Package G mint submission is uncertain:

```text
STOP NEW SIGNING
```

Reconcile:

- collector nonce;
- provider transaction history if available;
- mempool/chain tx hash if known;
- expected collection mint events;
- collector NFT holdings;
- collector ETH balance.

No retry until definitive state.

## 13. Acquisition reconciliation

After required confirmations/finality:

Verify:

```text
receipt.status == success
receipt.to == admitted mint target
transaction.value == 0
expected mint events exactly match adapter semantics
acquired quantity == 1 (first canary)
collector owns acquired NFT
no unexpected NFT/erc20/native transfer beyond network gas
actual gas <= approved budget
```

Build inventory manifest.

Do not manually add/remove token IDs.

## 14. Optional one-delivery canary

Only if owner authorization explicitly includes it and Package F exact TBA behavior is already proven.

Use Fair Allocation V1 with quantity 1 and predetermined verified randomness under Package E semantics.

Then:

- compute selected seat/Square preference;
- refresh current ownership;
- simulate exact transfer;
- submit one delivery;
- reconcile exact TBA ownership;
- update fairness state only after confirmed delivery.

If authorization was acquisition-only, stop with NFT controlled inventory and an explicit next decision for delivery. Do not infer permission.

## 15. Collector post-canary state

Target:

```text
RMT=0
CCFF00=0
forbidden allowances=0
pending inventory=0 if delivery completed
or exactly 1 committed canary NFT if acquisition-only
remaining ETH small/bounded
```

Do not sweep to treasury automatically. Any cleanup movement is explicit/reviewed.

## 16. Package G tests

Read-only/preflight:

- collector equals admin rejects;
- treasury rejects;
- deployer rejects;
- holder rejects;
- RMT balance nonzero rejects;
- CCFF00 balance nonzero rejects;
- forbidden allowance rejects;
- balance over cap rejects;
- wrong chain rejects;
- stale plan rejects;
- STOP rejects signing;
- runtime changed rejects;
- nonzero tx value rejects;
- gas over cap rejects.

Submission/reconciliation fixtures:

- send success + hash;
- timeout before send definitively known safe to retry only if provider proves no submission;
- timeout after possible send -> uncertain;
- receipt success;
- receipt failure;
- nonce replacement;
- reorg before finality;
- unexpected acquired token;
- duplicate mint event;
- crash after tx hash before receipt state save.

## 17. Package G completion report

For a live canary report exact:

```text
OWNER_AUTHORIZATION_SCOPE
COLLECTOR_ADDRESS
COLLECTOR_TECH/POLICY
FUNDING_TX/AMOUNT
MINT_PLAN_HASH
MINT_TX_HASH
MINT_TARGET
MINT_VALUE=0
GAS_USED/COST
ACQUIRED_COLLECTION/TOKEN_ID
INVENTORY_HASH
DELIVERY_AUTHORIZED yes/no
if yes: census/randomness/allocation/delivery hashes
COLLECTOR_POST_BALANCES
UNRESOLVED CONDITIONS
```

Then STOP.

---

# Package H — limited autonomous runtime

## 18. Authorization/architecture prerequisite

Before implementation, explicitly record a new current architecture decision naming the service/process that owns Community Engine execution.

The decision must preserve:

```text
apps/indexer = V6 compatibility only
apps/market-indexer = read-oriented market intelligence
```

Do not proceed by quietly placing the worker into either service.

## 19. Service design questions Codex must answer first

Propose before coding:

1. runtime language/package consistent with repo;
2. single authoritative writer design;
3. durable state technology;
4. deployment environment;
5. signer credential isolation;
6. provider credential isolation;
7. durable STOP state;
8. queue semantics;
9. reconciliation process while STOPPED;
10. health/readiness semantics;
11. leader lease/election if >1 replica;
12. public/read-only status API boundary;
13. backup/recovery of fairness/inventory state;
14. data retention/proof artifact policy.

Owner/architecture review resolves CE-D11 before implementation commits to service/storage.

## 20. Likely minimal service shape

If no newer current architecture exists, a dedicated workspace such as:

```text
apps/community-engine-worker/
```

is preferable to overloading unrelated services, but the directory name is not pre-approved.

Reuse shared packages/VNext domain functions rather than copying them into worker.

## 21. Single-writer requirement

There may be many read-only discovery/enrichment processes, but exactly one execution writer per collector account.

Acceptable strategies:

- exactly one deployed writer replica; or
- durable leader lease with fencing token/version checked before signing.

A database uniqueness constraint alone does not solve concurrent nonce/signing races.

If lease is lost:

```text
NO NEW SIGNING
```

current worker may continue read-only reconciliation.

## 22. Suggested durable entities

At minimum:

```text
engine_control_state
watch_records
candidate_observations
mint_plans
mint_runs
transaction_attempts
acquired_inventory
census_checkpoints
fairness_seat_state
square_delivery_state
collection_receipt_history
allocation_commitments
randomness_records
assignments
delivery_attempts
repair_jobs
gas_budget_state
```

Store canonical hashes and chain transaction/block evidence, not only mutable JSON blobs.

## 23. State ownership

### Onchain-authoritative

- current CCFF00 owner/TBA;
- NFT ownership;
- transaction receipt/status;
- collector native/token balances;
- RMT Pay balances later.

### Durable runtime-authoritative policy/history

- confirmed service levels derived from receipts;
- Square delivery counts derived from receipts;
- collection coverage derived from confirmed Community Engine deliveries;
- watch records;
- candidate/provider observations;
- allocation commitments/results;
- operator START/STOP requested state.

Every derived fairness counter should be reconstructable/auditable from confirmed delivery history.

## 24. Append/update model

Prefer append-oriented transaction/assignment history plus derived current tables.

Never overwrite:

- prior allocation commitment;
- randomness record;
- assignment target;
- tx attempt history;

merely because repair/retry occurred.

Repair links to original operation.

## 25. Candidate queue

Discovery can enqueue normalized candidate IDs.

Deduplicate by deterministic candidate identity.

Priority may reflect:

- WATCH records;
- stage opening soon;
- observer confidence.

Priority must not alter safety/quality/fairness admission.

## 26. Pre-mint runtime pipeline

```text
WATCHING
→ candidate observation
→ quality evidence
→ adapter classification
→ current mint verification
→ current fairness preflight
→ unsigned plan
→ final pre-sign verification
→ submission
→ reconciliation
```

Do not cache a plan across material state changes.

## 27. Post-acquisition pipeline

After finality:

```text
confirmed receipt
→ complete inventory manifest
→ acquisition-block historical census
→ fairness checkpoint
→ deterministic future randomness round
→ wait/verify beacon
→ allocation result
→ delivery queue
→ each delivery pre-sign owner refresh
→ submission/reconcile
→ fairness counters from confirmed deliveries
```

## 28. START semantics

`START` means:

- requestedRunning=true;
- effective mode cannot exceed separately admitted release mode;
- revalidate chain/provider/signer/lease/gas state;
- resume only safe queued states.

`START` does not mean:

- promote observer to production;
- ignore uncertain tx;
- reuse expired plans;
- reset failure counters;
- reroll randomness.

## 29. STOP semantics

Persist STOP first.

At every pre-sign boundary re-read or use strongly consistent STOP/control state as architecture permits.

STOP blocks:

```text
new mint signatures
new delivery signatures
new TBA activation signatures
future RMT Pay signatures
```

STOP does not block:

```text
RPC receipt checks
reorg detection
inventory reconciliation
public status reads
proof generation
```

Already-broadcast transactions remain chain reality.

## 30. Automatic pause triggers

At minimum:

- signer/collector policy mismatch;
- chain ID mismatch;
- persistent RPC inconsistency;
- tx uncertain beyond tolerated policy;
- deep reorg affecting committed state;
- collector forbidden asset/allowance drift;
- gas daily cap reached;
- pending inventory cap reached;
- randomness verification failure after abnormal conflicting relay evidence;
- runtime/adapter identity change requiring review;
- invariant violation in fairness/storage reconciliation.

Provider discovery outage alone can degrade observation rather than necessarily pause signing if an already queued candidate can still be fully reverified from authoritative sources; design this explicitly.

## 31. Gas caps

CE-D10 resolved from measured Package G data before limited production.

Separate caps:

```text
max mint quantity per run
max gas units per mint tx
max native gas cost per mint tx
max gas cost per delivery tx
max total gas per mint run including deliveries
max total gas per rolling/day window
max pending inventory count
max simultaneous unresolved tx attempts
```

No single “max gas” flag hides different risks.

If gas price spikes after plan:

```text
re-estimate/reverify
```

and wait/reject if cost cap exceeded.

## 32. Transaction nonce discipline

One signer writer owns nonce progression.

Before submit:

- reconcile any earlier uncertain nonce;
- do not submit nonce N+1 if N status could make execution ambiguous unless signer/provider architecture explicitly safely supports queued nonces and reconciliation policy.

Prefer sequential first production mode over maximum throughput.

## 33. Retry classification

### Safe read retry

RPC/API reads with idempotent semantics.

### Rebuild/reverify retry

Plan expired/stage changed/gas changed: return to verification, not resubmit old tx.

### Submission retry

Allowed only when prior attempt definitively not submitted or confirmed failed in a way that policy permits a new fresh plan.

### Never blind retry

`UNCERTAIN` submission.

## 34. Reorg policy

Before inventory commitment/fairness update, require configured confirmation/finality depth.

If a shallow reorg removes a pending tx/event:

- return to reconciliation;
- no derived fairness update persists as confirmed.

If a reorg affects already committed allocation anchor/inventory/delivery history beyond admitted depth:

```text
AUTOPAUSE_REORG
```

Require reviewed repair; do not silently recompute winners with new chain history.

## 35. Ownership drift during delivery queue

For each assignment immediately before sign:

- get current owner for each precommitted Square preference candidate;
- select first still-owned Square for assigned seat;
- canonical TBA refreshed/verified;
- if none remain, repair-required;
- do not substitute a different seat.

The assigned NFT remains controlled inventory until repair.

## 36. Repair jobs

A repair is deterministic evidence, not an operator override.

Repair reasons may include:

- seat sold all committed Squares;
- transfer repeatedly fails due external NFT behavior change;
- assignment tx reorged;
- current TBA canonical config changed.

Repair must preserve original assignment/commitment in history and define whether new census/randomness is required by specialized fairness policy.

No “send it to someone else manually” operation.

## 37. Watch input runtime API

Authenticated operational surface may support:

```text
create watch
pause/remove watch
list watches
```

Input guards:

- bounded JSON;
- authenticated operator;
- rate limits;
- strict schema;
- no arbitrary HTML/script execution;
- no force approve.

START/STOP requires stronger operator auth than public read status.

## 38. Public status API

Read-only/sanitized:

```text
mode
running/stopped
gas fund/collector status
candidate counts
last acquisition
pending inventory
waiting randomness
pending/confirmed deliveries
current census summary
public proof IDs
```

No signer/provider secrets.

## 39. Runtime health

Distinguish:

```text
/health — service/process/provider diagnostic
/ready — safe to perform admitted execution
```

`ready=false` if:

- STOPPED;
- no leader lease;
- signer unavailable;
- chain unavailable;
- unreconciled critical invariant;
- gas cap prevents execution.

Observer/public status can remain available while execution not ready.

## 40. Package H chaos/recovery tests

Required before limited production:

- kill process before signing;
- kill immediately after provider submit begins;
- kill after tx hash before state save;
- kill after receipt before inventory save;
- kill after commitment before randomness;
- kill after randomness before assignment persistence;
- kill between deliveries;
- duplicate queue item;
- two writer replicas attempt lease;
- lease expires during work;
- STOP during every state;
- RPC 429/timeout;
- split RPC disagreement;
- OpenSea outage;
- drand relay outage;
- drand conflicting invalid response from one relay;
- gas spike;
- owner sells preferred Square mid-queue;
- shallow reorg;
- simulated deep reorg/invariant break;
- collector receives unsolicited token/NFT;
- storage transaction rollback;
- database connection loss after broadcast.

## 41. Limited production mode

Initial `LIMITED_PRODUCTION` should be intentionally boring:

- one writer;
- one collector;
- one or very few admitted mint adapters;
- low quantity cap;
- low daily ETH cap;
- sequential txs;
- low pending inventory cap;
- clear auto-pause;
- public proofs.

Do not optimize throughput until a real bottleneck exists.

## 42. No autonomous adapter expansion

Runtime cannot generate/admit a new mint adapter because it sees an unknown contract.

Unknown:

```text
observe/log
→ human/Codex review
→ new adapter version PR/test
→ separate release
```

## 43. Package H completion evidence

Codex reports:

```text
architecture/service decision
storage schema/migrations
single-writer/lease evidence
signer isolation
exact caps/policy
START/STOP tests
uncertain tx tests
restart/reorg tests
limited production canary history
public proof examples
gas consumption
pending inventory/reconciliation state
security/secret scan
```

Then STOP before broadening operation or deploying gas-vault Package I.

## 44. G/H master safety claim

At the end of H, the intended evidence should support:

> The autonomous process can only execute previously admitted zero-value mint/delivery operations through a low-value isolated collector, cannot use donor/Square count to choose recipients, and can stop/recover without blind transaction retries.

Do not claim broader autonomy than the tested adapter/cap/release set.
