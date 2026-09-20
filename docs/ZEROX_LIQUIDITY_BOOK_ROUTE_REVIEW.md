# Reviewed Liquidity Book BASIC routing

Date: 2026-09-20. Base: `b51985182cdfc5b4192afaf3cbeb3e881993da83`.
Scope: explicit internal routing in the existing 0x provider; no new public
executor, runtime admission, wallet spender, fee policy or settlement authority.

## Retained live evidence

One authorized PR536 observation at `8d146dd1cb770d6f9d60afb73da03a92ca0fbccb`
returned HTTP 200 for 1 USDG -> CANNACAT on chain 4663. The admitted Settler was
`0x6aa80DbBed9ae5aB45FbF61f9644faDA3b29326E`, runtime
`0xa1a2a85048dd0f8cccc5f2012ff175b88d928c87c84e66691357842ec34e572f`.
Block 67704875: `0x2ea027d7bb464eb27d9401ce1577e04fcdbb3193a4d06b5b279181012505c5c5`.
Calldata hash: `0xd5cf5a23fc5f5aa958acc4c852cae5247dc97c5c49b4329df1b9a26c724abf1d`.

Ordered actions: TRANSFER_FROM, BASIC, BASIC, BASIC, BASIC, UNISWAPV4,
POSITIVE_SLIPPAGE. Index 3 rejected with UNSUPPORTED_ROUTE in
verifyZeroXEncodedFee. Its nested selector is `0x6d0ff495`, 356 bytes,
amount patch offset 4, proportion 1000000/1000000, USDG input, zero call value.
The target's lowercase-address SHA-256 is
`69df7b01f2945d89c99585bf4b580e18ff95f05d11a38dbee51cd3015fa5d387`.
It resolves exactly to `0x4463c6f5BaDE414eC5E34D94245ec0F55C4d8B51`.
No user address or raw calldata is retained in the evidence.

The proof did NOT retain the nested path, recipient, deadline, or bin steps.
Tests reproduce the observed structural shape with explicitly synthetic,
source-derived arguments. They do not establish that every omitted argument
in that historical quote satisfies the new gate. Its exact simulation did not
run after the grammar rejection; a local mocked pass is not live acceptance.

## Source and build provenance

- [Official LFJ v2.0.0 router](https://github.com/lfj-gg/joe-v2/blob/07f10212e2de6abc97932240c27388c14868582c/src/LBRouter.sol).
- [Published complete target source](https://robinhoodchain.blockscout.com/address/0x4463c6f5BaDE414eC5E34D94245ec0F55C4d8B51?tab=contract).
- [Official 0x BASIC implementation](https://github.com/0xProject/0x-settler/blob/1df908742d38cf407f667df6518dae6e04a01ac3/src/core/Basic.sol).

All 23 LFJ files exactly match commit
`07f10212e2de6abc97932240c27388c14868582c`. Both OpenZeppelin interfaces
exactly match submodule `109778c17c7020618ea4e035efb9f0f9b82d43ca`.
Compiler 0.8.10+commit.fc410830, optimizer 800, viaIR false, London,
IPFS metadata, literal content false, no linked libraries. Compiler binary
Ethereum keccak256: `0x1089a195a97531976e0c2b12881e4a1cb9261c9703f784d7466bc5c1b64bea4e`.
The explorer's standard-JSON settings/remappings and all 25 official source
files reproduce the complete published runtime after constructor immutables:

- factory: `0xeA982d35EE551CD143538c3ACaE7e1EdB72Cc396`
- oldFactory: `0xaA54136961dA66CAB0198A1A5f89fcD1cAfEa17b`
- wavax (Robinhood WETH): `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`

22,857 runtime bytes; Ethereum keccak256
`0x712d794f5107db0db7587c83d84a16bf068611abbf269925a0cd7df29d6f100c`.
This is a full independent build match to explorer-published deployed bytes,
not an additional RPC observation pinned to the quote block. The router is
non-proxy, has no delegatecall or selfdestruct, and immutable factory bindings.
Do not infer the deployment operator's brand from ABI similarity. The proven
integration family is LFJ v2.0.0 Liquidity Book, used by the observed 0x quote.

## Reviewed authority

`swapExactTokensForTokens(uint256,uint256,uint256[],address[],address,uint256)`
is nonpayable. BASIC replaces only its first argument with
floor(current Settler token balance * proportion / 1000000). The router calls
`tokenPath[0].safeTransferFrom(msg.sender, firstPair, amountIn)`; msg.sender is
the Settler. There is no encoded payer, second user withdrawal, Permit2 request,
arbitrary pair address, hook or callback payload. Settler grants the internal
token approval; the user's exact approval remains to AllowanceHolder only.

The router resolves every adjacent pair from its immutable factories. Zero bin
step selects its legacy factory; nonzero selects Liquidity Book. Intermediate
output goes to the next resolved pair, and final output to the encoded `to`.
Admission requires `to == quoted Settler`; the final global Settler check still
binds the user's recipient, selected buy asset and protected output minimum.
The router enforces its own deadline and amountOutMin as additional checks.
Its overwritten amount literal is not another input authority.

The explicit gate requires the reviewed target, exact selector, canonical ABI,
offset 4, positive proportion <= 1000000, non-native input matching the path,
available route input, 1..16 hops, matching array lengths, uint16 bin steps,
nonzero/non-native path currencies, no adjacent self-swap, nonzero deadline,
and Settler recipient. Native output requires the separately reviewed WETH
withdrawal action. No arbitrary BASIC or alternate deployment is admitted.
The pre-routing RMT and provider fee checks and final minimum check are unchanged.

## Validation limits

Deterministic tests cover the current seven-action shape, composed unwrap/V4
output, multi-hop/legacy-factory family paths, overwritten literal values,
proportions, malformed/truncated calls, path/target/recipient/patch mutations,
extra withdrawal/actions, fees, final minimum, actual firm verification and
committed authorization. Provider, RPC and wallet boundaries are mocked.
No new production quote, deployment, wallet action or settlement is implied by
this repair. PR536 remains unmerged; temporary proof machinery is excluded.
