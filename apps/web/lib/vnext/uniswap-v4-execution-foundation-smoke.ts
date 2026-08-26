import assert from "node:assert/strict";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  keccak256,
  parseAbiParameters,
  zeroAddress,
  type Hex
} from "viem";
import { createVNextUniswapV4Adapter } from "../server/vnext-uniswap-v4-adapter";
import {
  assertVNextUniswapV4V2FoundationContinuity,
  verifyVNextUniswapV4V2ExecutionFoundation
} from "../server/vnext-uniswap-v4-v2-execution";
import type { VNextCanonicalMarketInventoryResult } from "../server/vnext-market-indexer";
import { ROBINHOOD_V4_POOL_MANAGER } from "../uniswap-v4";
import { createRmtExecutionFeeV2Policy, normalizeRmtExecutionFeeV2Input } from "./execution-fee-policy-v2";
import { quoteVNextExecutionProviders } from "../server/vnext-provider-adapter";
import {
  createRmtUniswapV4FeeExecutionV2,
  encodeRmtUniswapV4FeeExecutionV2,
  RMT_UNISWAP_V4_V2_PROVIDER_ID,
  rmtUniswapV4FeeExecutorV2Abi,
  rmtUniswapV4PoolIdV2
} from "./uniswap-v4-fee-executor-v2";
import { reconcileRmtUniswapV4SettlementV2 } from "./uniswap-v4-settlement-reconciliation";
import { VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY } from "./provider-fee-settlement";

const token = getAddress("0x1139d423C1706BDeaD91f03507F521635591eD92"); // test-only V4 control
const hooks = getAddress("0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044");
const recipient = getAddress("0x1111111111111111111111111111111111111111");
const trader = getAddress("0x2222222222222222222222222222222222222222");
const executor = getAddress("0x3333333333333333333333333333333333333333");
const treasury = getAddress("0x4444444444444444444444444444444444444444");
const poolKey = { currency0: zeroAddress, currency1: token, fee: 0, tickSpacing: 200, hooks };
const poolId = rmtUniswapV4PoolIdV2(poolKey);
const now = Date.now();
const runtimeHash = `0x${"a".repeat(64)}` as Hex;
const poolRuntimeHash = `0x${"b".repeat(64)}` as Hex;
const blockHash = `0x${"c".repeat(64)}` as Hex;
const executionId = keccak256("0x1234");

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
    poolKey: poolId.toLowerCase(),
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
    stateStatus: null,
    liveFee: null,
    feeDenominator: null,
    gaugeAddress: null,
    gaugeAlive: null,
    gaugeWeight: null,
    gaugeClaimable: null,
    feesAddress: null,
    bribeAddress: null,
    stateError: null,
    stateObservedBlock: null,
    stateObservedBlockHash: null
  }]
};

const adapter = createVNextUniswapV4Adapter({
  readInventory: async () => inventory,
  quote: async () => 2_000_000n,
  readFreshness: async () => ({ blockNumber: 50_000_001n, blockHash, timestamp: BigInt(Math.floor(now / 1_000)) }),
  now: () => now
});

const request = {
  chainId: 4_663 as const,
  inputAsset: zeroAddress,
  outputAsset: token,
  inputAmountAtomic: "1000000",
  amountIn: 1_000_000n,
  recipient,
  inputIdentity: { address: zeroAddress, symbol: "ETH", decimals: 18 },
  outputIdentity: { address: token, symbol: "CONTROL", decimals: 18 },
  canonicalMarket: { sourceId: "uniswap-v4" as const, poolId }
};

async function mustReject(action: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(action, pattern);
}

async function main() {
  const [quote] = await quoteVNextExecutionProviders(request, [adapter]);
  assert(quote && quote.status === "indicative" && quote.expectedOutputAtomic && quote.protectedOutputAtomic);
  const policy = createRmtExecutionFeeV2Policy({ treasury, fromBlock: "50000000" });
  const economics = normalizeRmtExecutionFeeV2Input({
    policy,
    inputAssetId: "eip155:4663/native",
    outputAssetId: `eip155:4663/contract:${token.toLowerCase()}`,
    userGrossInputAtomic: quote.inputAmountAtomic,
    providerGrossExpectedOutputAtomic: quote.expectedOutputAtomic,
    providerProtectedOutputAtomic: quote.protectedOutputAtomic,
    settlementMode: "v2-atomic-input-fee"
  });
  const capturedCalls: { target: string; data: Hex; value: bigint; blockNumber: bigint }[] = [];
  const dependencies = {
    readCanonicalInventory: async () => inventory,
    readFreshChainEvidence: async () => ({
      chainId: 4_663,
      blockNumber: 50_000_002n,
      blockHash,
      timestampMs: now,
      executorRuntimeHash: runtimeHash,
      poolManagerRuntimeHash: poolRuntimeHash
    }),
    simulateExactCall: async (call: { target: `0x${string}`; data: Hex; value: bigint; blockNumber: bigint }) => {
      capturedCalls.push(call);
      return { actualProviderOutput: 2_000_000n, actualRmtFee: 2_500n };
    },
    now: () => now
  };
  const foundationInput = {
    quote,
    economics,
    config: {
      executor,
      executorRuntimeHash: runtimeHash,
      poolManager: getAddress(ROBINHOOD_V4_POOL_MANAGER),
      poolManagerRuntimeHash: poolRuntimeHash
    },
    executionId,
    trader,
    recipient,
    deadline: String(Math.floor(now / 1_000) + 240)
  };
  const { execution, proof } = await verifyVNextUniswapV4V2ExecutionFoundation(foundationInput, dependencies);
  assert.equal(execution.poolId, poolId);
  assert.equal(execution.poolKey.hooks, hooks);
  assert.equal(execution.providerInputAtomic, "997500");
  assert.equal(proof.calldataHash, keccak256(proof.calldata));
  assert.equal(capturedCalls[0]?.target, executor);
  assert.equal(capturedCalls[0]?.value, 1_000_000n);
  assert.equal(assertVNextUniswapV4V2FoundationContinuity(proof, execution), true);

  const tokenInputEconomics = normalizeRmtExecutionFeeV2Input({
    policy,
    inputAssetId: `eip155:4663/contract:${token.toLowerCase()}`,
    outputAssetId: "eip155:4663/native",
    userGrossInputAtomic: "1000000",
    providerGrossExpectedOutputAtomic: "2000000",
    providerProtectedOutputAtomic: "1990000",
    settlementMode: "v2-atomic-input-fee"
  });
  const tokenInput = createRmtUniswapV4FeeExecutionV2({
    ...foundationInput.config,
    executionId: keccak256("0x5678"),
    economics: tokenInputEconomics,
    trader,
    recipient,
    inputAsset: token,
    outputAsset: zeroAddress,
    deadline: foundationInput.deadline,
    poolKey
  });
  assert.equal(tokenInput.requestedInputAsset, token);
  assert.equal(encodeRmtUniswapV4FeeExecutionV2(tokenInput).startsWith("0x"), true);

  await mustReject(
    () => verifyVNextUniswapV4V2ExecutionFoundation({ ...foundationInput, recipient: treasury }, dependencies),
    /recipient changed/
  );
  await mustReject(
    () => verifyVNextUniswapV4V2ExecutionFoundation({ ...foundationInput, executionId: `0x${"0".repeat(64)}` }, dependencies),
    /execution ID/
  );
  await mustReject(
    () => verifyVNextUniswapV4V2ExecutionFoundation({
      ...foundationInput,
      config: { ...foundationInput.config, executor: treasury }
    }, { ...dependencies, readFreshChainEvidence: async () => ({
      chainId: 4_663, blockNumber: 50_000_002n, blockHash, timestampMs: now,
      executorRuntimeHash: `0x${"d".repeat(64)}` as Hex, poolManagerRuntimeHash: poolRuntimeHash
    }) }),
    /executor runtime changed/
  );
  await mustReject(
    () => verifyVNextUniswapV4V2ExecutionFoundation(foundationInput, {
      ...dependencies,
      readCanonicalInventory: async () => ({ ...inventory, pools: [] })
    }),
    /canonical inventory/
  );
  await mustReject(
    () => verifyVNextUniswapV4V2ExecutionFoundation({
      ...foundationInput,
      quote: { ...quote, expiresAtMs: now - 1 }
    }, dependencies),
    /quote is stale/
  );
  await mustReject(
    () => verifyVNextUniswapV4V2ExecutionFoundation(foundationInput, {
      ...dependencies,
      readFreshChainEvidence: async () => ({
        chainId: 4_663, blockNumber: 50_000_002n, blockHash, timestampMs: now - 30_001,
        executorRuntimeHash: runtimeHash, poolManagerRuntimeHash: poolRuntimeHash
      })
    }),
    /chain evidence is stale/
  );

  const tamperedProof = { ...proof, recipient: treasury };
  assert.throws(() => assertVNextUniswapV4V2FoundationContinuity(tamperedProof, execution), /recipient changed/);
  assert.throws(() => assertVNextUniswapV4V2FoundationContinuity({ ...proof, executionTarget: treasury }, execution), /execution target changed/);
  assert.throws(() => assertVNextUniswapV4V2FoundationContinuity({ ...proof, deadline: "1" }, execution), /deadline changed/);
  assert.throws(() => assertVNextUniswapV4V2FoundationContinuity({ ...proof, poolId: keccak256("0xab") }, execution), /PoolKey identity changed/);
  assert.throws(() => assertVNextUniswapV4V2FoundationContinuity({ ...proof, calldataHash: keccak256("0xcd") }, execution), /calldata hash changed/);
  assert.throws(() => assertVNextUniswapV4V2FoundationContinuity({ ...proof, executionId: keccak256("0xef") }, execution), /execution ID changed/);
  assert.throws(() => assertVNextUniswapV4V2FoundationContinuity(proof, { ...execution, treasury: recipient }), /treasury changed/);
  assert.throws(() => assertVNextUniswapV4V2FoundationContinuity(proof, { ...execution, userGrossInputAtomic: "1000001" }), /gross input changed/);
  assert.throws(() => assertVNextUniswapV4V2FoundationContinuity(proof, { ...execution, protectedOutputAtomic: "1" }), /protected output changed/);
  assert.throws(() => assertVNextUniswapV4V2FoundationContinuity(proof, {
    ...execution,
    poolKey: { ...execution.poolKey, hooks: treasury }
  }), /PoolId changed/);

  const topics = encodeEventTopics({
    abi: rmtUniswapV4FeeExecutorV2Abi,
    eventName: "RMTUniswapV4FeeSettledV2",
    args: { executionId, policyHash: policy.policyHash, trader }
  }) as readonly Hex[];
  const data = encodeAbiParameters(
    parseAbiParameters("bytes32 policyIdHash, uint256 policyVersion, bytes32 providerId, address poolManager, bytes32 poolId, address recipient, address requestedInputAsset, address requestedOutputAsset, address feeAsset, uint16 feeBps, uint8 feeSide, uint256 userGrossInput, uint256 providerInput, uint256 actualProviderOutput, uint256 actualRmtFee, address treasury"),
    [
      execution.policyIdHash, 2n, RMT_UNISWAP_V4_V2_PROVIDER_ID, execution.poolManager, poolId,
      recipient, zeroAddress, token, zeroAddress, 25, 0, 1_000_000n, 997_500n, 2_000_000n, 2_500n, treasury
    ]
  );
  const receipt = {
    chainId: 4_663,
    transactionHash: `0x${"e".repeat(64)}` as Hex,
    status: "success" as const,
    logs: [{ address: executor, data, topics }]
  };
  const settlement = reconcileRmtUniswapV4SettlementV2(execution, receipt);
  assert.equal(settlement?.actualProviderOutputAtomic, "2000000");
  assert.equal(settlement?.actualRmtFeeAtomic, "2500");
  assert.equal(reconcileRmtUniswapV4SettlementV2(execution, { ...receipt, logs: [] }), null);
  assert.equal(reconcileRmtUniswapV4SettlementV2(execution, { ...receipt, status: "reverted" }), null);
  assert.equal(reconcileRmtUniswapV4SettlementV2(execution, { ...receipt, logs: [receipt.logs[0], receipt.logs[0]] }), null);

  assert.equal(VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY["uniswap-v4"].state, "QUOTE_ONLY");
  assert.equal(VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY["uniswap-v4"].walletCodecImplemented, true);
  console.log("Uniswap V4 atomic execution, strict-simulation, authorization-continuity, and settlement foundations passed.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
