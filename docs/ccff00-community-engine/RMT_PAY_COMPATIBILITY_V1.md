# RMT Pay compatibility preflight V1

**Status:** PLANNING ONLY — NO PROVIDER/WALLET PATH ADMITTED  
**Purpose:** make the future RMT Pay experiment prove the existing RMT + CCFF00 + wallet architecture works before any payment utility is implemented.

This document is deliberately conservative. RMT Pay must adapt to RMT's current external-wallet architecture; it must not force a wallet migration merely to make gas abstraction convenient.

## 1. Required user outcome

For an admitted protocol utility, the target UX is:

```text
user owns CCFF00
  ↓
RMT is held in that Square's canonical ERC-6551 account
  ↓
user authorizes one RMT Pay action
  ↓
exact RMT amount moves to 0x000000000000000000000000000000000000dEaD
+
approved utility succeeds atomically
+
native Robinhood gas is sponsored separately
```

The user should not need native ETH for the admitted sponsored action.

## 2. Existing facts we can already rely on

### RMT token

Current RMT has ordinary ERC-20-style:

```text
transfer
approve
transferFrom
balanceOf
allowance
```

It does not have native `burn()` or EIP-2612 `permit()`.

This does not require a token redeploy. It does mean a design requiring permit-from-TBA is not available and must use another authorization pattern.

### CCFF00 TBA

Existing RMT proof code models the canonical token-bound account's owner-authorized:

```text
execute(to, value, data, operation)
```

and already proves RMT can be moved out through that execution surface under current-owner control.

Package J must verify the exact deployed account runtime/owner semantics again; source-level assumptions are insufficient.

### Robinhood Chain

Robinhood Chain currently documents account abstraction/gas sponsorship support. External provider capabilities remain implementation-time dependencies, not protocol guarantees.

## 3. Why same-address account abstraction matters

A separate ERC-4337 smart-account address controlled by the user's EOA is not automatically equivalent to the CCFF00 owner address.

If the TBA authorization checks that the caller is the current CCFF00 owner, then:

```text
EOA owner = 0xA
separate smart account = 0xB

0xB → TBA.execute(...)
```

may fail because `msg.sender` is `0xB`, not the NFT owner `0xA`.

Therefore do not assume an arbitrary separate smart account can control the TBA.

An EIP-7702 style account is interesting precisely because code executes from the same EOA address. A batch initiated as the upgraded owner address may preserve:

```text
msg.sender == current CCFF00 owner
```

when calling the TBA.

That is a hypothesis to prove against the exact deployed CCFF00 implementation, not a planning assumption.

## 4. Current provider/wallet compatibility wrinkle

As of the planning date:

- Alchemy Wallet APIs document EIP-7702 as their default smart-wallet model, keeping the same EOA address and adding batching/gas sponsorship;
- Alchemy's signer documentation says embedded wallet providers such as Privy can expose the required authorization signing path, while external browser/hardware wallets such as MetaMask/Rabby/Ledger do not expose the `signAuthorization` interface expected by that Alchemy integration path;
- MetaMask itself documents EIP-7702 smart-account capability and a MetaMask-specific upgrade/Delegation Framework path;
- MetaMask's documented built-in account upgrade targets its own delegator rather than allowing a dapp to choose an arbitrary third-party delegation target.

These facts mean:

> Do not declare “Alchemy + MetaMask + CCFF00 TBA” solved merely because all three support some form of account abstraction.

Package J must test the exact connector/account path RMT actually presents to users on Robinhood Chain.

## 5. Preserve RMT's existing wallet architecture

Current repository authority treats the external-wallet gateway and exact connected recipient identity as security infrastructure.

RMT Pay must not silently:

- replace the user's connected wallet;
- make a new embedded wallet the owner of the user's CCFF00;
- move CCFF00/RMT into an application wallet;
- weaken exact recipient binding;
- require an unrelated smart-account address that the TBA does not recognize as owner;
- bypass the current gateway solely for provider SDK convenience.

If a provider cannot compose with the admitted wallet path, choose another provider/pattern or keep RMT Pay disabled.

## 6. Compatibility candidates to test

No candidate is approved yet.

### Candidate A — same-address EIP-7702 owner batch

Logical operation:

```text
upgraded/smart owner address 0xA
  ├─ call CCFF00_TBA.execute(
  │    RMT,
  │    0,
  │    RMT.transfer(DEAD, amount),
  │    CALL
  │  )
  └─ call exact admitted utility

sponsor pays native gas
```

Required proof:

- wallet can authorize the 7702/smart-account mode on Robinhood 4663;
- account remains exact owner address `0xA`;
- batch is atomic;
- TBA accepts the call as owner-controlled;
- RMT transfer reaches dead address;
- utility postcondition succeeds;
- sponsorship works with zero user native ETH.

### Candidate B — wallet-native MetaMask smart-account batch

If the existing MetaMask connector can use MetaMask's own smart-account/delegation path on Robinhood while preserving exact owner address and RMT's gateway semantics, test that path independently of Alchemy's 7702 signer API.

Do not assume MetaMask's own gas sponsorship supports Robinhood. Native batching/account upgrade and gas sponsorship are separate capabilities and may require a compatible external sponsor/paymaster.

### Candidate C — existing admitted wallet/provider batch through another sponsor

A provider-neutral EIP-5792/ERC-4337/7702 compatible path may work if:

- exact owner address is preserved where TBA requires it;
- user authorization is wallet-native;
- RMT can independently validate transaction contents;
- sponsor/paymaster can be constrained to admitted RMT Pay calls.

### Candidate D — pre-authorized immutable utility burner

If same-operation TBA control cannot be sponsored cleanly, a later design could consider an explicit owner-approved allowance from the TBA to an immutable RMT utility burner/router.

This does **not** make first use gasless automatically: the TBA still needs owner-authorized `approve()` execution initially.

If ever considered:

- allowance must be tightly bounded;
- burner has fixed RMT/dead-address identities;
- signed utility intent/replay protection required;
- no arbitrary recipient/call;
- no generic permanent unlimited approval;
- revoke path and allowance evidence required.

This is fallback research, not preferred V1.

## 7. Why missing `permit()` still does not justify redeploying RMT

`permit()` would make some meta-transaction patterns easier, but utility can be layered around the existing token through:

- same-address owner batching;
- exact approval inside an atomic owner-controlled batch;
- or another reviewed external authorization layer.

A token migration would impose ecosystem/liquidity/address risk far beyond the value of one convenience feature.

RMT Pay remains optional until one safe composition passes.

## 8. Atomicity test

For a paid onchain utility:

```text
RMT burn + utility success
```

must be one atomic execution context wherever technically possible.

Test a deliberately reverting utility call and prove:

```text
RMT source balance unchanged
dead-address balance unchanged
utility state unchanged
sponsor may only have incurred whatever provider-defined failed-op accounting is expected
```

If the RMT transfer can succeed while utility reverts independently, that pattern is not admitted for irreversible burn-to-use V1.

## 9. Zero-ETH test definition

A valid test is not “we paid gas from another wallet once.”

Before the action, prove the user's exact admitted owner account has insufficient/zero native ETH for ordinary execution under the test parameters.

Then prove:

- sponsored operation submitted;
- user did not receive hidden ETH funding as an intermediate step unless that mechanism is explicitly part of the provider model;
- user ETH delta does not pay the gas;
- sponsor/paymaster/provider accounting identifies the gas source;
- RMT burn and utility result reconcile.

## 10. Sponsor policy restrictions

Any third-party sponsorship policy must be narrower than “sponsor everything from these users.”

Bind available provider controls as tightly as the provider supports, with local RMT verification adding the final authority:

```text
chain 4663 only
admitted account mode
admitted target(s)
admitted selector(s)/batch shape
max gas per operation
max sponsored spend per user/day/global
no arbitrary value transfer
policy expiration/version
```

Provider policy is defense in depth. RMT's local exact plan verification remains required.

## 11. RMT Pay must not use standard ERC-20 gas settlement unless outcome matches policy

Alchemy currently offers ERC-20 gas payment infrastructure, but its documented model can transfer the user's ERC-20 payment to an application-configured settlement wallet while the provider fronts gas.

That is not the locked RMT Pay outcome:

```text
RMT → DEAD
```

Therefore standard token-gas settlement is not automatically admitted simply because RMT is technically accepted as a custom ERC-20.

Use gas **sponsorship** plus an explicit RMT dead-address transfer unless/until a custom paymaster/settlement flow is proven to terminate RMT directly at the dead address atomically.

## 12. Test account hierarchy

Package J should progress without production funds:

1. local/fork simulation of exact RMT + CCFF00 TBA behavior;
2. Robinhood testnet equivalent only if exact account/infrastructure semantics are sufficiently representative;
3. controlled mainnet read-only compatibility probes;
4. separately authorized tiny-value mainnet canary only if testnet cannot prove the exact deployed CCFF00/RMT composition.

Never use the RMT treasury/admin wallet as the test account.

## 13. Wallet matrix

Package J should produce a matrix rather than a yes/no based on one development wallet.

At minimum test the currently supported RMT connector classes that can actually own CCFF00, for example as applicable at implementation time:

```text
MetaMask extension/mobile
other admitted external EIP-1193 wallets
WalletConnect/mobile paths if currently admitted
Privy path only where current architecture permits that signer class
```

For each report:

```text
connects on 4663
owns CCFF00/TBA recognized
supports required smart-account authorization
supports atomic batch
supports sponsorship
zero-ETH proof
mobile/desktop
blocker/reason
```

Do not broaden wallet support merely for RMT Pay; test against the current gateway's supported-device acceptance list.

## 14. Success outcome

Package J should end with one of these truthful conclusions:

```text
SUPPORTED_WITH_EXISTING_WALLET_PATH
SUPPORTED_FOR_SUBSET_OF_ADMITTED_WALLETS
REQUIRES_SEPARATE_REVIEWED_WALLET_CAPABILITY
NOT_CURRENTLY_SAFE
```

`NOT_CURRENTLY_SAFE` is an acceptable result. It does not affect the existing RMT token or CCFF00 distribution architecture.

## 15. No public activation from compatibility proof

Even a successful zero-ETH burn+utility canary does not approve:

- RMT utility price;
- which utilities may use RMT Pay;
- sponsorship budget;
- public UI;
- production provider credentials;
- autonomous/session-key payment authority.

Those remain Package K/release decisions.

## 16. External capabilities must be revalidated

Provider/wallet support changes quickly. At Package J implementation time, revalidate current official documentation for:

- Robinhood Chain account-abstraction support;
- RMT's current wallet gateway;
- MetaMask smart-account/EIP-7702 support;
- Privy signer capabilities where relevant;
- Alchemy or other sponsor support on chain 4663;
- any selected EIP-5792/ERC-4337/7702 API behavior.

Do not treat August 2026 planning observations as permanent integration contracts.
