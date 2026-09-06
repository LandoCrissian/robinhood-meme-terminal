# 0x AllowanceHolder public execution source boundary

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
