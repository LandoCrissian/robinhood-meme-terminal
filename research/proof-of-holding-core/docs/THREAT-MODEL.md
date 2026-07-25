# Proof of Holding Core v0.1 Threat Model

**Status:** Draft engineering threat model  
**Applies to:** `ProofOfHoldingToken`, `LoyaltyAccounting`, and `PoHPolicyV1`  
**Does not cover:** reward vaults, Merkle roots, DEX adapters, buybacks, bridges, or liquidity managers

## 1. Security objectives

The core must protect the integrity of wallet holding history while preserving ordinary ERC-20 custody and transferability.

Primary objectives:

- token balances cannot be minted or confiscated through PoH administration;
- no wallet can create holding age from nothing;
- received tokens cannot inherit the sender's age;
- partial and full exits follow disclosed rules;
- accounting cannot diverge from eligible ERC-20 balances;
- excluded system addresses cannot receive active loyalty state;
- privileged actions are explicit and evented;
- arithmetic remains bounded;
- transfer processing has constant storage complexity;
- external calls cannot reenter the transfer-accounting path.

## 2. Assets

The system protects:

1. ERC-20 balances.
2. Active holding age.
3. Active and lifetime balance-seconds.
4. Position identifiers and reset history.
5. Policy identity.
6. Eligibility state.
7. Event history used by indexers.

Core v0.1 does not custody reward assets or LP positions.

## 3. Trust boundaries

### 3.1 Immutable token/accounting boundary

Only the immutable reference token may call `onTokenTransfer`. The token calls it after OpenZeppelin balance state is updated. Any accounting revert reverts the entire ERC-20 operation.

### 3.2 Policy boundary

The policy address and hash are immutable. The accounting constructor calls the policy once to obtain `policyHash`; the transfer path does not call the policy.

A malicious policy can misrepresent multipliers to applications but cannot directly change balances or holding timestamps.

### 3.3 Governance boundary

Governance can:

- transfer governance through a two-step process;
- exclude or unexclude addresses.

Governance cannot:

- mint reference tokens;
- seize or freeze token balances;
- pause transfers;
- change the token or policy;
- rewrite stored timestamps directly;
- withdraw assets from the core, because the core has no withdrawal path.

Exclusion power can still deny or reset loyalty state and must be treated as security-critical.

### 3.4 Chain boundary

The system relies on the host EVM chain for timestamp validity, ordering, finality, and censorship resistance.

## 4. Threat analysis

| Threat | Attack | Current control | Residual risk |
|---|---|---|---|
| Unauthorized hook call | Attacker calls accounting directly to forge age or balances | `onlyToken` with immutable token | Token implementation itself is trusted |
| Post-launch inflation | Privileged party mints new supply | No external mint function; fixed constructor mint | Constructor allocation can still be economically unfair |
| Transfer-age laundering | User transfers aged tokens to a fresh address | Recipient acquisition time is current timestamp | Selling an entire aged wallet or private key remains possible |
| Aged-dust attack | One old token is combined with a large new purchase | Weighted acquisition timestamp | Aggregate model is not exact lot accounting |
| Flash/snapshot attack | Large balance appears only at reward snapshot | Core exposes balance-seconds for average-balance systems | A future reward module must actually use epoch averages |
| Partial-sale manipulation | Holder sells most tokens but keeps full age | Remaining tokens retain age, but reward balance falls | Applications must not use age without balance exposure |
| Full-exit evasion | Holder exits and repurchases | Zero balance closes and resets active position | External derivatives may preserve economic exposure off-core |
| Wallet splitting | Holder spreads assets among many addresses | No flat per-wallet reward in core | Human-level Sybil resistance is out of scope |
| Self-transfer manipulation | Wallet repeatedly transfers to itself | Zero/self transfers do not update positions | Token wrappers may create separate economic positions |
| Pool reward capture | AMM pair accumulates a large balance and earns loyalty | Explicit exclusions | New or fake pools may remain eligible until reviewed |
| Governance blacklist abuse | Governance excludes an ordinary wallet | Events and immutable balance safety | Loyalty denial remains possible; timelock/multisig and policy constraints required |
| Exclusion state drift | Excluded account later becomes eligible with an old balance | Unexclusion starts a new position at current time | Incorrect operator decisions can still affect eligibility |
| Arithmetic overflow | Large balance-seconds operation overflows | Supply bounded to `uint192`; elapsed bounded to `uint64`; Solidity checked arithmetic | Lifetime cumulative arithmetic still needs formal analysis |
| Timestamp manipulation | Sequencer/miner adjusts block timestamp | Weighted metrics use long durations, not same-block precision | Short-duration perks must account for host-chain timestamp rules |
| Reentrancy | External callback reenters during transfer accounting | No untrusted external call on transfer path | Future token extensions must preserve this property |
| Gas griefing | Attacker creates many lots or history entries | Constant-size position state; no lot arrays | Event/indexer volume can still be large |
| Denial of service | Accounting bug reverts all transfers | Small immutable hook, bounded arithmetic, fuzz/invariant tests | Any undiscovered hook bug is critical because the token is coupled to accounting |
| Malicious recipient contract | Recipient callback manipulates accounting | Standard ERC-20 transfer has no recipient callback | ERC-777-style behavior is intentionally unsupported |
| Rebase divergence | Token changes balances without transfer hook | Reference token is non-rebasing | Arbitrary rebasing integrations are unsupported |
| Proxy/storage collision | Upgrade corrupts state | Core contracts are non-proxy and immutable | Migration requires a new deployment rather than in-place repair |
| Chain reorganization | Indexed events are reverted | Applications must wait chain-appropriate confirmations | Loyalty UI may temporarily display unfinalized state |
| Bridge double counting | Same economic asset appears on two chains | Cross-chain age is absent; destination starts independently | Future bridge modules require separate threat models |

## 5. Critical invariants

The test and audit program must enforce:

```text
eligible(account) => trackedBalance(account) == token.balanceOf(account)
```

```text
eligibleBalance == 0 => holdingAge == 0
```

```text
recipientWeightedTime >= preTransferRecipientWeightedTime
```

```text
fullExit => activeBalance == 0
         && weightedAcquisitionTime == 0
         && activeSince == 0
```

```text
excluded(account) => active eligible balance == 0
```

```text
sum(tracked eligible balances across a closed test universe)
    == token.totalSupply()
```

```text
only immutable token may mutate transfer-derived state
```

## 6. Highest-priority review areas

### 6.1 Token hook coupling

The accounting hook is part of transfer validity. This guarantees atomic consistency but raises severity: an accounting defect can halt all transfers. Review every path that can revert, especially balance underflow, timestamp subtraction, position ID increment, and balance-seconds accumulation.

### 6.2 Exclusion governance

Exclusions change economic eligibility. Production controls should include:

- a timelock;
- a multisig;
- a public reason hash;
- an on-chain list of excluded addresses;
- a policy that excludes only system contracts;
- monitoring for unexpected changes;
- certification rules that disclose every privilege.

### 6.3 Indexer reproducibility

Indexers should reproduce state from token transfers and PoH events and compare derived balances against contract views. Any future Merkle distributor must publish source block ranges, policy hashes, calculation versions, and complete allocation datasets.

### 6.4 Smart wallets and custody wrappers

Contract wallets, multisigs, vaults, exchanges, bridges, and lenders blur beneficial ownership. Core v0.1 tracks the address that directly owns the reference token; it does not infer the human or organization behind a contract.

## 7. Testing requirements

Before mainnet value:

- deterministic unit tests for every transition;
- fuzz tests for weighted timestamps and balance conservation;
- stateful invariant tests with transfers, burns, time advances, and exclusions;
- differential testing against an independent reference model;
- multi-year randomized simulation;
- gas-bound analysis;
- static analysis;
- symbolic execution of critical transitions where practical;
- fork tests on the target EVM chain;
- external audit;
- public bug bounty.

## 8. Mainnet launch blockers

Core v0.1 must not be treated as production-ready while any of the following remain:

- no external audit;
- no independent differential test harness;
- no formal governance deployment and timelock;
- no documented initial exclusion set;
- no target-chain fork tests;
- unresolved high- or critical-severity findings;
- no recovery and migration plan;
- marketing that misstates testing as a guarantee of safety.

## 9. Future modules require new threat models

Rewards, Merkle roots, DEX adapters, buybacks, liquidity vaults, stock-token treasuries, and cross-chain state introduce materially different risks. They must not inherit a “safe” label from Core v0.1 without separate analysis and testing.
