# CCFF00 Community Engine Packages I/J/K implementation packet V1

**Status:** PLANNING ONLY — FUTURE OPENAI CODEX IMPLEMENTATION PACKET  
**Packages:** I = community ETH gas funding; J = RMT Pay compatibility; K = admitted RMT Pay utility

These packages are intentionally late. The Community Engine can prove its core value before deploying a gas vault or activating RMT Pay.

# Package I — community ETH gas funding

## 1. Prerequisite

Do not build/deploy a gas vault because it sounds useful.

Require measured Package G/H evidence showing:

- collector gas spend;
- desired operating-balance/refill pattern;
- daily/epoch gas consumption;
- risks/limitations of manual funding;
- why a purpose-bound onchain vault improves operations.

CE-D12/D13 remain unresolved until that evidence exists.

## 2. Objective

Allow community members to voluntarily contribute native ETH to a purpose-bound gas reserve that can replenish only the admitted Community Engine collector under bounded rules.

Contribution amount creates:

```text
0 extra seats
0 extra odds
0 extra priority
0 extra rarity preference
```

## 3. First decide whether a contract is necessary

Compare:

### Option A — documented Safe/ops funding

Pros:

- no new contract/deployment;
- simplest early operations.

Cons:

- manual refill;
- contribution destination/control may be less purpose-restricted.

### Option B — immutable/bounded `CCFF00CollectorGasVaultV1`

Pros:

- public purpose accounting;
- fixed collector/refill bounds;
- community can send ETH directly.

Cons:

- new immutable contract/deployment/security surface;
- collector rotation design required;
- governance/pause semantics required.

Choose only after measured need.

## 4. Candidate contract core

If Option B is approved, conceptual immutable state:

```solidity
uint256 public constant CHAIN_ID = 4663;
address public immutable collector;
address public immutable governance;
uint256 public immutable maxRefillAtomic;
uint256 public immutable maxEpochReleaseAtomic;
uint64 public immutable epochSeconds;
bytes32 public immutable purpose;
```

Potential mutable accounting:

```text
epochId / epochStart
epochReleased
totalReceived
totalReleased
paused
```

Do not accept arbitrary destination in `release`.

## 5. Receive/deposit semantics

Anyone may contribute ETH.

Potential functions:

```solidity
receive() external payable;
function deposit() external payable;
```

Zero-value deposit can reject for clean accounting.

Events:

```solidity
event GasContribution(address indexed contributor, uint256 amount);
event CollectorRefilled(address indexed caller, address indexed collector, uint256 amount, uint256 epochReleased);
event PauseChanged(bool paused);
```

No event/record creates allocation rights.

## 6. Refill semantics

Preferred permission model to evaluate:

### Permissionless bounded refill

Anyone can call:

```text
refill(amount)
```

but ETH can only go to fixed collector and all caps apply.

This minimizes an operational keeper role.

Risks:

- attacker can trigger refills earlier than desired, moving ETH from vault to a compromise-prone collector up to caps.

### Governance/authorized refill

Only governance/keeper can refill.

Risks:

- more operational authority.

### Hybrid condition-based refill

Permissionless but only if collector balance below threshold and refill computes bounded target.

Potentially best purpose alignment but more contract logic.

Resolve CE-D12/13 after threat/canary review; no implicit selection now.

## 7. Contract prohibitions

No:

```text
arbitrary recipient
arbitrary call
delegatecall
generic execute
ERC20 custody/recovery feature
NFT custody
RMT payment
allocation lookup/weighting
DEX integration
RMT revenue router mutation
```

Vault purpose is native ETH collector gas only.

## 8. Collector rotation

A permanently immutable collector simplifies trust but forces new vault deployment if collector key rotates.

A governance-updatable collector reduces redeploy friction but creates redirection authority.

Candidates:

- immutable V1 + redeploy on rotation;
- delayed/timelocked collector rotation with public pending state;
- fixed registry address whose own rotation is separately hardened.

Do not choose without Package H rotation/incident requirements.

For first small system, immutable collector may be acceptable if gas balances remain deliberately small, but this is a future owner/security decision.

## 9. Pause semantics

Pause should stop new vault releases, not prevent ETH contributions/accounting.

Only admitted governance can pause/unpause.

Pause does not control Community Engine worker START/STOP; these are separate layers.

## 10. Gas-vault tests

If contract approved:

- wrong chain deploy rejects;
- zero collector/governance rejects;
- duplicate/colliding configuration rejects as applicable;
- zero deposit behavior exact;
- contribution increments totalReceived;
- no contributor entitlement state exists;
- refill goes only to collector;
- over maxRefill rejects;
- epoch total cap enforced;
- epoch rollover exact at timestamp boundaries;
- paused refill rejects;
- reentrancy/malicious collector receive behavior handled;
- failed transfer rolls back accounting;
- no arbitrary call surface;
- forced ETH/selfdestruct accounting considerations documented under current EVM semantics;
- invariants under fuzzing: `totalReleased <= totalReceived + forcedBalanceAccountingAsDefined` and epoch caps;
- Slither/high-severity gate;
- bytecode/deployment determinism/readiness process consistent with repo.

## 11. Community funding public accounting

Expose:

```text
vault balance
totalReceived
totalReleased
current epoch cap/released
collector current balance
community-funded gas spent downstream
```

Do not promise refund/ownership/equity unless a different contract explicitly implements it (not V1).

Contributions are voluntary gas support.

## 12. Terminal revenue funding remains separate

Possible future funding:

```text
RMT operations/treasury voluntarily deposits ETH
```

requires normal treasury authorization but may not require fee-policy change.

A protocol-level automatic revenue allocation requires a separately versioned economics/release decision.

Package I does not modify current `RMT_EXECUTION_V1`.

## 13. Package I completion

If no contract needed, a valid result is:

```text
DEFER GAS VAULT
manual/purpose funding sufficient at measured scale
```

If contract is justified, complete source/tests/security/deployment-readiness but do **not deploy** until exact separate deployment authorization.

Then STOP.

---

# Package J — RMT Pay compatibility preflight

## 14. Objective

Answer with evidence:

> Can the existing deployed RMT held in a user's wallet or CCFF00 TBA pay for an admitted atomic utility, with RMT going to the dead address and native gas sponsored separately, while preserving the user's current wallet architecture?

Possible valid outcome:

```text
YES for path X
```

or:

```text
NOT_CURRENTLY_SAFE
```

A negative outcome does **not** trigger RMT redeployment.

## 15. Preconditions

- RMT token current deployed identity/runtime revalidated;
- CCFF00 TBA current implementation/owner-control proof current;
- RMT external wallet gateway/current connector architecture understood;
- current Robinhood AA/sponsorship provider capabilities freshly probed;
- separate owner authorization for any testnet/mainnet gas-spend test.

Read:

```text
RMT_PAY_V1.md
RMT_PAY_COMPATIBILITY_V1.md
REFERENCE_INTERFACES_V1.md
THREAT_MODEL_V1.md
ERROR_CODES_V1.md
DECISION_REGISTER_V1.md
SPEC_CONSISTENCY_V1.md
this packet
```

## 16. Package J stages

Do not jump directly to a sponsored mainnet transaction.

### J1 — read-only deployed identity

Verify:

```text
chainId 4663
RMT address
RMT runtime hash
RMT name/symbol/decimals/totalSupply as applicable
transfer/approve/transferFrom behavior/interface
CCFF00 collection/registry/account implementation/salt
TBA owner semantics
burn destination literal
```

### J2 — local/fork atomic composition

Use current deployed RMT/TBA code on a fork or exact fixtures to prove candidate call composition.

### J3 — wallet connector capability probe

For each actually supported RMT connector/account class:

- does it support same-address 7702/smart-account mode if needed?;
- can it sign required authorization through RMT's current connector stack?;
- can batch calls be independently decoded/verified?;
- does exact owner address remain `msg.sender` where TBA requires it?;
- is sponsorship available on Robinhood 4663?;
- are wallet UX/security disclosures acceptable?

Do not assume one wallet path applies to all connectors.

### J4 — zero-ETH sponsored test

Only on an explicitly authorized low-risk utility/test path.

## 17. Candidate composition A — same-address owner batch

Preferred hypothesis:

```text
owner address A acting through admitted same-address AA/7702 execution
  ├─ TBA.execute(
  │     RMT,
  │     0,
  │     RMT.transfer(DEAD, burnAmount),
  │     CALL
  │   )
  └─ exact utility call

sponsor → native gas
```

Atomic transaction/user operation means if utility reverts, RMT transfer state reverts too.

Required proof:

- owner address identity preserved;
- TBA owner check passes;
- both calls one atomic context;
- user native balance not required;
- sponsor pays;
- no DEX call;
- exact RMT/dead balance deltas.

## 18. Candidate composition B — direct RMT source wallet

For RMT held directly in a user's admitted account:

```text
RMT.transfer(DEAD, burnAmount)
+ utility
```

inside same sponsored atomic batch may be simpler than TBA source.

Prove separately; success here does not prove TBA source compatibility.

## 19. Candidate composition C — immutable utility burner/router

Evaluate only if direct atomic batch lacks needed attribution/composition.

Possible contract:

```text
fixed RMT token
fixed dead address
fixed/registered utility IDs/policy verification
pull exact allowance amount
forward immediately to dead address
atomic utility call only if safely designable
no custody/rescue/sweep
```

This adds contract complexity and approval semantics. Do not deploy in J; at most prove whether it solves a concrete compatibility gap.

## 20. Avoid standard ERC20 gas-settlement mismatch

If a provider's “pay gas with ERC20” flow sends RMT to an application-controlled settlement wallet:

```text
NOT selected RMT Pay V1 settlement
```

unless a future owner decision changes dead-address economics.

Use provider's native gas **sponsorship** capability separately if compatible.

## 21. Zero-native-ETH test definition

Before test:

- exact user/control address native balance is zero or below estimated unsponsored gas such that ordinary execution cannot succeed;
- sponsor policy is active only for exact admitted test call;
- no hidden prefunding transaction to the user.

After:

- utility succeeds;
- user/control native balance did not need to pay normal gas;
- sponsor/bundler receipt proves sponsored gas under provider semantics;
- RMT moved exact amount to dead address.

## 22. Atomicity negative test

Construct same payment with utility deliberately reverting.

Expected state:

```text
RMT source balance unchanged
dead-address balance unchanged
utility state unchanged
```

If burn persists despite utility failure:

```text
RMT_PAY_ATOMICITY_UNPROVEN / REJECT PATH
```

## 23. No-sell trace/test

Inspect call targets/calldata/trace enough to prove the RMT Pay test does not call:

- Sushi router/pools;
- Uniswap router/pools;
- other known DEX conversion target;
- generic swap aggregator;
- WETH conversion of RMT impossible by simple transfer path.

The strongest invariant is policy target allowlisting rather than trying to blacklist every DEX after the fact.

## 24. Balance postconditions

For direct burn amount `X`:

```text
sourceBefore - sourceAfter == X
deadAfter - deadBefore == X
```

If approval/pull path:

- source delta exact;
- dead delta exact;
- router intermediate RMT balance returns to zero;
- allowance postcondition exact/zero as policy specifies.

## 25. Sponsorship policy

Provider/paymaster must be constrained to exact RMT Pay policy:

- chain;
- sender/account class;
- targets/selectors;
- gas cap;
- optional value=0 rules;
- expiration;
- rate/daily budget.

Do not make sponsor an arbitrary free-gas endpoint.

## 26. Package J compatibility matrix output

For each tested connector/account path:

| Path | Same owner address preserved | TBA source works | Atomic batch | Sponsorship on 4663 | Zero-ETH test | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Connector/path X | yes/no | yes/no | yes/no | yes/no | pass/fail/not-run | SAFE/UNSAFE/UNKNOWN |

No provider gets universal “supported” status from one connector test.

## 27. Package J completion decision

Return exactly one:

```text
RMT_PAY_COMPATIBLE_PATH_FOUND
```

with narrow admitted connector/account path evidence,

or:

```text
RMT_PAY_NOT_CURRENTLY_SAFE
```

with blockers.

No token migration suggestion merely because a wallet provider lacks needed AA support.

Then STOP.

---

# Package K — RMT Pay V1 admitted utility

## 28. Authorization prerequisite

Separate owner decision must specify:

- which utility/utility IDs;
- exact RMT burn price or versioned pricing method;
- allowed connector/account path from J;
- sponsored gas budget/caps;
- public burn/accounting wording;
- release/canary scope.

J compatibility alone does not authorize K economics.

## 29. V1 pricing preference

Prefer simple explicit fixed/leveled prices before gas-equivalent pricing.

Example structure (numbers deliberately unset):

```text
utility A = X RMT
utility B = Y RMT
```

Advantages:

- no RMT/ETH oracle;
- no DEX manipulation;
- user knows exact RMT amount;
- gas sponsor absorbs small gas variance under budget.

Exact values CE-D16 require owner economics decision.

## 30. RmtPayPolicyV1

Policy binds:

```text
policyVersion
chainId=4663
RMT address/runtime
burn destination=0x...dEaD
utilityId
allowed target(s)
allowed selector(s)
burn amount
max sponsored gas
allowed account/connector class if necessary
validFrom/expiry
simulation requirement
policy hash
```

No hidden fallback/default price.

## 31. User intent/authorization

Before wallet prompt, UI/plan should show:

```text
utility
exact RMT to be sent permanently to burn address
sponsored native gas disclosure
target outcome
```

Do not call it a normal token transfer if it is irreversible protocol utility burn-to-use.

## 32. Pre-sign verification

Immediately before submission:

- policy current/hash exact;
- chain exact;
- owner/account path exact;
- TBA ownership exact if TBA source;
- RMT balance sufficient;
- dead address exact;
- burn amount exact;
- utility target/selector exact;
- no DEX target;
- user operation/transaction atomic structure exact;
- simulation succeeds;
- gas cap/sponsor budget passes;
- replay/expiry state passes.

## 33. Execution

One authorized atomic sponsored operation only.

Outcome:

```text
burn + utility both success
```

or state reverts.

Provider gas accounting may still charge sponsor for a reverted UserOperation according to provider/paymaster semantics; this is sponsor budget risk, not user RMT loss, and should be measured.

## 34. Receipt/reconciliation

Build `RmtPayReceiptV1` proving:

- policy;
- source class/address;
- CCFF00 token ID if source is TBA;
- tx/userOp/receipt identity;
- exact block;
- exact source/dead RMT balance deltas;
- utility postcondition;
- sponsored gas evidence;
- no RMT intermediary balance if direct path;
- receipt hash.

Do not count payment as protocol burn until receipt passes.

## 35. Effective circulation/public metrics

Metrics:

```text
nominal totalSupply()
total dead-address balance
protocol-attributed RMT Pay burn
legacy retirement sink(s)
effective circulating supply
sponsored gas ETH
```

Formula for effective circulation may subtract admitted provably unrecoverable balances, but label methodology/version publicly.

`protocol-attributed burn` counts only RMT Pay receipts, not arbitrary third-party transfers to dead address.

## 36. Gas-budget exhaustion

If sponsor budget unavailable:

```text
RMT Pay unavailable
```

Do not:

- sell RMT;
- charge hidden ETH;
- silently fall back to user-paid native gas while UI says sponsored.

A future explicit option could let user choose ETH separately, but it is not an automatic RMT Pay fallback.

## 37. Person-to-person RMT is outside burn-to-use utility

Do not route creator/vendor/user payments to dead address unless the product is explicitly protocol utility.

```text
user -> creator RMT
```

is ordinary transfer/commerce and recipient may later sell.

Keep UI/accounting distinct.

## 38. Package K adversarial tests

- wrong RMT token/runtime;
- wrong burn destination;
- changed burn amount;
- stale/unknown policy;
- wrong target/selector;
- DEX target;
- RMT→ETH swap calldata/path;
- insufficient RMT;
- wrong CCFF00 owner;
- stale TBA;
- non-atomic construction;
- utility revert rolls back burn;
- gas cap exceeded;
- sponsor policy unavailable;
- replayed utility/payment intent;
- transaction uncertain;
- balance delta mismatch;
- dead address receives wrong amount;
- receipt tampering;
- arbitrary direct dead-address transfer not counted as protocol-attributed RMT Pay burn.

## 39. Package K canary/release

Start with one narrowly useful low-burn-cost utility and small sponsor budget.

Release gates:

```text
local/fork atomic proof
connector test proof
controlled canary
receipt reconciliation
public accounting proof
owner explicit release
```

No broad arbitrary utility registry initially.

## 40. I/J/K master boundary

The intended economics remain:

```text
COMMUNITY ENGINE COLLECTOR
native ETH gas → community/purpose funding

RMT PAY USER UTILITY
RMT → 0x...dEaD
native gas → separately funded sponsor/paymaster
```

Neither rail automatically sells RMT for ETH.
