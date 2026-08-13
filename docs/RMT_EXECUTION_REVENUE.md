# RMT execution revenue

**Status: CURRENT — implementation program; production collection disabled**

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

This policy direction does **not** activate collection. Production remains disabled until an exact public treasury, effective block boundary, provider-specific settlement implementation, complete wallet disclosure, settlement proof and explicit release authorization all exist.

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

No treasury is embedded in the repository. The `RMT_EXECUTION_V1` descriptor is deliberately incomplete until an exact public treasury and effective boundary are supplied. A policy missing either cannot produce a valid commitment.

Every indicative provider observation now carries explicit net economics. While collection is disabled, its commitment is structurally `disabled`, exposes no policy or treasury authority, carries zero expected/maximum fee and leaves gross/provider/net amounts unchanged. A bare hard-coded zero is not accepted as the normalized RMT fee model.

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

`packages/contracts/src/RMTUniswapV3FeeExecutorV1.sol` is the first provider-specific onchain settlement primitive. Its source and tests do not constitute a deployment or production activation.

The executor is non-upgradeable and has no owner, proxy, mutable router, mutable treasury, arbitrary target, arbitrary calldata, delegatecall, sweep or rescue method. One deployment immutably binds:

- Robinhood Chain `4663`;
- Router02, its runtime hash and its reported factory/WETH dependencies;
- factory and canonical WETH runtime hashes;
- one treasury supplied during a separately reviewed deployment;
- one exact policy ID hash, version, policy hash, fee rate and block boundary;
- the exact ERC-20 fee assets and optional native fee-asset eligibility admitted by that policy.

Every execution rechecks router/factory/WETH code hashes and Router02 dependencies. Every pool is reconstructed from the immutable factory and its token identity. The only supported route grammar is a typed direct `exactInputSingle` route or typed two-leg `exactInput` route through immutable canonical WETH at the admitted fee tiers `100`, `500`, `3000` and `10000`. The contract does not accept router calldata or an execution target.

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

## Default-off VNext authorization integration

VNext now has a typed client/server codec for the executor, but the path cannot
become active from a single setting. Fee-bearing Uniswap V3 execution requires
all of the following independently:

- `RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED=true`;
- `RMT_VNEXT_UNISWAP_V3_FEE_AUTHORIZATION_ENABLED=true`;
- an exact deployed executor address and runtime hash;
- the exact treasury, policy start/end boundary and chain-qualified settlement-asset registry;
- both existing VNext client/server authorization gates;
- the existing wallet-submission gate before a prompt can open.

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

### Deployment prerequisites

Before any deployment, RMT still requires an explicitly selected public treasury, the exact production policy hash/effective block, reviewed eligible settlement assets, constructor and bytecode review, deterministic deployment/verification tooling, and independent security review. After deployment, server authorization, client disclosure, receipt reconciliation and controlled proof remain separate default-off phases.

## Review sequence

1. Versioned policy, normalized commitment and net math — no collection.
2. Narrow non-upgradeable Uniswap V3 fee executor and adversarial/fork tests — no deployment.
3. Server quote, strict verification and fee-bearing authorization — implemented, gates off.
4. Client pre-sign verification and fee disclosure — implemented, gates off.
5. Canonical receipt reconciliation and exactly-once settlement proof — implemented; deployment finality/proof evidence pending.
6. Deployment verification and controlled proof tooling — no public activation.

Production revenue is not booked from a quote or plan. It exists only after a successful, final, unambiguous settlement proves exactly one authorized fee to the exact treasury.

## Current release state

- Policy implementation: foundation present.
- Production treasury: not configured.
- Fee executor: source and adversarial/fork tests implemented; not deployed.
- Fee-bearing authorization: implemented and independently gated off.
- Fee disclosure: implemented; unreachable without an admitted deployment/policy.
- Fee settlement reconciliation: implemented for the canonical event; no production settlement exists.
- Provider fee gates: present and default off.
- Production fee collection: disabled.

The older disabled Uniswap fee capability is compatibility code, not authorization to activate revenue and not the canonical VNext revenue architecture.
