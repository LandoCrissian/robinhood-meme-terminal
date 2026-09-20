# 0x AllowanceHolder public execution source boundary

## Current owner decision: provider-native fee and reachable balance

Authority: `RMT_PROVIDER_NATIVE_REACHABLE_BALANCE_DECISION_V1`, following
`RMT_EXECUTION_VERIFICATION_POLICY_SIMPLIFICATION_V1`; implementation base
`aefc2a2fb4da7a38213e9fecd58914577b560858`. This section supersedes historical
half-up atomic equality and zero-residual requirements for public 0x execution.
It does not authorize deployment, a wallet action, or settlement acceptance.

Current fee-asset authority: `RMT_FINAL_TRADING_ECONOMICS_QUOTE_AND_SPEED_PASS_V1`.
The request is `swapFeeBps=25`, `swapFeeToken=zeroXFeeAsset(sell,buy)`, and
`swapFeeRecipient=0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC` through Swap API v2
AllowanceHolder on chain 4663. [Official fee documentation](https://docs.0x.org/evm/0x-swap-api/guides/monetize-your-app-using-swap)
defines the percentage request and separately returned fee disclosure. The
reviewed contract's percentage arithmetic governs executable fees. Quoted atomic
amounts and the zero-residual floor estimate are not an execution equality gate.
Historical reports retain their historical half-up policy, not current authority.

For ordinary project trades, USDG on either side pays the fee in USDG; otherwise
native ETH on either side pays it in native ETH. Base/base and project/project
retain the existing sell-token fallback. WETH is not native ETH. One deterministic
helper owns selection. Output fee amounts are provider-returned output units,
never gross-input arithmetic. Gross input, exact approval and native value remain
bound to the sell asset independently of fee denomination. The legacy serialized
`PROVIDER_NATIVE_INPUT_FEE` discriminator is retained for compatibility; it does
not imply that feeAsset equals inputAsset. See [implementation and measurements](TRADING_ECONOMICS_QUOTE_SPEED.md).

### Explicit runtime and action review

The reviewed runtime table contains exactly:

| Official source commit | Ethereum runtime keccak256 | Action denominator |
| --- | --- | --- |
| `95184a23336b52d99aaa528c5b1259e3bb04eafe` | `0xb6c0bf3b83bc9ae4f6ed65a4f5f6c188eb3e4258d8d3b3705dff4ac02ed4a966` | 10,000 |
| `1df908742d38cf407f667df6518dae6e04a01ac3` | `0xa1a2a85048dd0f8cccc5f2012ff175b88d928c87c84e66691357842ec34e572f` | 1,000,000 |

The second runtime was reproduced byte-for-byte (19,872 bytes) from official
source and pinned dependencies using the published flatten ordering/names:
solc `0.8.34+commit.80d5c536`, viaIR, optimizer 2,000 runs, Osaka, no appended
CBOR/bytecode metadata, no links or runtime immutables. Plain multi-file output
was not the matching build; the source flattening transformation matters.
The retained runtime fixture is checked with Ethereum keccak256. Registry
current/previous eligibility and pause behavior remain necessary at verification
and authorization; registry membership alone never admits a runtime.

### Current owner trust boundary

Authority: `RMT_TRADING_TERMINAL_COMPLETION_AUTHORITY_V1`, implementation base
`d2d1b8e9cb2bf7b81c53f446f8a9854801a3cf79`. This supersedes route-subset admission
in earlier reviews. 0x owns internal routing, DEX/pool selection, intermediate
assets, splits and hooks. RMT owns hard external transaction invariants.

Mandatory checks remain:

1. The firm response comes from the fixed server-side Swap API v2 AllowanceHolder
   path with chain 4663, exact assets/gross amount/user recipient and the canonical
   25-bps direction-aware base-currency treasury request. No browser-supplied transaction is trusted.
2. Registry eligibility, explicit reviewed runtime, canonical AllowanceHolder and
   its runtime remain checked. An API-returned address is not sufficient authority.
3. The outer canonical `exec`/`execute` envelope binds exact value or gross token
   allowance/operator, selected buy asset, user recipient and positive minimum.
   The first action binds native value or the exact ERC20 gross transfer to Settler.
4. The single canonical BASIC fee binds the selected fee asset, treasury, 25 bps
   and reviewed transfer/amount-patch semantics. Input fees retain index 1; output
   fees occur in the action sequence before the outer final minimum/transfer. Recognizable duplicate treasury transfers reject; another destination is not
   classified as a competing RMT fee from its proportion alone. Provider fee disclosure remains separate;
   internal transfers are not automatically fees or settled revenue.
5. Early `CHECK_SLIPPAGE` remains rejected because it zeroizes the outer tuple.
   Additional input actions and BASIC calls into input-authority contracts reject.
6. Exact RPC simulation, quote freshness, HMAC transaction commitment, exact
   connector-qualified signer, post-approval verification and recovery remain hard.

`inspectZeroXRoute` retains V3, Ekubo, V4, Pancake and LFJ/wrap/unwrap parsers as
non-authoritative diagnostics. Unsupported actions/routes/hooks, intermediate
asset paths and parser limits yield `ROUTE_INTROSPECTION_PARTIAL`, not a fee or
execution failure. The hard verifier does not catch and ignore these failures;
it no longer depends on the internal-route parser. The partial status does not
prove an action is supported by the runtime: an actual unsupported opcode/action
still reverts during required exact simulation. New runtimes still need review.

The final minimum is obtained from the outer reviewed entrypoint, independently
of internal routing. See [trust-boundary source proof and tests](ZEROX_VERIFIER_TRUST_BOUNDARY.md).

### Residual balance and settlement limits

The owner accepts ordinary donated/pre-existing Settler balances participating in
the reviewed percentage fee. A local isolated EVM test with retained Settler and
AllowanceHolder bytecode confirms the native example: gross `1000000000000000`
wei plus an ordinary 400-wei donation yields treasury inflow `2500000000001` wei.
The extra wei comes from prior Settler funds; authorized user input stays fixed.
Mock ERC20/output routes provide analogous deterministic input-bound tests; these
are not funded route or production acceptance proofs.

Treasury inflow is not automatically user-generated trading revenue. A future
transaction-specific reconciliation must distinguish user output, provider fees,
integrator-fee attribution and unrelated residual where technically possible.
Unexplained surplus must not fund community distribution. Neither quoted fee,
encoded percentage nor receipt success constitutes verified settlement.

`zero-x-provider-native-fee-smoke.ts` and the actual firm-verifier smoke cover both
runtime profiles, three directions, rounding/donation acceptance and adversarial
fee/envelope mutations. These are local/mocked evidence. Retained live structural
records do not contain full routing payloads, so they do not establish that every
current provider route will simulate successfully. Internal grammar completeness
is no longer an execution gate. Controlled
acceptance after independent review must exercise the exact deployed path.

## Owner Option B clarification

Policy review base: `de3cadfebd15c8c2103ec109d44de80e6b041168`.

0x Swap API v2 AllowanceHolder flow only, including the documented native ETH
Settler entrypoint exception. The exception does not authorize a standalone
Settler route, caller-selected target, or direct Settler public executor.

The API route, allowance spender, outer transaction target and encoded execution
target are distinct authorities. The server constructs `/swap/allowance-holder/quote`
with version `v2`; a caller cannot select a different API route or transaction.
For ERC20 input, the spender is the canonical AllowanceHolder
`0x0000000000001fF3684f28c67538d4D072C22734`, approval is exactly gross input,
and the swap outer target remains that runtime-verified AllowanceHolder.
The approval transaction itself targets the input token, never Settler.

For native input, no ERC20 approval action is created. A provider-returned native
Settler outer entrypoint is eligible only through the same AllowanceHolder API
flow and existing registry eligibility, pause, reviewed runtime and decoder
checks. Calldata, native value equal to input, recipient, assets and final encoded
minimum remain independently verified. The full firm evidence is commitment-bound;
authorization rechecks deployment authority and wallet review recomputes the saved
envelope. An encoded inner Settler inside an AllowanceHolder envelope is not a
separate public executor. Native evidence's legacy `approvalSpender` metadata is
not approval authority: `approvalRequired=false`, `approvalKind=null` and firm
`allowanceTarget=null` are required for the native swap tested here.

Permit2, Gasless, historical providers, standalone Settler routes and caller-selected
targets remain non-executable. Option B admits no new runtime and changes no fee,
authorization, wallet or settlement behavior. Existing runtime incompatibility
continues to fail closed; policy permission is not live quote or execution proof.

### Option B regression evidence

- `zero-x-firm-quote-verifier-smoke.ts`: fixed API route for every fixture request;
  ERC20 spender/target controls; native ETH to ERC20 and USDG; malformed or untrusted
  native envelopes; no native approval; existing exact runtime policy.
- `zero-x-executable-slippage-smoke.ts`: native value, recipient, asset and final
  executable minimum decoding, including rejection of early slippage actions.
- `zero-x-firm-quote-commitment-smoke.ts`: reused for both native output fixtures;
  altered evidence, binding, amount, protected floor, expiration and context reject.
- `zero-x-wallet-authorization-smoke.ts`: exact saved envelope recomputation and
  adversarial plan/fee/provider/approval mutations, also exercised for native input.
- `public-authorization-negative-smoke.ts`: strict caller request schema plus the
  existing awaited 32 actual authorization-route rejection cases. Schema checks do
  not substitute for authentication or positive route authorization evidence.

The helper smokes run through `zero-x-adapter-smoke.ts`; they must not be counted as
executed by merely loading their export-only modules. All RPC, provider, signer,
journal and transaction responses in these fixtures are mocked. This is source/test
conformance, not a live provider quote, real simulation, treasury settlement proof or
Production conformance. Production serves a different SHA and needs a separately
authorized deployment decision; this document authorizes none.

Official native-entrypoint distinction:
https://docs.0x.org/docs/upgrading/upgrading-to-swap-v2 and
https://docs.0x.org/docs/core-concepts/contracts.

## Original implementation record

Authorized base: `a94400d1a201a9423424e6cde78ca1fe83ca9390`.

This implementation is source-only. It does not activate Production, deploy,
sign, submit transactions, modify configuration, or merge a release.

## Initial public execution target

`ZERO_X_ONLY` means the exact public provider list `zero-x-swap`, configured
through the existing `RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS` boundary. Combining
0x with any other provider fails public admission. Existing V2/V3 release
authorities remain preserved and are not launch prerequisites for this scope.

The existing 0x adapter and firm verifier use Swap API v2 AllowanceHolder on
Robinhood Chain, chain ID 4663. Both price and quote requests bind the immutable
25-bps sell-token integrator fee to
`0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC`. Native ETH stays zeroAddress inside
RMT and uses the documented native sentinel only at the API boundary.

Exactly one integrator fee is required. Singular/plural aliases are not added
together. Provider fees are disclosed separately and are not treasury revenue.
The existing settlement union has one provider-specific extension:
`PROVIDER_NATIVE_INPUT_FEE`. It requires no custom executor implementation ID
or Solidity settlement evidence. Custom executor admission is not relaxed.

## Wallet authority and recovery

Each authorization fetches a fresh quote and validates its exact economics,
assets, recipient, target code, gas, value, fee request bindings and protected
output. ERC20 balances and allowance are independently read from chain.
ERC20 approval targets must match the configured, runtime-verified
AllowanceHolder; approval is exactly gross sellAmount. Native ETH has no
approval, and its balance check uses transaction.value plus validated gas.

Swap authorization requires both complete provider simulation and RMT's exact
local eth_call. The client binds the same from/to/data/value/gas/gasPrice
envelope. Firm identity includes the economic, target, runtime, approval,
simulation and expiration evidence. Approval receipt confirmation invalidates
the old swap quote; no provider fallback occurs during authorization.

Quote expiry is a local authorization limit, not a claim that opaque provider
calldata enforces an RMT deadline onchain. Recovery does not infer safe
non-submission for an unanswered 0x wallet request from that local deadline.
Receipts retain quoted integrator/provider fees separately. Successful receipt
status alone is not represented as transfer-level fee reconciliation, and an
internal WETH withdrawal is not proof of native ETH delivery to the user.

## Source gates

The existing global wallet gates remain required. The 0x rail also requires:

- `RMT_VNEXT_ZEROX_OBSERVATION_ENABLED=true`
- `RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED=true`
- server-only `RMT_ZEROX_API_KEY`
- verified `RMT_ZEROX_ALLOWANCE_HOLDER` and `RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH`
- exact `RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS=zero-x-swap`

No production values are set by this source change. Gasless remains quote-only.
Cross-chain, Stock Token execution, new providers, Solidity and deployments
are out of scope.

## Reproducible proof

Focused 0x coverage runs through the existing adapter smoke command:

```sh
pnpm --filter web exec tsx lib/vnext/zero-x-adapter-smoke.ts
pnpm --filter web proof:zero-x:read-only
```

The read-only proof accepts the server-side key from the process or an ignored
`apps/web/.env.local`. It performs only chain identity reads and 0x price/quote
GETs for native ETH/USDG and USDG/native ETH with the exact fee parameters.
It emits sanitized economics and calldata hashes, never credentials, and
cannot sign, approve or submit. Missing credentials or invalid economics fail
closed. A sensitive Preview-only Vercel key is configured, but Vercel does not
return its plaintext through env-run or the authenticated secret-read API.
The live proof remains an owner-review blocker until that existing credential
is made available locally; local tests are not a substitute for live proof.

Official authority: [0x contracts](https://docs.0x.org/docs/core-concepts/contracts),
[Swap v2](https://docs.0x.org/docs/upgrading/upgrading-to-swap-v2),
[supported chains](https://docs.0x.org/docs/introduction/supported-chains).
