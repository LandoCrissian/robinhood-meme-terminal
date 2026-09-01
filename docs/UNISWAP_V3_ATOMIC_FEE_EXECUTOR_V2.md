# Uniswap V3 universal atomic fee executor V2

**Status: DEPLOYED / SOURCE-ADMITTED — PRODUCTION ACTIVATION NOT AUTHORIZED**

The owner has authorized the deployed V2 executor and the application source admission described here. Production execution and fee gates remain false; this document is not authorization to activate fees or open a wallet request.

`RMTUniswapV3FeeExecutorV2` is an additive, ownerless execution primitive for
the `RMT_EXECUTION_V2` policy. It does not replace or modify the historical V1
contract or its deployment evidence.

## Bound economics

- Robinhood Chain: `4663`
- RMT fee: exactly 25 basis points
- basis: trader gross input
- side: input only
- rounding: floor
- provider input: gross input minus the exact fee
- settlement: fee and swap succeed atomically or both revert
- supported inputs/outputs: native ETH and dynamically verified standard ERC20s
- supported Uniswap paths: direct or a two-leg canonical-WETH hop

The contract has no owner, upgrade, proxy, rescue, arbitrary target, or
arbitrary calldata surface. It has no per-token fee registry. Tokens with
non-exact transfer or balance behavior fail the execution rather than bypassing
the fee.

## Deployment authority and activation boundary

The existing RMT admin/deployment wallet remains
`0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA`. That identity may deploy a
reviewed bytecode artifact, but it receives no authority inside the deployed V2
executor.

The deployed executor is `0xef729FbC9aDfC431ae46ECc198144160e2dD7832`, runtime hash
`0xed8ec8cd44f2c228044678358bb7c4565953067ceab42319b169358354b9693d`,
and its immutable policy begins at block `51296658`. The source provider registry admits only
this version-explicit V2 lane. The server admission gate defaults false, and Production wallet
authorization remains disabled.

Future activation requires all of the following exact server configuration:

- an active, hash-matched `RMT_EXECUTION_V2` policy;
- `RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_ENABLED=true`;
- `RMT_VNEXT_UNISWAP_V3_V2_AUTHORIZATION_ENABLED=true`;
- an exact executor address and runtime hash;
- onchain immutable and runtime verification for Router02, factory, WETH proxy,
  WETH implementation, treasury, policy hash, and policy boundary;
- the ordinary global wallet authorization and submission gates.

Missing, partial, or mismatched configuration remains quote-only. There is no
direct Router02 wallet fallback.

## Wallet authority

ERC20 approvals target the V2 executor for exactly the trader's gross input.
The swap transaction targets the V2 executor, never Router02. The authorization
binds the execution ID, policy, treasury, trader, requested and routed assets,
gross input, fee, provider input, protected output, deadline, route, pool set,
and calldata hash.

Native output is received as canonical WETH by the executor, unwrapped exactly,
and sent only to the bound trader. Successful execution leaves no execution
input, output token, WETH, or ETH residue and resets the Router02 allowance to
zero.
