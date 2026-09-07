# 0x executable slippage calibration (chain 4663)

RMT base: `510a6e312769bbfd2ab8240380208db40e17738e`.
Read-only observation date: 2026-09-07 UTC. No signing, approvals or broadcasts.

## Runtime and global authority

Outer target: `0x0000000000001fF3684f28c67538d4D072C22734`, AllowanceHolder.
Runtime keccak256: `0x99f5e8edaceacfdd183eb5f1da8a7757b322495b80cf7928db289a1b1a09f799`.
Entrypoint: `exec(address,address,uint256,address,bytes)`, selector `0x2213bc0b`.

Forwarded target: `0x39b38686A19836Ac10162c490E4558e120CbBE5f`, RobinHoodSettler.
Runtime keccak256: `0xb6c0bf3b83bc9ae4f6ed65a4f5f6c188eb3e4258d8d3b3705dff4ac02ed4a966`.
Entrypoint: `execute((address,address,uint256),bytes[],bytes32)`, selector `0x1fff991f`.
Both Sourcify onchain AND recompiled bytecode hashes matched RPC runtime.
The deployment GitCommit event identifies official 0x commit
`95184a23336b52d99aaa528c5b1259e3bb04eafe`.

Sources:
- https://sourcify.dev/server/v2/contract/4663/0x39b38686A19836Ac10162c490E4558e120CbBE5f?fields=all
- https://sourcify.dev/server/v2/contract/4663/0x0000000000001fF3684f28c67538d4D072C22734?fields=all
- https://github.com/0xProject/0x-settler/blob/95184a23336b52d99aaa528c5b1259e3bb04eafe/src/Settler.sol
- https://github.com/0xProject/0x-settler/blob/95184a23336b52d99aaa528c5b1259e3bb04eafe/src/SettlerBase.sol

AllowanceHolder forwards the exact native value and authenticated sender. Settler
runs its global balance/minimum check and recipient transfer AFTER all actions,
including the provider fee and positive-slippage action. Observed UNISWAPV3 and
EKUBOV3 legs pay Settler and have zero leg minima; those are NOT the user minimum.
RMT's native fee action is BASIC with 25/10000 of native input to the exact RMT
treasury before routing. All observed token-tax metadata was zero.

The decoder requires positive, recipient/buy-token-bound global authority and the
independently verified Settler runtime. Early CHECK_SLIPPAGE actions are not
admitted: the accepted floor must be the final post-fee global check. Unknown
runtime versions fail closed, rather than inheriting authority from their ABI.
This is not a new executor or a change to public provider scope.

## Calibration

All requests: 0.001 ETH -> USDG, gross input 1000000000000000, owner taker/recipient,
25-bps native-sell-token RMT fee, exact treasury. No raw live calldata was persisted.
Each PPM request omitted slippageBps. Integer multiplication determined pass/fail.

| Provider request PPM | Firm samples | Maximum executable loss PPM | Exact 1% bound |
| --- | ---: | ---: | --- |
| 10000 | 4 | 10001.000100010 | FAIL |
| 9999 | 4 | 10001.000100010 | FAIL |
| 9900 | 4 | 9897.030890732 | PASS |
| 9750 | 4 | 9797.060881735 | PASS |
| 9500 | 4 | 9497.150854743 | PASS |
| 9000 | 4 | 8997.300809757 | PASS |

All 24 exact eth_call simulations passed. Simulation success alone is not slippage
admission. The API minimum equalled the encoded global minimum in these samples.
A failing sample: expected 2499750, reported/encoded minimum 2474750; the exact
minimum integer satisfying 1% is 2474753. Calldata hash:
`0xc3fcef266b2a0858a91b744d37043e4a74273338a7e920f770033644f91311c3`.

Classification: ZERO_X_EXECUTABLE_MIN_TOO_WEAK, not API-only presentation rounding.
Selected provider request: 9900 PPM, the highest passing candidate. Four observations
are calibration evidence, not a guarantee about future provider behavior. Every
future verified transaction must independently satisfy the exact integer guard:

`executableMinimum * 1000000 >= expectedOutput * 990000`

The commitment binds BOTH minima, both policies, the decoded execution target/runtime,
and all existing wallet/fee/calldata/freshness authority. Authorization does not
request a second independent firm quote. Minimum receive uses executable authority.

Confirmed USDG balance remains 4953334 atomic. Live 1-USDG approval/rejection testing
is funded, but must wait for owner merge and isolated Preview deployment of this
repair. This task does not update Preview or Production.
