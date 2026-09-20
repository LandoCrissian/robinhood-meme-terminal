# 0x verifier trust boundary

Current authority: owner directive `RMT_TRADING_TERMINAL_COMPLETION_AUTHORITY_V1`.
Implementation base: `d2d1b8e9cb2bf7b81c53f446f8a9854801a3cf79`.

This decision replaces internal-route completeness as public execution admission.
It does not authorize merge, deployment, a live quote, signing or a transaction.
Production's latest reported failure was `UNSUPPORTED_HOOK`, Pancake Infinity at
action 3. Its packed bytes were not retained; fixtures below model the reported
structure from official encoding, not a reconstructed production transaction.

## Boundary and call graph

```text
authenticated user intent
  -> fixed server-side 0x v2 AllowanceHolder request (25 bps / sell token / treasury)
  -> quote asset/amount/recipient/economics checks
  -> canonical outer envelope + final minimum
  -> registry + explicit reviewed Settler runtime
  -> exact input action + canonical encoded RMT fee prefix
  -> route introspection (COMPLETE or PARTIAL; diagnostic only)
  -> balance / canonical allowance / gas
  -> exact RPC simulation (mandatory for swap)
  -> authenticated transaction commitment
  -> authorization rechecks commitment, input/fee/minimum and deployment
  -> existing connector-qualified, explicit user wallet submission
  -> existing receipt / settlement / recovery
```

`verifyZeroXEncodedFee` is a necessary check, never sufficient authorization.
`inspectZeroXRoute` is not invoked by commitment validation and does not authorize
anything. Its bounded reason/index/kind are retained in server verification and
authorization evidence, including the signed commitment. It has no raw provider
payload or calldata in diagnostic fields. The normal transaction commitment
continues to bind the complete exact transaction bytes.

The firm verifier does not catch an envelope failure and continue. Hard checks
run separately; failures propagate. Only the independent diagnostic parser maps
its own typed subset failure to `ROUTE_INTROSPECTION_PARTIAL`. Parser/ABI errors
are sanitized inside the inspector; this does not bypass the separate hard checks.

## Source basis for route-independent protections

Pinned official source: `0xProject/0x-settler` at
`1df908742d38cf407f667df6518dae6e04a01ac3`; current reviewed runtime remains
`0xa1a2a85048dd0f8cccc5f2012ff175b88d928c87c84e66691357842ec34e572f`.
No runtime is added, removed or selected by environment in this change. The older
explicit reviewed runtime retains its original denominator and minimum authority.

| Protection | Source and reasoning |
| --- | --- |
| Gross ERC20 input | [AllowanceHolderBase `_exec` / `transferFrom`](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/allowanceholder/AllowanceHolderBase.sol) records an ephemeral allowance keyed by operator, owner and token; every withdrawal subtracts with checked arithmetic. RMT binds all fields and the first transfer consumes the exact gross allowance into Settler. A second withdrawal cannot obtain more allowance. |
| Native input | RMT requires transaction value exactly equal to gross input and first `NATIVE_CHECK` to match. Internal routing may spend existing Settler balance, not add value to the user's wallet transaction. Accepted residual semantics are unchanged. |
| Input entrypoint | [Settler `_execute`](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/Settler.sol) permits VIP dispatch only for the first action. Later actions use ordinary dispatch. RMT retains the exact first input acquisition and rejects repeated input actions. `executeWithPermit` and meta-transactions are not admitted outer entrypoints. |
| Call authority | [Permit2Payment](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/core/Permit2Payment.sol) restricts BASIC calls into Permit2/AllowanceHolder and uses `setPayer` / `clearPayer` to reject reentrant payer entry. RMT additionally rejects direct BASIC calls to these authority contracts or Settler and direct calls withdrawing from the selected user. Internal transfers from Settler are not user withdrawals. This is not a DEX allowlist. |
| Internal hooks/routes | [RobinHood Common dispatch](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/chains/RobinHood/Common.sol) delegates to the reviewed implementations. These receive route parameters, not authority to replace the outer slippage tuple. Internal selection is trusted to authenticated 0x. |
| Final output | Settler `_execute` unconditionally calls [SettlerBase `_checkSlippageAndTransfer`](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/SettlerBase.sol) after all actions. It checks Settler's selected buy-token balance against the positive minimum and transfers to the selected recipient. A shortfall reverts the entire transaction. Internal route-local minima are not substituted for this authority. |
| Early minimum | `CHECK_SLIPPAGE` invokes the same transfer and then zeroizes the tuple. RMT still rejects that selector anywhere, even with opaque routing, preserving final post-action/post-fee protection. No other ordinary Robinhood dispatch action changes that tuple in the pinned source. |
| Simulation | Authentic runtime does not mean every byte sequence executes. Unknown-to-runtime selectors and malformed routes can revert. Exact RPC simulation remains mandatory before swap authority; provider simulation alone cannot pass it. |

These guarantees depend on the explicit reviewed runtime, not just ABI or
registry membership. A future runtime changing input/final-minimum authority
requires review. A new internal DEX or hook within that authority does not.

## Fee versus route information

The immutable API request and independently decoded input/fee prefix remain
mandatory. The canonical BASIC fee binds exact sell-token/native representation,
treasury, 25-bps proportional rate and amount patch/transfer semantics. Recognized
duplicate treasury transfers reject. An internal transfer is not classified as a
competing RMT fee merely because it uses the same proportion.
Malformed BASIC wrappers cannot conceal the structured fee scan.

Beyond that prefix, RMT does not infer that every transfer is a fee. Optional
provider fees remain separately validated and disclosed from the provider
response. Known internal fee placement/rate differences are diagnostic signals,
not a new fixed 15-bps provider-fee policy. Opaque actions do not claim independent
semantic fee certification. Actual treasury delivery and unexplained residual
remain transaction-specific settlement questions, not theoretical revenue.

## Validation interpretation

- `zero-x-trust-boundary-smoke.ts`: nine combinations of Pancake hook,
  official UNISWAPV2 unknown to the local parser, and opaque BASIC across three
  directions; hard fee/input/outer-binding mutations remain rejected.
- Actual firm-verifier tests exercise those cases through mocked deployment/RPC,
  exact simulation, commitment and authorization, plus simulation-failure denial
  and the complete existing commitment mutation matrix.
- Existing Ekubo/V4/LFJ parsing negatives are retained as partial-introspection
  assertions. Hard fee mutations are still independently asserted to throw.
- Desktop/mobile browser journeys add the three partial-introspection forms,
  require real local API verification/authorization and exact equality between
  simulated and mock-wallet transaction bytes. Existing signer, expiry,
  post-approval, recovery, duplicate and refresh assertions remain unchanged.

These are UNIT / MOCKED_INTEGRATION evidence. No live quote or wallet action is
part of this task. Owner production phone acceptance remains outstanding after
independent review and separately authorized merge/release.
