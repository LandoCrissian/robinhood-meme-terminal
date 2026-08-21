# RMT Pay V1 — burn-to-use utility design

**Status:** PLANNING ONLY — NOT AUTHORIZED FOR IMPLEMENTATION OR ACTIVATION  
**Dependency:** CCFF00 Community Engine planning is independent; RMT Pay starts only after its own compatibility preflight and a separate owner authorization.

## 1. Product intent

Let a user use RMT as the visible payment unit for approved RMT/CCFF00 utilities without requiring the user to manage native ETH for the sponsored action.

For protocol utility, RMT is **not sold** to pay gas.

```text
user RMT
  ↓ approved utility payment
0x000000000000000000000000000000000000dEaD
  ↓
permanently removed from practical circulation

separate ETH gas sponsor / gas budget
  ↓
pays Robinhood Chain native gas
```

The burn path and gas-funding path are separate accounting domains.

## 2. Locked settlement rule

For RMT Pay V1 protocol utility:

```text
RMT destination = 0x000000000000000000000000000000000000dEaD
```

No RMT Pay V1 component may automatically:

- swap RMT to ETH;
- route RMT through Sushi/Uniswap/another AMM;
- sell RMT to replenish the gas budget;
- send used RMT to the RMT treasury for later sale;
- recycle spent RMT back into rewards.

Therefore an RMT Pay utility transaction itself creates no direct AMM sell pressure. It is an ERC-20 transfer/payment path, not a DEX trade.

## 3. Current token compatibility

The existing RMT token implementation already exposes the required ordinary ERC-20-style primitives:

- `balanceOf`;
- `allowance`;
- `transfer`;
- `approve`;
- `transferFrom`;
- 18 decimals;
- fixed immutable `totalSupply`.

It does not expose a native `burn()` or EIP-2612 `permit()`. Neither omission requires token redeployment for this design.

### Supply accounting consequence

Sending RMT to the conventional dead address does not change the token contract's immutable `totalSupply()` value.

Public accounting should distinguish:

```text
Nominal Total Supply
Dead-address RMT
Legacy Retired RMT (e.g. RMTRetirementSinkV1 balance)
Effective Circulating Supply
Protocol-attributed RMT Pay burn
```

Recommended calculation:

```text
EffectiveCirculating =
  totalSupply
  - balanceOf(0x...dEaD)
  - balanceOf(explicitly admitted unrecoverable retirement sinks)
```

Do not label `totalSupply()` as reduced when it is not. The UI may say “Burned to dead address” and “Effective circulating supply,” but must remain technically truthful.

## 4. Why not use the existing retirement sink for new RMT Pay payments?

`RMTRetirementSinkV1` is technically strong because its code exposes no withdrawal/rescue/admin path. It remains part of existing RMT distribution/runtime evidence and must not be repurposed casually.

The owner selected the conventional dead address for **new RMT Pay utility** because community members can recognize it immediately and independently see the burn balance accumulate.

Existing sink-bound systems remain untouched unless separately reviewed.

## 5. Gas sponsorship versus ERC-20 gas settlement

Robinhood Chain documents ERC-4337 account abstraction and gas sponsorship support. Alchemy currently lists Robinhood Mainnet/Testnet support for bundling, gas sponsorship and ERC-20 gas payments.

However, Alchemy's standard ERC-20 gas-payment flow transfers the user's ERC-20 payment to an application-controlled wallet and bills the application for native gas. That is not the selected RMT Pay V1 settlement outcome because V1 wants RMT to end at the dead address.

Therefore distinguish:

### Selected V1 concept

```text
RMT utility burn → dead address
+
separate gas sponsorship → native gas paid by sponsor
```

### Not automatically selected

```text
RMT → application settlement wallet → later handling
```

A future custom ERC-20 paymaster may combine these economically, but it is unnecessary for V1 and would add settlement/oracle complexity.

## 6. Payment sources

RMT Pay should eventually support two independently proven sources:

1. RMT held in the user's admitted RMT-capable wallet/account;
2. RMT held inside a canonical CCFF00 ERC-6551 token-bound account controlled by that Square's current owner.

CCFF00-held RMT is the more important compatibility case because the Community Engine/distribution work already places RMT inside those TBAs.

## 7. CCFF00-held RMT execution requirement

The existing RMT CCFF00 owner-control proof models the TBA's owner-authorized `execute(to, value, data, operation)` capability and proves RMT can be transferred out under owner control.

Before RMT Pay is implemented, a compatibility preflight must prove the exact deployed CCFF00 account implementation can safely compose with the selected sponsored-transaction rail.

The target logical sequence is:

```text
current CCFF00 owner authorizes one sponsored operation
  ↓
canonical TBA executes exact RMT payment/burn action
  ↓
approved utility action executes
  ↓
native ETH gas is sponsored separately
  ↓
postconditions prove RMT burn + utility success
```

Do not assume EIP-7702/ERC-4337/TBA composition works merely because each primitive exists independently. Prove it against the exact deployed Robinhood Chain contracts first.

## 8. Atomicity requirement

For an onchain utility where the user pays RMT, the preferred release criterion is:

> The RMT burn and the purchased utility action succeed atomically, or both fail.

The user must not be able to burn RMT and then lose the utility because a later independent transaction failed.

If the selected account-abstraction/batch path cannot provide that atomicity for a particular utility, that utility is not eligible for RMT Pay V1 until a safe reconciliation/refund-equivalent design exists. Because dead-address RMT cannot be refunded, “burn first and hope” is unacceptable.

## 9. Candidate payment implementation patterns

No contract is approved yet. Evaluate these in the compatibility preflight.

### Pattern A — direct TBA burn in an atomic sponsored batch

The owner-authorized batch causes the TBA to execute:

```text
RMT.transfer(0x...dEaD, exactAmount)
```

and performs the approved utility action in the same atomic sponsored operation.

Advantages:

- no spender allowance;
- simplest token movement;
- direct dead-address visibility.

Requirement: the chosen smart-account/7702/relayer composition must be able to atomically invoke the TBA and the utility under the exact owner authorization rules.

### Pattern B — ownerless RMT utility burner/router

A future immutable utility contract may accept an exact allowance/payment and forward RMT directly to `0x...dEaD` while emitting an attributable utility-payment event.

Desired properties:

- immutable/pinned RMT token identity;
- fixed dead-address destination;
- no owner/admin/upgrades;
- no arbitrary recipient;
- no arbitrary calldata;
- no custody/rescue/sweep;
- exact before/after balance checks;
- exact per-payment identifier/replay policy;
- allowance consumed back to zero when exact approval is used;
- explicit `UtilityPaid` event.

This pattern improves public attribution but adds a contract and approval call. It should exist only if it materially improves atomicity/auditability over Pattern A.

## 10. Pricing policy

Do not begin by pretending the RMT amount must exactly equal real-time gas cost.

### Safer V1

Use versioned, explicitly approved fixed RMT utility prices or bounded price tiers for specific RMT/CCFF00 actions while the gas sponsor absorbs small native-gas variance.

Benefits:

- no gas/RMT oracle dependency;
- no DEX price manipulation inside payment execution;
- simpler user disclosure;
- easy max-cost review.

### Possible later V2

A metered gas-equivalent RMT quote may use an independently verified/staleness-bounded price source and explicit max RMT cost. Do not use an instantaneous manipulable AMM spot value as the sole payment oracle.

No pricing policy is approved by this document.

## 11. Gas-budget sustainability

RMT Pay's native gas must come from a separate budget:

```text
community/future purpose ETH
and/or
separately authorized RMT terminal revenue allocation
  ↓
gas sponsor / gas vault
  ↓
network gas
```

Burned RMT does not have to finance gas by being sold.

If the gas budget is exhausted, RMT Pay should become unavailable/fail closed; it must not silently sell RMT or fall back to an undisclosed token conversion.

## 12. Allowed utility scope

Initial RMT Pay should be allowlist/policy based, for example:

- admitted RMT terminal utility;
- admitted CCFF00 utility;
- admitted community-engine action;
- other exact target/selector use explicitly added later.

It should not initially sponsor arbitrary user contracts merely because the user is willing to burn RMT.

Policy should bind at least:

```text
chainId
utilityId
target(s)
selector(s)
max native gas
max RMT burn amount
payment policy version
recipient/burn destination
simulation requirement
expiry/replay semantics
```

## 13. Person-to-person payments are different

Do not describe every RMT transfer as a burn.

If a user pays another user/creator/vendor in RMT:

```text
payer → recipient
```

the recipient owns the RMT and may later sell it. That is ordinary commerce and can create future market sell pressure.

RMT Pay V1 **protocol utility** is different:

```text
payer → 0x...dEaD
```

which is intended to be permanently removed from practical circulation.

## 14. Required compatibility preflight before implementation

OpenAI Codex should eventually build a read-only/test-only `RMT Pay Compatibility Preflight` proving:

1. exact deployed RMT contract address/runtime on chain 4663 matches admitted identity;
2. current RMT interface supports the chosen exact payment path;
3. dead-address transfer succeeds in a controlled test path without DEX interaction;
4. exact CCFF00 TBA can move RMT under its current owner's authorization;
5. selected Robinhood account-abstraction/gas-sponsorship stack is live and correctly chain-bound;
6. a zero-native-ETH user experience can be reproduced on an admitted test path;
7. burn + utility can be atomic for the chosen utility;
8. source/dead balances and allowance postconditions reconcile exactly;
9. no RMT/ETH swap is performed;
10. no token redeployment is required.

The preflight must not spend production funds or alter current RMT economics without separate authorization.

## 15. Public dashboard accounting

Future UI can expose:

```text
RMT Pay
- RMT burned through protocol utility
- total RMT at dead address
- legacy RMT retired in immutable sink(s)
- effective circulating RMT
- gas sponsored in ETH
- gas sponsorship source category
```

Do not imply the dead-address transfer changes Solidity `totalSupply()` when it does not.

## 16. External references to revalidate at implementation time

- Robinhood Chain account abstraction: `https://docs.robinhood.com/chain/`
- Alchemy Robinhood wallet/gas support matrix: `https://www.alchemy.com/docs/wallets/supported-chains`
- Alchemy custom ERC-20 gas-payment model: `https://www.alchemy.com/docs/wallets/low-level-infra/gas-manager/gas-sponsorship/using-sdk/pay-gas-with-any-erc20-token`

Provider capabilities and commercial terms may change. RMT must probe and bind exact capabilities rather than treating this planning record as permanent provider truth.
