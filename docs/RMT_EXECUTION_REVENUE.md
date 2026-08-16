# RMT execution revenue

**Status: CURRENT — 25-bps Uniswap V3 public release active**

## Approved policy direction

The owner has approved implementation support for the first forward terminal execution-fee policy:

| Field | Value |
| --- | --- |
| Policy ID | `RMT_EXECUTION_V1` |
| Version | `1` |
| Fee | 25 basis points (0.25%) |
| Rounding | floor in atomic units |
| Minimum fee | none |
| Allocation | 100% RMT operations |
| Eligible origin | independently proven RMT-originated executions only |
| Initial settlement assets | canonical Robinhood USDG and WETH/native-compatible settlement, subject to exact provider admission |

The provider-specific public release action completed on 2026-08-16. `RMT_EXECUTION_V1` is active only for admitted public Uniswap V3 fee-executor routes. The activation boundary is Robinhood block `37805030` (`0xdfb2560bb21f75c08e2ddaeac71075fb71523f45a543149018891c5fa673b9b2`, timestamp `2026-08-16T07:42:40Z`). The policy does not make another provider, route or transaction class fee-bearing.

Across funding, wallet transfers, failed transactions, quote requests and unrelated transactions are not eligible. V6 economics, Stonk/up allocations, PoH allocations, subscriptions, hidden spread, positive-slippage capture and automatic fee-conversion swaps are not part of this policy.

## Canonical domain

`apps/web/lib/vnext/execution-fee-policy.ts` owns the provider-neutral fee policy and normalized net-execution math.

A complete policy binds:

- policy ID and version;
- fee basis points;
- exact treasury;
- chain and effective block boundary;
- authenticated RMT execution origin;
- chain-qualified eligible settlement assets;
- the 100% RMT-operations allocation;
- one deterministic policy hash.

The approved treasury is the independently verified one-owner Safe at `0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC`. Its sole owner is `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA` and its threshold is one. The Safe was deployed in transaction `0xae7c35dc956efe6691a983e5c0980f2221800f46461e2346205b6d21b158be15` at Robinhood block `35041945`.

That confirmed treasury-deployment block is the immutable V1 policy `fromBlock`. It anchors the policy identity; it does not activate collection or make transactions before the executor deployment fee-bearing. With canonical WETH, USDG and native Robinhood ETH as the reviewed settlement identities, the exact policy hash is `0x295c900143405bb585a4d88c3788fadab522fd4313f69242f64e52e39827f141`. A runtime configuration missing or changing any of these values still fails closed.

Every indicative provider observation carries explicit net economics. An admitted Uniswap V3 fee route carries the exact active policy commitment. Every ineligible or disabled route remains structurally `disabled`, exposes no policy or treasury authority, carries zero expected/maximum fee and leaves gross/provider/net amounts unchanged. A bare hard-coded zero is not accepted as the normalized RMT fee model.

## Net execution math

### Input-side fee

For buys whose canonical settlement asset is the input:

```text
fee = floor(userGrossInput × feeBps / 10,000)
providerInput = userGrossInput - fee
```

The provider quote must be calculated for `providerInput`. The fee and provider execution must later settle atomically through an admitted provider-specific implementation.

### Output-side fee

For sells whose canonical settlement asset is the output:

```text
expectedFee = floor(providerGrossExpectedOutput × feeBps / 10,000)
expectedUserNetOutput = providerGrossExpectedOutput - expectedFee
protectedFee = floor(providerProtectedOutput × feeBps / 10,000)
protectedUserNetOutput = providerProtectedOutput - protectedFee
```

The wallet-authorized maximum fee is explicit. Tiny trades may produce a legitimate zero fee through floor rounding. There is no minimum fee.

## Provider separation

One normalized commitment supports provider-specific settlement modes. It does not create a generic arbitrary-call executor.

Planned settlement identities are:

- `rmt-direct-executor-v1`;
- `uniswapx-order-output-v1`;
- `zerox-integrator-fee-v1`.

These identifiers describe bounded settlement families, not active providers. Uniswap V3 receives the first separately reviewed executor. up-v2 and up-cl require their non-fee production proofs first. Sushi must be reconciled with the separate deadline-guard track. UniswapX and 0x require their own admitted wallet execution and native fee semantics.

## Uniswap V3 atomic fee executor

`packages/contracts/src/RMTUniswapV3FeeExecutorV1.sol` is the first provider-specific onchain settlement primitive. The corrected executor is deployed at `0xcB9c00524848038D211921e0f3975190D7Aa1e8f` through the reviewed CREATE2 factory in transaction `0x367e8dd5d87bc09a94f99decbb9eda62c132f52822733a465804fa8c20a62b2b` at Robinhood L2 block `35142528`. Its exact immutable-filled runtime hash is `0xc6d54277c89993410fa71ad24c7a6cea0072a4f0f20a8759a04d9e4a4c37813d`. Deployment alone did not activate fees; the later controlled proof and explicit public release did.

The first deployment at `0x843a4D8BEa13037c5706eA005d336aE735BB0eD4` is permanently inactive because its policy boundary used Solidity `block.number`, which resolves to the parent L1 block on this Arbitrum-derived chain. It never settled a trade or fee. The corrected executor reads the canonical Robinhood L2 block from the ArbSys precompile and otherwise preserves the reviewed immutable policy and execution boundary. The deployment manifest retains the superseded deployment identity and fail-closed reason.

The executor is non-upgradeable and has no owner, proxy, mutable router, mutable treasury, arbitrary target, arbitrary calldata, delegatecall, sweep or rescue method. One deployment immutably binds:

- Robinhood Chain `4663`;
- Router02, its runtime hash and its reported factory/WETH dependencies;
- factory and canonical WETH runtime hashes;
- one treasury supplied during a separately reviewed deployment;
- one exact policy ID hash, version, policy hash, fee rate and block boundary;
- the exact ERC-20 fee assets and optional native fee-asset eligibility admitted by that policy.

Every execution rechecks router/factory/WETH code hashes and Router02 dependencies. Every pool is reconstructed from the immutable factory and its token identity. The only supported route grammar is a typed direct `exactInputSingle` route or typed two-leg `exactInput` route through immutable canonical WETH at the admitted fee tiers `100`, `500`, `3000` and `10000`. The contract does not accept router calldata or an execution target.

Canonical WETH is an EIP-1967 proxy. The executor can pin its proxy runtime but cannot read another contract's storage slot onchain. RMT therefore additionally pins the exact WETH implementation address and implementation runtime hash in the server-side admission check, verifies both before every fee-bearing quote/authorization, and includes them in the read-only readiness report. Any proxy implementation change fails closed before wallet review. This does not eliminate the narrow upgrade race between final simulation and inclusion, so exact transaction simulation, short deadlines and controlled proof remain release requirements.

### Fee and output formulas

For input-side settlement:

```text
actualFee = floor(userGrossInput × feeBps / 10,000)
providerInput = userGrossInput - actualFee
actualUserNetOutput = actualGrossOutput
```

The disclosed expected fee and wallet-authorized maximum must both equal `actualFee`. The provider quote and router minimum apply to `providerInput`. The fee and swap settle in one transaction; any later failure rolls both back.

For output-side settlement:

```text
candidateFee = floor(actualGrossOutput × feeBps / 10,000)
actualFee = min(candidateFee, maximumFeeAtomic)
actualUserNetOutput = actualGrossOutput - actualFee
require actualUserNetOutput >= protectedUserNetOutput
```

`expectedFeeAtomic` and `maximumFeeAtomic` must equal the PR #350 expected-output fee. Positive slippage cannot increase RMT revenue above that wallet-authorized maximum; every remaining atomic unit belongs to the trader. Tiny eligible trades may produce a zero fee by floor rounding and still emit the canonical settlement event.

### Approval and balance topology

For ERC-20 input, the trader approves the executor. The executor pulls the exact authorized amount, approves only exact `providerInput` to immutable Router02, and clears the router allowance after execution. Native input is accepted only when the routed input is immutable WETH and `msg.value` exactly equals the authorization.

Input/output balance deltas must exactly match the execution. Fee-on-transfer, rebasing or otherwise abnormal settlement behavior fails closed. Pre-existing donated balances are preserved and cannot be swept or attributed to a trade. A successful execution returns to its pre-execution balances except for any unrelated donation already present.

### Replay and reconciliation

`executionId` is globally consumed exactly once after a successful atomic settlement. Reverts roll the consumption state back, allowing the same correct authorization to be retried before its deadline. Exactly one successful execution emits:

```solidity
event RMTUniswapV3FeeSettled(
  bytes32 indexed executionId,
  bytes32 indexed policyHash,
  address indexed trader,
  bytes32 policyIdHash,
  uint256 policyVersion,
  bytes32 providerId,
  address router,
  bytes32 routeIdentity,
  address feeAsset,
  uint16 feeBps,
  FeeSide feeSide,
  uint256 userGrossInput,
  uint256 providerInput,
  uint256 grossActualOutput,
  uint256 actualRmtFee,
  uint256 actualUserNetOutput,
  address treasury
);
```

## VNext authorization and public release

VNext now has a typed client/server codec for the executor, but the path cannot
become active from a single setting. Fee-bearing Uniswap V3 execution requires
all of the following independently:

- `RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED=true`;
- `RMT_VNEXT_UNISWAP_V3_FEE_AUTHORIZATION_ENABLED=true`;
- one exact server-only `RMT_VNEXT_UNISWAP_V3_FEE_PROOF_WALLET` recipient;
- an exact deployed executor address and runtime hash;
- the exact treasury, policy start/end boundary and chain-qualified settlement-asset registry;
- both existing VNext client/server authorization gates;
- the existing wallet-submission gate before a prompt can open.

Public fee-bearing routing additionally requires:

- the code-reviewed controlled-proof record to match the exact executor, policy, treasury and proof wallet;
- `RMT_VNEXT_UNISWAP_V3_FEE_PUBLIC_AUTHORIZATION_ENABLED=true`;
- every pre-existing policy, provider, client, server and wallet-submission gate above.

The public gate defaults off and cannot activate collection alone.

The controlled mainnet proof completed successfully in transaction
`0xf2998e49b08e0d0bc4aeb4256c9e84bfeee888aae67db6262bfb94b4a8d9a6fb`
at Robinhood block `37772345`. The exact 0.10 USDG input settled 0.00025 USDG
to the approved treasury and 0.000053073785359108 WETH to the trader. The
canonical settlement event, raw token transfers, gas accounting, executor zero
balances, cleared router allowance and consumed execution ID were independently
reconciled.

PR #385 completed the separate public release. Production readiness now reports
`public` only while the exact policy, executor, runtime, controlled-proof binding,
client/server authorization and wallet-submission gates all agree. The source
configuration remains default-off so preview, local or future environments do
not inherit production activation. Disabling the public gate stops new
fee-bearing authorizations without changing other provider paths or historical
settlement evidence.

When the policy is active and the input settlement asset is eligible, RMT quotes
the provider using the post-fee provider input. When the output settlement asset
is eligible, RMT quotes the full provider input and displays/protects the user's
net output. Routes with no eligible settlement asset remain fee-ineligible; they
do not acquire hidden economics.

Before wallet review the server verifies the executor runtime and every immutable
router, factory, WETH, treasury, policy and eligible-asset value against the exact
configured policy. The wallet approval spender changes from Router02 to the
executor only for this admitted path. Approval remains exact, and confirmation
forces a new quote, route verification and complete executor simulation.

The browser independently decodes the typed executor call. It verifies the exact
execution ID, policy, treasury, fee side/asset/rate/cap, trader, gross input,
provider input, expected gross output, protected user net output, deadline,
route identity, pools and fee tiers before opening the wallet.

## Receipt reconciliation

A mined fee-bearing transaction is not credited from generic token transfers.
RMT requires exactly one `RMTUniswapV3FeeSettled` event from the exact executor
and reconciles every authorization field, Router02/provider identity, actual fee,
positive-slippage cap, actual net output and treasury. A missing, duplicated or
mutated event leaves the transaction unresolved with a recovery warning; users
are told not to resubmit and Spend Balance is not credited from unverified data.

The local recovery journal stores only the bounded settlement expectation and
actual canonical amounts. It does not store a signing key or create server-side
transaction authority. The wallet remains the only signer.

Run the read-only release report with:

```text
pnpm --filter web readiness:vnext-uniswap-fee
```

It reports public contract/policy identities and exact blockers. It never signs,
deploys, approves, submits or changes environment configuration.

### Deployment and release records

The exact public treasury, policy hash/effective block and eligible settlement assets are recorded in `packages/contracts/deployments/rmt-uniswap-v3-fee-executor-v1.json`. The same manifest pins the verified CREATE2 factory, constructor bytecode, constructor arguments, init code, expected runtime, executor address and canonical deployment receipt. Its deployment-time activation fields are historical deployment evidence, not the current production release state. Current activation is proven by production readiness plus the independently recorded release boundary. Run:

```text
forge build --root packages/contracts --contracts src/RMTUniswapV3FeeExecutorV1.sol
pnpm --filter web readiness:vnext-uniswap-fee-deployment
```

The command reconstructs the deployment from the compiled artifact, re-verifies the Safe ownership and runtime, re-verifies Router02/factory/WETH/USDG identities, verifies the exact deployment transaction and live executor runtime, and reports confirmation evidence. Before deployment it also simulates the constructor/CREATE2 path and reports gas sufficiency; after deployment it never attempts the consumed CREATE2 salt again. It never signs or submits.

For ongoing production settlement checks, run the free read-only command:

```text
pnpm monitor:uniswap-v3-fees
```

It checks production readiness, the release block/hash, live executor runtime, confirmed canonical settlement events and receipts, executor residual balances, router allowances and treasury token balances. It uses only public HTTPS reads and never signs, approves or submits. See [`PRODUCTION_MONITORING.md`](PRODUCTION_MONITORING.md#uniswap-v3-fee-settlement-monitoring).

## Review sequence

1. Versioned policy, normalized commitment and net math — no collection.
2. Narrow non-upgradeable Uniswap V3 fee executor and adversarial/fork tests — no deployment.
3. Server quote, strict verification and fee-bearing authorization — implemented and publicly active for the admitted Uniswap V3 path.
4. Client pre-sign verification and fee disclosure — implemented and publicly active for the admitted Uniswap V3 path.
5. Canonical receipt reconciliation and exactly-once settlement proof — complete for the controlled mainnet proof.
6. Deployment and controlled-proof verification complete; public activation explicitly released at Robinhood block `37805030`.

Production revenue is not booked from a quote or plan. It exists only after a successful, final, unambiguous settlement proves exactly one authorized fee to the exact treasury.

## Current release state

- Policy implementation: active for admitted public Uniswap V3 fee-executor routes.
- Production treasury: approved Safe deployed and independently verified.
- Policy identity: exact hash, policy boundary and public release boundary recorded.
- Fee executor: corrected deployment at `0xcB9c00524848038D211921e0f3975190D7Aa1e8f`; exact transaction, immutable-filled runtime and canonical Robinhood L2 policy-block source verified. The first deployment is recorded as permanently inactive.
- Fee-bearing authorization: publicly active for the admitted Uniswap V3 path and independently gated.
- Fee disclosure: implemented and proven through the controlled wallet; remains required before every wallet review.
- Fee settlement reconciliation: implemented and proven for the canonical event; the public monitor independently binds confirmed events to successful receipts.
- Provider fee gates: present; source defaults remain off while the explicit production override is on.
- Controlled proof: complete and independently reconciled at Robinhood block `37772345`.
- Production fee collection: public for eligible Uniswap V3 fee-executor routes since block `37805030`.
- Public fee-routing mode: active only while every policy, proof-binding, authorization and wallet-submission gate agrees; it fails closed on mismatch.
- Initial public monitoring baseline: no confirmed public settlement events observed through block `37836628` at `2026-08-16T08:35:42Z`; executor balances and router allowances were zero. This is an observation, not a promise that the count remains zero.

The older disabled Uniswap fee capability is compatibility code, not authorization to activate revenue and not the canonical VNext revenue architecture.
