# CCFF00 Community Engine operations and failure semantics V1

**Status:** PLANNING ONLY — FUTURE IMPLEMENTATION INPUT

The product goal is high automation with extremely small operator authority. That only works if restart, timeout, ownership drift, provider failure and partial blockchain execution are defined before production signing exists.

## 1. Operator authority

Intended operator actions:

```text
START
STOP
WATCH PROJECT
```

Optional administrative maintenance later may include removing/pausing a watch record or rotating an explicitly admitted provider credential, but it must not provide recipient selection, NFT selection, allocation weighting or arbitrary transaction execution.

There must be no operator action equivalent to:

```text
send this NFT to this holder
skip this holder
reroll randomness
pick a new seed
mint despite safety failure
ignore creator wallet limit
```

## 2. Engine modes

Top-level mode:

```text
STOPPED
OBSERVER
CANARY
LIMITED_PRODUCTION
```

`START` only enters the highest mode already admitted by release policy. It cannot upgrade the engine from observer/canary to production.

A separate immutable/configured release policy determines which mode is available.

## 3. Single-writer principle

Execution state must have one authoritative writer or explicit leader election/lease semantics.

Do not run two independent workers capable of signing from the same collector merely because idempotency keys exist. Duplicate writers add nonce races and ambiguity.

Read-only discovery/enrichment may scale horizontally if it writes deterministic candidate observations safely, but signing/reconciliation authority remains serialized per collector account.

## 4. Work queues

Logical queues:

```text
discovery
candidate enrichment
mint plan verification
mint submission
mint reconciliation
inventory commitment
randomness wait/verification
allocation
distribution submission
distribution reconciliation
repair
```

A queue item carries a deterministic operation ID. Retry must be state-aware, not "execute the function again."

## 5. Discovery failure

If OpenSea/another provider is unavailable:

- do not halt the whole engine if other discovery sources remain healthy;
- mark provider state degraded;
- keep `WATCH PROJECT`/other admitted observation sources active;
- never fabricate stage/price/eligibility data from stale provider cache;
- an old provider plan cannot be signed solely because the API is down.

Discovery outage is different from chain/RPC outage.

## 6. Chain/RPC failure

If authoritative Robinhood reads are unavailable or inconsistent:

```text
NO NEW SIGNING
```

The engine may continue to display last-confirmed observer evidence with explicit staleness, but it cannot:

- build a fresh census;
- verify stage/price/runtime;
- sign a mint;
- sign a distribution;
- finalize a transaction as confirmed.

RPC providers may be redundant, but conflicting block identity/runtime evidence fails closed until reconciled.

## 7. Provider evidence versus chain evidence

A provider may say:

```text
free
active
10 remaining
```

while chain state says something else.

Chain/adapter evidence wins. Provider disagreement generates a reason code and prevents auto-execution.

## 8. Pre-sign transaction boundary

Immediately before every mint/distribution signature, require a fresh pre-sign bundle containing:

```text
engine mode == admitted RUNNING mode
chainId == 4663
fresh block identity
runtime/implementation identity
current stage/eligibility if mint
current ownership if distribution
exact calldata/value hash
simulation success
nonce state
collector asset policy
per-tx/run/day gas budget
plan not expired
idempotency key not consumed/pending ambiguously
```

Failure of any condition means no signature.

## 9. Submission ambiguity

This is one of the most important rules.

If the system sends a transaction and the RPC/network response is lost, classify it as:

```text
SUBMISSION_AMBIGUOUS
```

not:

```text
FAILED_SAFE_TO_RETRY
```

Reconciliation steps should inspect:

- known transaction hash when available;
- collector sender nonce/current nonce;
- pending/confirmed transaction evidence available from admitted RPCs;
- expected receipt/log/postconditions.

Do not submit a new independent transaction from the same operation until ambiguity is resolved.

## 10. Reverted mint

If a mint receipt confirms revert:

- no inventory is created;
- record actual gas spent;
- mint run becomes failed/reconciled;
- candidate may be reconsidered only from a newly verified plan if stage remains valid and policy allows;
- no blind repeated retry loop.

A revert after provider said the mint was valid is evidence against that plan/provider state and should be surfaced.

## 11. Successful transaction with unexpected outcome

A `status = success` receipt is not enough.

Examples of fatal/unresolved outcomes:

- expected quantity 5, only 4 admitted NFT mint events;
- minted NFT is owned by unexpected address;
- unexpected collection emitted mint event;
- unexpected ETH value moved beyond normal gas semantics;
- collector gained/lost unrelated assets;
- distribution receipt succeeds but `ownerOf` does not equal target TBA.

Mark reconciliation failure and halt new signing for the affected domain until reviewed. Never force counters forward merely because the EVM transaction status is success.

## 12. Inventory integrity

Once inventory is committed for allocation:

- no operator withdrawal;
- no sale/listing;
- no arbitrary transfer;
- no removal from the allocation set;
- no replacement because an NFT looks valuable or undesirable.

If an item unexpectedly leaves collector custody before confirmed distribution, halt the affected batch and investigate. Do not silently substitute another NFT.

## 13. Randomness service failure

First adapter candidate: future precommitted drand Quicknet round with pinned chain hash and cryptographic verification.

If one relay fails:

- query another admitted relay/client path;
- verify the same round cryptographically.

If a valid beacon for the committed round cannot be obtained/verified:

- keep inventory committed;
- do not choose a new round ad hoc;
- do not use local PRNG/blockhash/operator seed as fallback;
- wait/degrade to `WAITING_FOR_RANDOMNESS`.

If the randomness network itself has an exceptional failure requiring a new-round policy, that must be a separately documented deterministic repair rule, not an operator reroll.

## 14. Allocation determinism failure

The same:

```text
census
fairness state
inventory
randomness record
algorithm version
```

must reproduce the exact allocation hash.

If production and independent verifier disagree:

```text
HALT BEFORE DISTRIBUTION
```

Do not distribute using an allocation that cannot be independently reproduced.

## 15. Ownership drift

Before each distribution transaction:

```text
ownerOf(selected CCFF00) == assigned seat owner
canonical TBA unchanged
collector owns assigned NFT
```

If selected Square moved:

1. try the deterministic precommitted alternative Square order for that same seat;
2. if none remain with the seat, mark seat assignment stale;
3. use deterministic precommitted recipient fallback only if fairness remains valid;
4. otherwise create a repair batch from fresh census + future randomness.

The new Square owner does not automatically receive an NFT allocated to the previous owner merely because the NFT was about to be sent into that Square.

## 16. Seat entry/exit while batch is in progress

Eligibility is snapshot-based for an allocation batch.

- buyer after snapshot joins next admitted census;
- seller who no longer owns any snapshot Square at distribution preflight cannot receive from that stale seat assignment;
- a holder acquiring extra Squares after snapshot gets no extra seat and those new Squares are not destination candidates until next census;
- fairness repair never uses operator discretion.

## 17. CCFF00 TBA activation failure

If selected canonical TBA is undeployed and the admitted activation path fails:

- do not transfer NFT to an unverified alternate address;
- assignment remains unconfirmed;
- try another Square for the same seat only under deterministic Square preference rules if that Square has an already admitted compatible TBA;
- otherwise route to repair.

Mass distribution cannot begin before the exact activation/receive/withdraw canary is green.

## 18. Metadata failure

Metadata/image failure does not imply unsafe transaction behavior, and transaction safety does not imply good content.

If metadata cannot be fetched safely:

- quality evidence becomes incomplete/unknown;
- hard quality admission may reject the candidate depending on policy;
- never weaken SSRF/media protections to "see the NFT";
- already acquired inventory is still allocated unless a pre-existing immutable policy says the entire mint run is invalid for a non-value/safety reason.

Do not remove one token after acquisition because its metadata reveals a rare trait.

## 19. Gas budget exhaustion

If collector native ETH or policy budget is insufficient:

```text
NO NEW MINT/DISTRIBUTION SIGNING
```

Existing submitted transactions continue read-only reconciliation.

A low-balance state is not authorization to sell RMT, sell NFTs, use treasury assets or bypass refill caps.

## 20. Collector compromise assumption

Design as though the isolated collector key can eventually be compromised.

Limit blast radius by ensuring the collector holds only:

- capped ETH;
- no RMT;
- no CCFF00;
- no treasury/user assets;
- no unrelated approvals;
- transient already-committed NFT inventory.

A generic rescue function, arbitrary-call wallet or large standing gas balance increases blast radius and is not the default design.

## 21. Community ETH funding versus RMT Pay sponsorship

These are distinct gas domains.

### Community Engine collector

A normal isolated collector transaction pays native Robinhood gas. Future community ETH vault/refill can directly fund that collector.

### RMT Pay gasless user operations

If RMT Pay uses a third-party sponsorship service such as Alchemy, the provider may front gas and bill the application rather than draw ETH from `CCFF00CollectorGasVaultV1` directly.

Therefore do not claim one onchain gas vault automatically funds every gasless RMT Pay transaction.

RMT Pay must separately bind its sponsorship funding/accounting model:

```text
provider billing/credits
or
future self-funded onchain paymaster
or
other explicitly admitted sponsorship rail
```

The locked economic invariant remains the same: RMT burned for utility is never automatically sold for ETH.

## 22. Gas-vault candidate security

If a future `CCFF00CollectorGasVaultV1` is justified, prefer:

```text
fixed collector recipient
immutable chain purpose
no arbitrary call
no ERC-20/NFT custody requirement
max refill per call
max refill per epoch
cumulative accounting
events
pause/release authority narrowly bound
```

Avoid a general treasury wallet disguised as a gas vault.

If governance can release funds, every allowed recipient/amount boundary must be explicit. Consider whether a permissionless `refill()` that can only transfer a bounded amount to the fixed collector is safer than an operator-controlled arbitrary release.

Exact contract semantics remain a future Foundry design task.

## 23. START behavior

`START` does not resume stale plans.

On start:

1. verify release mode;
2. verify chain/RPC health;
3. verify collector identity and balance policy;
4. reconcile every ambiguous/pending transaction;
5. reconcile transient inventory;
6. expire/reverify stale candidates/plans;
7. verify fairness state against confirmed assignment receipts;
8. only then admit new signing work.

## 24. STOP behavior

`STOP` is a hard no-new-signatures boundary.

It does not:

- cancel a confirmed transaction;
- pretend a broadcast transaction never existed;
- abandon reconciliation;
- move inventory.

After STOP:

```text
submission = disabled
read-only reconciliation = enabled
observer/dashboard = optionally enabled
```

## 25. Watch-project input safety

Treat operator-provided URL/address/proof material as untrusted input.

- strict address/URL/schema parsing;
- bounded body/input size;
- no shell interpolation;
- no arbitrary file paths;
- no direct browser/server fetch to private network targets;
- proofs are verified against live root/state;
- notes cannot alter execution policy.

## 26. Secrets

Future secrets can include provider API keys and a collector signer credential.

Rules:

- never store secrets in Git/GitHub/chat/logs;
- separate read-only provider keys from signer authority;
- do not copy existing admin/treasury wallet secrets into the engine;
- secret availability never relaxes runtime policy;
- signer rotation requires reconciliation of sender/nonce/pending transaction state.

## 27. Logging/redaction

Persist enough evidence to reproduce decisions:

```text
candidate IDs
plan/evidence hashes
policy versions
block identities
transaction hashes
reason codes
randomness commitment/record hashes
allocation hashes
assignment state
confirmed gas usage
```

Do not log:

- private keys;
- seed phrases;
- raw authentication tokens;
- provider secrets;
- unnecessary user device/network identity.

## 28. Health states

Expose machine-readable health independent of public UI:

```text
HEALTHY_OBSERVER
HEALTHY_RUNNING
PAUSED_BY_OWNER
PAUSED_GAS_BUDGET
DEGRADED_DISCOVERY
DEGRADED_RANDOMNESS
BLOCKED_RPC
BLOCKED_SIGNER
BLOCKED_RECONCILIATION
BLOCKED_INVENTORY_INTEGRITY
BLOCKED_FAIRNESS_INTEGRITY
```

If multiple apply, report all blockers and choose the most restrictive execution state.

## 29. Fatal auto-pause triggers

Examples that should automatically disable new signing:

- wrong chain;
- CCFF00 canonical runtime/registry/implementation drift;
- collector identity mismatch;
- collector unexpected valuable asset/approval;
- mint target implementation drift;
- repeated unexpected mint postcondition;
- inventory hash mismatch;
- allocation reproducibility failure;
- randomness verification failure for a committed batch;
- unresolved sender nonce/submission ambiguity;
- distribution ownership/postcondition mismatch;
- gas budget exceeded;
- configured policy missing/invalid.

Recovery requires the corresponding evidence to become green; do not implement a generic "ignore blocker" button.

## 30. Disaster recovery

A fresh runtime instance must be able to recover from durable evidence without operator memory:

1. load admitted configuration/policy versions;
2. restore deterministic business state;
3. query chain for pending/confirmed transaction truth;
4. verify collector inventory;
5. verify current census/fairness baseline;
6. verify committed randomness/allocation artifacts;
7. resume only after all invariants pass.

Backups/export should include canonical public artifacts and necessary non-secret durable state, never signer secrets.

## 31. Initial production posture

When Package H is eventually authorized, prefer deliberately boring operation:

- one writer;
- low frequency observation sufficient for the actual mint windows;
- one known adapter family at first;
- tiny per-run quantity/gas limits;
- tiny pending inventory cap;
- automatic halt on uncertainty;
- no RMT Pay coupling;
- no gas vault until needed;
- no terminal revenue coupling.

Scale only after real reconciled evidence shows where the bottleneck is.
