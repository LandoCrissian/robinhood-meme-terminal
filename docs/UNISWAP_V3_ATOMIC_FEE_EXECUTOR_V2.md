# Uniswap V3 universal atomic fee executor V2

**Status: DORMANT / PRESERVED IMPLEMENTATION REFERENCE — NOT CURRENT OWNER POLICY**

Current owner product policy is `RMT_FEE = 0`. This document records prior V2 design and implementation evidence; it is not current roadmap authority, a Terminal completion prerequisite or authorization to deploy or activate fees.

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

This tranche selects no Production treasury, effective block, executor
address, or runtime hash. The default provider settlement registry remains
`QUOTE_ONLY`, and the exported Production Uniswap adapter keeps wallet
authorization disabled.

Future activation requires all of the following exact server configuration:

- an active, hash-matched `RMT_EXECUTION_V2` policy;
- `RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_ENABLED=true`;
- an exact executor address and runtime hash;
- onchain immutable and runtime verification for Router02, factory, WETH proxy,
  WETH implementation, treasury, policy hash, and policy boundary;
- a separately reviewed settlement-registry admission.

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
