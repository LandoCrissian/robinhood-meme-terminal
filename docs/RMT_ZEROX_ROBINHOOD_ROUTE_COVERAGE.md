# Robinhood 0x route grammar review

Scope: owner instruction `RMT_ROBINHOOD_ZEROX_OFFICIAL_ROUTE_COVERAGE_V1`,
base `41b8e24f276f12fa739376488b192fc55912bbd0`. This is source and deterministic
test evidence, not deployment, funded execution, or settlement acceptance.

## Evidence and limits

The consumed PR534 observation (head `365d5eeb0f584cfe8a08b47b8fa0e407fb53ec1f`)
returned a 1 USDG -> CANNACAT firm quote, HTTP 200. Registered Settler
`0x6aa80DbBed9ae5aB45FbF61f9644faDA3b29326E` had the already admitted runtime
`0xa1a2a85048dd0f8cccc5f2012ff175b88d928c87c84e66691357842ec34e572f` at block
67604702, hash `0xa4176ac01fd31ec954d9b9b38da1c672ad787eccf878ac3a1d9f21889fa2001c`.
The first rejection was `verifyZeroXEncodedFee / UNSUPPORTED_ACTION / 3 /
0xf61460f9` (EKUBOV3). Calldata hash:
`0x9e23898c4ce419e23b5613f7575194e617d3d83e50e276e5177e06328c084372`.

Retained structure: TRANSFER_FROM, BASIC 2500 ppm RMT fee, BASIC 1500 ppm provider
fee, EKUBOV3, BASIC native/WETH deposit, BASIC WETH withdrawal, UNISWAPV4,
POSITIVE_SLIPPAGE. Global final minimum: `31009640941863753285133` CANNACAT atoms.
The V4 inspector reported hook-related content. It did not retain exact hook,
hook data, Ekubo extension/configuration, packed fills or hash parameters.
Consequently the regression preserves the observed structure and minimum but
uses explicitly synthetic, official-format packed values. It is **not** a
byte-for-byte replay, proof of a particular hook, or guarantee that an omitted
Ekubo extension is admitted. The original owner's lost quote is not reconstructed.

## Pinned source authority

All Settler links below refer to official commit
`1df908742d38cf407f667df6518dae6e04a01ac3`, the already reproduced runtime.

- [RobinHood/Common.sol](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/chains/RobinHood/Common.sol)
- [RobinHood/TakerSubmitted.sol](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/chains/RobinHood/TakerSubmitted.sol)
- [action ABI](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/ISettlerActions.sol)
- [EkuboV3](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/core/EkuboV3.sol)
- [UniswapV4](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/core/UniswapV4.sol)
- [FlashAccountingCommon](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/core/FlashAccountingCommon.sol)
- [Permit2Payment](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/core/Permit2Payment.sol)
- [BASIC](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/core/Basic.sol)
- [Settler final transfer](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/Settler.sol)

Source history includes `5d186c48` (bps -> ppm, widened fill fields),
`5d3f46ec` (Ekubo V3 forwarding calldata length), `9504e4a6` (Orvex CL),
`aaf1eab8` (Hanji), `0c6fc133` (Bebop), and `3c6b33e7` (Alandale).
The parser uses three-byte proportions and Ekubo bit 23, not bps-era widths.

## External invariants and callback authority

The acquisition action remains first and exact: gross ERC20 through canonical
AllowanceHolder to Settler, or exact native transaction value. Fee position 1
remains the canonical 25-bps sell-asset fee, followed by a separately disclosed
provider fee where applicable. No second TRANSFER_FROM or VIP action is accepted.

Normal Ekubo/V4 `Encoder.encode` sets payer to Settler itself. The authenticated
callback is installed for the fixed CORE/PoolManager and selector;
`getAndClearCallback` checks this binding. `takerSubmitted` sets a transient payer
guard which rejects reentrant execute. The normal payment branch transfers
Settler-held funds, not a new user allowance. Holder's ephemeral authority is
scoped to operator/user/token/gross amount. Hook calldata cannot replace that
authority or change the outer execute recipient, buy asset, or minimum.

V4 uses the runtime-pinned Robinhood PoolManager
`0x8366a39CC670B4001A1121B8F6A443A643e40951`. Per-fill actual debit is subtracted
with checked arithmetic from route credit; negative buy credit rejects. Hook
returns may change internal execution economics within that credit. This is not
an extra user withdrawal. The callback takes output to the action recipient,
which RMT binds to Settler. Other route credits are returned to Settler. The final
execute check transfers the selected buy asset to the exact user **after every
action and fee**, reverting if the global protected minimum is not met. Exact
RPC simulation and committed transaction verification remain mandatory.

Thus V4 hooks are admitted as PoolManager-mediated swap callbacks, not generic
Settler calls. Nonzero hooks and bounded opaque hook data are supported. Invalid
permission combinations/PoolKeys/truncated data reject. RMT does not attest a
hook's profitability or reproduce its DEX pricing; output protection is the
reviewed final minimum. Uniswap's [hook permission rules](https://github.com/Uniswap/v4-core/blob/main/src/libraries/Hooks.sol)
provide corroborating ABI semantics; admission primarily relies on the pinned
Settler debit/payment/recipient guards, not unpinned upstream source identity.

Ekubo CORE is runtime-fixed at `0x00000000000014aA86C5d3c41765bb24e11bd701`.
Its checked debit is bounded by both requested proportion and available credit.
The parser handles 12-byte sqrt ratio, all four token packing keys, 32-byte pool
config and explicit native sentinel mapping. Config interpretation follows the
[exact upstream revision referenced by 0x](https://github.com/EkuboProtocol/evm-contracts/blob/81c2c2642afe321e7f5d7de70f8b3be18f6f80b3/src/types/poolConfig.sol):
extension, uint64 fee, concentrated/stableswap type bits. Config is not simply
"tick spacing". Zero-extension normal CORE swaps are supported. Nonzero
extensions and forwarding remain `UNKNOWN` and reject explicitly: forwarding
return data is extension-defined, and the proof omitted the extension. No
address-only or selector-only extension admission is introduced.

## Packed and routing bounds

Parsers consume every byte, bound 16 fills/action, 8 token identities/action,
32 routing actions/envelope, 8192 hook-data bytes/fill and 65536 packed bytes.
They enforce nonzero <=1,000,000 proportions, packing-key rules, nonzero token
representation, non-self swaps and prior credit provenance. Pool identities are
the decoded ordered currency pair plus full pool config/PoolKey. They are not
caller-selected pool contracts. Hash arguments fit the actual scaled uint128
encoding; onchain NotesLib additionally rejects hash collisions.

Routes may compose and split through known acquired/produced currencies; they
need not fit one routing action. Canonical BASIC deposit/withdraw has fixed WETH,
selector, amount-patch offset 4, zero placeholder and full balance proportion.
It only changes native/WETH representation inside Settler, never a recipient or
user withdrawal. Arbitrary BASIC transfers/calls remain rejected in routing.

## Complete inherited action inventory

"Supported" below means RMT's explicit bounded form, not all possible arguments.
Contract reachability is not proof the public API emits every listed action.
No additional live quote was requested for this inventory.

| Action / entrypoint | RMT classification | Current public-path evidence / remaining boundary |
| --- | --- | --- |
| execute | SUPPORTED_VERIFIED | Existing taker envelope and final minimum |
| NATIVE_CHECK | SUPPORTED_VERIFIED | First native acquisition guard |
| TRANSFER_FROM | SUPPORTED_VERIFIED | First exact holder acquisition only; empty signature |
| BASIC | SUPPORTED_VERIFIED (bounded) | RMT/provider fee and canonical wrap/unwrap; generic calls UNKNOWN and rejected |
| UNISWAPV3 | SUPPORTED_VERIFIED | Existing path; source resolves nine Robinhood forks |
| EKUBOV3 | SUPPORTED_VERIFIED (zero extension) | Actual observed selector; forwarding/nonzero extension UNKNOWN |
| UNISWAPV4 | SUPPORTED_VERIFIED | Actual observed selector; manager-mediated bounded hooks supported |
| PANCAKE_INFINITY | SUPPORTED_VERIFIED (bounded) | Existing hook-free Orvex CL; BIN is unsupported by Robinhood runtime; hooks UNKNOWN |
| POSITIVE_SLIPPAGE | SUPPORTED_VERIFIED | Buy-asset tail above expected output; final minimum still applies |
| UNISWAPV2 | UNKNOWN | SettlerBase-reachable; pool/swapInfo semantics not admitted by this patch |
| VELODROME | UNKNOWN | SettlerBase-reachable; no observed Robinhood quote in retained evidence |
| RFQ | UNKNOWN | Maker signature/order semantics require explicit support; source capability only |
| HANJI | UNKNOWN | Robinhood Common-reachable; scaling/orderbook/pool binding requires explicit review |
| BEBOP | UNKNOWN | Robinhood Common-reachable; signed order/basket semantics require explicit review |
| CHECK_SLIPPAGE | UNSAFE_FOR_RMT | Early transfer invalidates final-only minimum interpretation; rejected |
| RFQ_VIP, UNISWAPV3_VIP, EKUBOV3_VIP, UNISWAPV4_VIP, PANCAKE_INFINITY_VIP | NOT_USED_BY_PUBLIC_SWAP_PATH (RMT fee prefix) | Source first-action capability; RMT requires acquisition then fee, not VIP acquisition+swap |
| executeWithPermit, meta/intents, chain-specific actions absent from inheritance | NOT_USED_BY_PUBLIC_SWAP_PATH | Not the admitted execute envelope/runtime surface |

Next route coverage priorities are normal UNISWAPV2, HANJI and BEBOP, then RFQ,
Velodrome and extension forms with evidence. Their `UNKNOWN` status is explicit;
this PR does not claim universal API route coverage or reactivate direct DEX
executors. All actions still execute solely through zero-x-swap.

## Validation and release limits

New tests exercise packed truncations at every byte, rate/key/pool/hook failures,
extension rejection, wrap/unwrap target/selector/offset constraints, fee mutations,
extra withdrawals and composed routes. The actual firm verifier receives the
synthetic eight-action CANNACAT envelope through mocked provider/RPC boundaries.
The retained positive-slippage threshold is not necessarily quote `buyAmount`;
the firm fixture uses an explicit slippage-consistent synthetic buyAmount.

These tests are UNIT/MOCKED_INTEGRATION, not a real DEX simulation or owner trade.
PR533 diagnostics are included; PR534 private proof machinery is not. Both old
PRs remain unmerged. Preserve the proof artifacts before retiring them after
review. Production release and owner phone retry require separate authorization.
