# Exact V4 settlement trace and arithmetic checks

The 4663 review build retains the 12 funding, graduation and harvest highs and four dependency highs. This follow-up adds bytecode-level call evidence for the already-pinned runtime graph and an independent arithmetic oracle for the exact dependency sources. Independent disposition and the failed release gate remain open. [Active finding matrix](../fixed-supply-security/findings.md) · [Source and dependency manifest](../fixed-supply-security/4663-profile.json)

## Fork call graph

The 4663 fixture verifies the dependency runtime hashes and the compiled engine, guard and token runtimes before the receipts are accepted. The review tool then obtains a bounded `callTracer` tree for each successful graduation and fee collection from the same loopback Anvil instance. It compares every ordinary call and creation frame by depth, caller, target, full calldata hash and ETH value. Static reads can nest only within the known contract set. Disconnected frames, failed frames, unknown operations and unauthorized read targets fail the run. The evidence is linked to locally verified transaction and block hashes. [Trace verifier](../../../packages/contracts/scripts/prove-fixed-supply-settlement-trace.mjs) · [Harness](../../../packages/contracts/scripts/rehearse-fixed-supply-4663.mjs)

| Reviewed boundary | Trace assertion |
| --- | --- |
| Curve graduation and v4 funding, 11 high rows | The curve grants and clears only the remaining inventory allowance. The engine deploys the exact per-project fee ledger, initializes through its bound hook, pulls only the intended token amount and grants exactly the finite Permit2 amount. PositionManager receives only the exact `MINT_POSITION` and `SETTLE_PAIR` payload, consumes the intended ETH and token amounts, and routes to the canonical PoolManager. Any native dust returns only to the initiating curve. |
| LP harvest, one high row | PositionManager receives only the zero-liquidity `INCREASE_LIQUIDITY` and `TAKE_PAIR` payload for the original position. PoolManager sends the expected ETH and fixed token directly to the project's fee ledger. The engine records exactly those amounts. The same receipt checks prove unchanged position liquidity and owner. |

The full Pocket-backed loopback run passed for RMT, Harbor Research and Cedar Toolkit at Robinhood block 114549452. Each project matched 21 graduation call/create frames and 10 harvest call frames. RMT graduated after the two separately verified funded migration hops. The Pinax control independently matched six expected settlement traces and the same frame counts without the migration step. Both used compiler input 66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10. [Full fixture report](fork-4663.json.gz)

These traces demonstrate the actual call paths of the tested transactions. The separate hostile-dependency and shared-unlock regressions exercise rollback under injected faults. Each approved dependency, hook, subscriber or settlement-action change requires a fresh call-graph review. [Source-level reachability and regressions](../fixed-supply-security/v4-settlement-reachability.md)

## Dependency arithmetic

| Exact finding group | Review evidence |
| --- | --- |
| Uniswap `FullMath.mulDiv` and OpenZeppelin `Math.mulDiv`, two `incorrect-exp` highs | The executable oracle computes 512-bit products from independent 128-bit limb products and carries. It verifies valid floor and ceiling results independently of the inverse routine and checks zero divisor, overflow and rounding overflow. Deterministic vectors exercise every odd residue class after removing powers of two. The affected paths include price and amount calculations at funding and fee-growth multiplication in harvest. [Wide-product regression](../../../packages/contracts/test/RMTDependencyArithmeticReview.t.sol#L10) · [V4 funding and fee formulae](../../../packages/contracts/src/RMTV4CurveGraduationV1.sol#L183) |
| Uniswap `BitMath` most and least significant index, two `incorrect-shift` highs | Tests cover all 256 one-hot inputs and dense boundary patterns, an independent simple scan for fuzzed nonzero words, and rejection of zero. These routines locate initialized ticks for swaps through V4's tick bitmap. [Bit-index regression](../../../packages/contracts/test/RMTDependencyArithmeticReview.t.sol#L44) · [Pinned tick bitmap](https://github.com/Uniswap/v4-core/blob/59d3ecf53afa9264a16bba0e38f4c5d2231f80bc/src/libraries/TickBitmap.sol#L87) |

The six focused Foundry tests passed using the pinned solc 0.8.26 toolchain, with 512 fuzz cases for each oracle. The three Node trace parser tests also passed. Call traces establish external control flow. Internal arithmetic proofs have their own test scope. Neither an injected fault nor a passing test constitutes independent clearance.

```sh
node --test docs/evidence/fixed-supply-release/settlement-trace.test.mjs
(cd packages/contracts && forge test --offline --use "$PINNED_SOLC" --match-contract RMTDependencyArithmeticReviewTest -vv)
node packages/contracts/scripts/rehearse-fixed-supply-4663.mjs --anvil "$ANVIL" --solc "$PINNED_SOLC" --archive pinax --output "$NEW_REPORT"
```
