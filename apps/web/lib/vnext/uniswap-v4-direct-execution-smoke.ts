import assert from "node:assert/strict";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, erc20Abi, getAddress, zeroAddress, type Hex } from "viem";
import {
  PERMIT2_MIN_REMAINING_VALIDITY_SECONDS,
  prepareVNextUniswapV4Authorization,
  verifyVNextUniswapV4Route,
  type VNextUniswapV4ExecutionDependencies
} from "../server/vnext-uniswap-v4-execution";
import type { VNextCanonicalMarketInventoryResult } from "../server/vnext-market-indexer";
import {
  MAX_UINT160,
  PERMIT2_ADDRESS,
  permit2Abi,
  ROBINHOOD_UNIVERSAL_ROUTER,
  ROBINHOOD_V4_POOL_MANAGER,
  ROBINHOOD_V4_QUOTER
} from "../uniswap-v4";
import { VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY } from "./provider-fee-settlement";
import { VNEXT_PROVIDER_EXECUTION_CAPABILITY_REGISTRY } from "./provider-execution-capability";
import { authorizationPayloadHash, parseVNextAuthorizationPlan, type VNextAuthorizationPlan } from "./authorization-plan";
import { directExecutionBinding } from "./execution-settlement";
import { parseVNextPreSignEvidence, type VNextPreSignEvidence } from "./pre-sign-evidence";
import { vnextSpotTradeInstruction } from "./execution-authority";
import { recordSubmittedVNextExecution, settledVNextOutputAtomic, type VNextExecutionStorage } from "./execution-recovery";

const token = getAddress("0x1139d423C1706BDeaD91f03507F521635591eD92");
const recipient = getAddress("0x1111111111111111111111111111111111111111");
const hooks = getAddress("0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044");
const poolId = "0x5f5ec0e1016bae2f04c122bbcd2c141a4177cc681d7c2e4463a1d172ed8430b3" as Hex;
const quoteHash = `0x${"5".repeat(64)}` as Hex;
const simulationHash = `0x${"6".repeat(64)}` as Hex;
const now = 1_786_000_000_000;
const deadline = BigInt(Math.floor(now / 1_000) + 240);

const inventory: VNextCanonicalMarketInventoryResult = {
  status: "verified_shadow",
  chainId: 4_663,
  mode: "shadow",
  authoritative: false,
  sourceManifestHash: `0x${"1".repeat(64)}`,
  coverage: {
    complete: true,
    finalizedHead: "50000000",
    sources: [{ sourceId: "uniswap-v4", status: "shadow-ready", indexedThrough: "50000000" }]
  },
  nextCursor: null,
  pools: [{
    sourceId: "uniswap-v4",
    protocol: "uniswap",
    version: 4,
    poolKey: poolId,
    poolAddress: null,
    token0: zeroAddress,
    token1: token.toLowerCase(),
    stable: null,
    fee: 0,
    tickSpacing: 200,
    hooks: hooks.toLowerCase(),
    transactionHash: `0x${"2".repeat(64)}`,
    blockNumber: "49000000",
    blockHash: `0x${"3".repeat(64)}`,
    stateStatus: "ready",
    liveFee: 0,
    feeDenominator: 1_000_000,
    gaugeAddress: null,
    gaugeAlive: null,
    gaugeWeight: null,
    gaugeClaimable: null,
    feesAddress: null,
    bribeAddress: null,
    stateError: null,
    stateObservedBlock: "50000000",
    stateObservedBlockHash: `0x${"4".repeat(64)}`
  }]
};

const quoteEvidence = {
  poolId,
  currency0: zeroAddress,
  currency1: token,
  fee: 0,
  tickSpacing: 200,
  hooks,
  recipient,
  observedBlock: "50000001",
  observedBlockHash: quoteHash,
  observedAtMs: now - 1_000,
  quotedAtMs: now - 900,
  expiresAtMs: now + 29_000
};

function dependencies(input: {
  tokenAllowance?: bigint;
  permit2Amount?: bigint;
  permit2Expiration?: bigint;
  quoteOut?: bigint;
} = {}): VNextUniswapV4ExecutionDependencies {
  return {
    readInventory: async () => inventory,
    quote: async () => input.quoteOut ?? 4_000_000n,
    readBlock: async (blockNumber) => blockNumber === 50_000_001n
      ? { number: 50_000_001n, hash: quoteHash, timestamp: BigInt(Math.floor(now / 1_000) - 1) }
      : { number: 50_000_002n, hash: simulationHash, timestamp: BigInt(Math.floor(now / 1_000)) },
    getBytecode: async () => "0x60006000",
    getNativeBalance: async () => 10n ** 20n,
    getTokenState: async () => ({ balance: 10n ** 24n, permit2Allowance: input.tokenAllowance ?? MAX_UINT160 }),
    getPermit2Allowance: async () => ({ amount: input.permit2Amount ?? MAX_UINT160, expiration: input.permit2Expiration ?? deadline + 1_000n }),
    call: async () => undefined,
    estimateGas: async () => 200_000n,
    getGasPrice: async () => 1_000_000_000n,
    now: () => now
  };
}

const buyRequest = {
  chainId: 4_663 as const,
  inputAsset: zeroAddress,
  outputAsset: token,
  inputAmountAtomic: "1000000000000000",
  amountIn: 1_000_000_000_000_000n,
  recipient,
  indicativeProtectedOutputFloorAtomic: 3_900_000n,
  canonicalMarket: { sourceId: "uniswap-v4" as const, poolId },
  v4QuoteEvidence: quoteEvidence
};

async function main() {
  const buy = await verifyVNextUniswapV4Route(buyRequest, dependencies());
  assert.equal(buy.status, "verified");
  assert.equal(buy.router, ROBINHOOD_UNIVERSAL_ROUTER);
  assert.equal(buy.transactionValueAtomic, buyRequest.inputAmountAtomic);
  assert.equal(buy.v4Execution?.poolId, poolId);
  assert.equal(buy.v4Execution?.poolManager, ROBINHOOD_V4_POOL_MANAGER);
  assert.equal(buy.v4Execution?.quoter, ROBINHOOD_V4_QUOTER);
  assert.equal(buy.v4Execution?.commands, "0x100404");
  assert.equal(buy.v4Execution?.hookData, "0x");
  assert.equal(buy.v4Execution?.rmtFeeAtomic, "0");
  assert.equal(buy.v4Execution?.treasuryTransferAtomic, "0");
  assert.equal(buy.directNoRmtFee?.userGrossInputAtomic, buy.directNoRmtFee?.providerInputAtomic);

  const preparedBuy = await prepareVNextUniswapV4Authorization({
    ...buyRequest,
    deadlineSeconds: deadline,
    protectedOutputFloorAtomic: 3_900_000n,
    nowMs: now
  }, dependencies());
  assert.equal(preparedBuy.transaction.kind, "swap");
  assert.equal(preparedBuy.transaction.target, ROBINHOOD_UNIVERSAL_ROUTER);
  assert.equal(preparedBuy.transaction.value, buyRequest.inputAmountAtomic);

  for (const chainClockLagSeconds of [1n, 15n, 30n]) {
    const chainTimestamp = BigInt(Math.floor(now / 1_000)) - chainClockLagSeconds;
    const lagged = await prepareVNextUniswapV4Authorization({
      ...buyRequest,
      v4QuoteEvidence: { ...quoteEvidence, quotedAtMs: now - 100, expiresAtMs: now + 29_000 },
      deadlineSeconds: chainTimestamp + 240n,
      protectedOutputFloorAtomic: 3_900_000n,
      nowMs: now
    }, dependencies());
    assert.equal(lagged.transaction.kind, "swap", `wall-clock V4 freshness must survive ${chainClockLagSeconds}s chain-clock lag`);
    assert.equal(lagged.evidence.deadline, (chainTimestamp + 240n).toString(), "the final deadline remains chain-time derived");
  }

  const sellRequest = {
    ...buyRequest,
    inputAsset: token,
    outputAsset: zeroAddress,
    inputAmountAtomic: "1000000",
    amountIn: 1_000_000n,
    indicativeProtectedOutputFloorAtomic: 3_900_000n
  };
  const preparedSell = await prepareVNextUniswapV4Authorization({
    ...sellRequest,
    deadlineSeconds: deadline,
    protectedOutputFloorAtomic: 3_900_000n,
    nowMs: now
  }, dependencies());
  assert.equal(preparedSell.transaction.kind, "swap");
  assert.equal(preparedSell.transaction.value, "0");
  assert.equal(preparedSell.evidence.v4Execution?.commands, "0x02100404");

  const sourceQuoteRequestId = "11111111-1111-4111-8111-111111111111";
  const verificationId = "22222222-2222-4222-8222-222222222222";
  const planId = "33333333-3333-4333-8333-333333333333";
  const sellEvidence = parseVNextPreSignEvidence({
    verificationId,
    sourceQuoteRequestId,
    ...preparedSell.evidence
  }, {
    quoteRequestId: sourceQuoteRequestId,
    inputAsset: token,
    outputAsset: zeroAddress,
    inputAmountAtomic: sellRequest.inputAmountAtomic,
    provider: "uniswap-v4",
    protectedOutputFloorAtomic: sellRequest.indicativeProtectedOutputFloorAtomic.toString(),
    recipient
  }, now + 1);
  const unsignedPlan: Omit<VNextAuthorizationPlan, "payloadHash"> = {
    planId,
    sourceQuoteRequestId,
    sourceVerificationId: verificationId,
    provider: "uniswap-v4",
    kind: "swap",
    chainId: 4_663,
    target: preparedSell.transaction.target,
    data: preparedSell.transaction.data,
    value: preparedSell.transaction.value,
    gasLimit: preparedSell.transaction.gasLimit,
    inputAsset: token,
    outputAsset: zeroAddress,
    inputAmountAtomic: sellRequest.inputAmountAtomic,
    protectedOutputAtomic: sellEvidence.protectedOutputAtomic,
    recipient,
    router: ROBINHOOD_UNIVERSAL_ROUTER,
    settlementMode: "DIRECT_NO_RMT_FEE",
    directNoRmtFee: sellEvidence.directNoRmtFee,
    directAuthorization: directExecutionBinding({
      provider: "uniswap-v4",
      kind: "swap",
      chainId: 4_663,
      inputAsset: token,
      outputAsset: zeroAddress,
      inputAmountAtomic: sellRequest.inputAmountAtomic,
      protectedOutputAtomic: sellEvidence.protectedOutputAtomic,
      recipient,
      providerTarget: ROBINHOOD_UNIVERSAL_ROUTER,
      executionTarget: preparedSell.transaction.target,
      approvalSpender: sellEvidence.approvalSpender,
      approvalAmountAtomic: sellRequest.inputAmountAtomic,
      data: preparedSell.transaction.data,
      valueAtomic: preparedSell.transaction.value,
      deadline: sellEvidence.deadline
    }),
    netEconomics: sellEvidence.netEconomics,
    feeExecution: null,
    v4Execution: sellEvidence.v4Execution,
    deadline: sellEvidence.deadline,
    preparedAtMs: now,
    expiresAtMs: now + 60_000,
    userAuthorizationRequired: true,
    serverSubmissionEnabled: false
  };
  const plan: VNextAuthorizationPlan = { ...unsignedPlan, payloadHash: authorizationPayloadHash(unsignedPlan) };
  const exactPlan = parseVNextAuthorizationPlan(plan, sellEvidence, now + 1);
  assert.equal(vnextSpotTradeInstruction(exactPlan).target, ROBINHOOD_UNIVERSAL_ROUTER);
  const state = new Map<string, string>();
  const storage: VNextExecutionStorage = {
    getItem: (key) => state.get(key) ?? null,
    setItem: (key, value) => { state.set(key, value); }
  };
  const record = recordSubmittedVNextExecution({
    wallet: recipient,
    plan: exactPlan,
    txHash: `0x${"a".repeat(64)}`
  }, storage, now + 2);
  assert.equal(record?.provider, "uniswap-v4");
  assert.equal(record?.v4DirectSettlement?.rmtFeeAtomic, "0");
  const swapTopics = encodeEventTopics({
    abi: [{
      type: "event", name: "Swap", anonymous: false,
      inputs: [
        { indexed: true, name: "id", type: "bytes32" },
        { indexed: true, name: "sender", type: "address" },
        { indexed: false, name: "amount0", type: "int128" },
        { indexed: false, name: "amount1", type: "int128" },
        { indexed: false, name: "sqrtPriceX96", type: "uint160" },
        { indexed: false, name: "liquidity", type: "uint128" },
        { indexed: false, name: "tick", type: "int24" },
        { indexed: false, name: "fee", type: "uint24" }
      ]
    }] as const,
    eventName: "Swap",
    args: { id: poolId, sender: ROBINHOOD_UNIVERSAL_ROUTER }
  });
  const nativeOutput = 4_000_000n;
  const swapData = encodeAbiParameters(
    [{ type: "int128" }, { type: "int128" }, { type: "uint160" }, { type: "uint128" }, { type: "int24" }, { type: "uint24" }],
    [nativeOutput, -1_000_000n, 1n, 1n, 0, 0]
  );
  assert.equal(settledVNextOutputAtomic(record!, [{
    address: ROBINHOOD_V4_POOL_MANAGER,
    data: swapData,
    topics: swapTopics.flatMap((topic) => typeof topic === "string" ? [topic as Hex] : [])
  }]), nativeOutput.toString());

  assert.throws(() => parseVNextAuthorizationPlan({
    ...plan,
    v4Execution: { ...plan.v4Execution!, commands: "0x100404" },
    payloadHash: authorizationPayloadHash(plan)
  }, sellEvidence, now + 1), /changed V4 execution authority/);
  const arbitraryRouterCalldata = {
    ...plan,
    data: `${plan.data}00` as Hex
  };
  assert.throws(() => parseVNextAuthorizationPlan({
    ...arbitraryRouterCalldata,
    payloadHash: authorizationPayloadHash(arbitraryRouterCalldata)
  }, sellEvidence, now + 1), /DIRECT_NO_RMT_FEE|calldata|authorization/);
  assert.throws(() => parseVNextAuthorizationPlan({
    ...plan,
    v4Execution: { ...plan.v4Execution!, commands: "0x0210040406" },
    payloadHash: authorizationPayloadHash(plan)
  }, sellEvidence, now + 1), /changed V4 execution authority/);
  assert.throws(() => vnextSpotTradeInstruction({
    ...exactPlan,
    target: getAddress("0x9999999999999999999999999999999999999999")
  }), /DIRECT_NO_RMT_FEE|fee-free/);

  const tokenApproval = await prepareVNextUniswapV4Authorization({
    ...sellRequest,
    deadlineSeconds: deadline,
    protectedOutputFloorAtomic: 3_900_000n,
    nowMs: now
  }, dependencies({ tokenAllowance: 0n }));
  assert.equal(tokenApproval.transaction.kind, "erc20_approval");
  assert.equal(tokenApproval.transaction.target, token);
  assert.equal(tokenApproval.evidence.approvalKind, "erc20_to_permit2");
  assert.equal(tokenApproval.evidence.approvalSpender, PERMIT2_ADDRESS);
  const decodedTokenApproval = decodeFunctionData({ abi: erc20Abi, data: tokenApproval.transaction.data });
  assert.equal(decodedTokenApproval.functionName, "approve");
  assert.deepEqual(decodedTokenApproval.args, [getAddress(PERMIT2_ADDRESS), sellRequest.amountIn]);

  const permit2Approval = await prepareVNextUniswapV4Authorization({
    ...sellRequest,
    deadlineSeconds: deadline,
    protectedOutputFloorAtomic: 3_900_000n,
    nowMs: now
  }, dependencies({ tokenAllowance: sellRequest.amountIn, permit2Amount: 0n }));
  assert.equal(permit2Approval.transaction.kind, "erc20_approval");
  assert.equal(permit2Approval.transaction.target, PERMIT2_ADDRESS);
  assert.equal(permit2Approval.evidence.approvalKind, "permit2_to_router");
  assert.equal(permit2Approval.evidence.approvalSpender, ROBINHOOD_UNIVERSAL_ROUTER);
  const decodedPermit2Approval = decodeFunctionData({ abi: permit2Abi, data: permit2Approval.transaction.data });
  assert.equal(decodedPermit2Approval.functionName, "approve");
  assert.deepEqual(decodedPermit2Approval.args, [token, getAddress(ROBINHOOD_UNIVERSAL_ROUTER), sellRequest.amountIn, Number(deadline)]);

  const currentSeconds = BigInt(Math.floor(now / 1_000));
  const refreshedSell = await prepareVNextUniswapV4Authorization({
    ...sellRequest,
    deadlineSeconds: deadline,
    protectedOutputFloorAtomic: 3_900_000n,
    nowMs: now
  }, dependencies({
    tokenAllowance: sellRequest.amountIn,
    permit2Amount: sellRequest.amountIn,
    permit2Expiration: currentSeconds + PERMIT2_MIN_REMAINING_VALIDITY_SECONDS
  }));
  assert.equal(refreshedSell.evidence.status, "verified");
  assert.equal(refreshedSell.evidence.approvalKind, null);
  assert.equal(refreshedSell.evidence.exactSimulationPassed, true);
  assert.equal(refreshedSell.transaction.kind, "swap");
  assert.equal(refreshedSell.transaction.target, ROBINHOOD_UNIVERSAL_ROUTER);

  for (const change of [
    { poolId: `0x${"9".repeat(64)}` as Hex },
    { currency0: token, currency1: zeroAddress },
    { fee: 1 },
    { tickSpacing: 201 },
    { hooks: getAddress("0x2222222222222222222222222222222222222222") },
    { recipient: getAddress("0x3333333333333333333333333333333333333333") },
    { observedBlockHash: `0x${"8".repeat(64)}` as Hex }
  ]) {
    await assert.rejects(() => verifyVNextUniswapV4Route({
      ...buyRequest,
      v4QuoteEvidence: { ...quoteEvidence, ...change }
    }, dependencies()), /rejected Uniswap V4 execution/);
  }
  await assert.rejects(() => verifyVNextUniswapV4Route({
    ...buyRequest,
    amountIn: buyRequest.amountIn + 1n
  }, dependencies()), /input amount changed/);
  await assert.rejects(() => verifyVNextUniswapV4Route({
    ...buyRequest,
    v4QuoteEvidence: { ...quoteEvidence, expiresAtMs: now - 1 }
  }, dependencies()), /stale/);
  await assert.rejects(() => verifyVNextUniswapV4Route({
    ...buyRequest,
    chainId: 1 as 4_663
  }, dependencies()), /trade identity/);
  await assert.rejects(() => prepareVNextUniswapV4Authorization({
    ...buyRequest,
    deadlineSeconds: deadline,
    protectedOutputFloorAtomic: 4_100_000n,
    nowMs: now
  }, dependencies()), /protected floor/);

  assert.equal(VNEXT_PROVIDER_EXECUTION_CAPABILITY_REGISTRY["uniswap-v4"].state, "WALLET_EXECUTION");
  assert.equal(VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY["uniswap-v4"].state, "QUOTE_ONLY");
  assert.equal("feeExecution" in preparedBuy.evidence && preparedBuy.evidence.feeExecution != null, false);
  console.log("Generic fee-free Uniswap V4 strict verification, exact simulation, approvals, and containment checks passed.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
