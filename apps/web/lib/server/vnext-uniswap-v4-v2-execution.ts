import { getAddress, isAddress, isHash, keccak256, zeroAddress, type Address, type Hex } from "viem";
import { ROBINHOOD_V4_POOL_MANAGER } from "../uniswap-v4";
import type { VNextQuoteAttempt } from "../vnext/quote-observation";
import {
  assertRmtExecutionFeeV2Economics,
  type RmtExecutionFeeV2Economics
} from "../vnext/execution-fee-policy-v2";
import {
  assertRmtUniswapV4FeeCalldataV2,
  assertRmtUniswapV4FeeExecutionV2,
  createRmtUniswapV4FeeExecutionV2,
  encodeRmtUniswapV4FeeExecutionV2,
  RMT_UNISWAP_V4_V2_IMPLEMENTATION_ID,
  RMT_UNISWAP_V4_V2_PROVIDER_ID,
  rmtUniswapV4PoolIdV2,
  type RmtUniswapV4FeeExecutionV2,
  type RmtUniswapV4PoolKeyV2
} from "../vnext/uniswap-v4-fee-executor-v2";
import type { VNextCanonicalMarketInventoryResult } from "./vnext-market-indexer";

const MAX_CHAIN_EVIDENCE_AGE_MS = 30_000;
const ZERO_HASH = `0x${"0".repeat(64)}`;

export type VNextUniswapV4V2FoundationConfig = {
  executor: Address;
  executorRuntimeHash: Hex;
  poolManager: Address;
  poolManagerRuntimeHash: Hex;
};

export type VNextUniswapV4V2FoundationProof = {
  state: "verified_atomic_foundation";
  implementationId: typeof RMT_UNISWAP_V4_V2_IMPLEMENTATION_ID;
  provider: "uniswap-v4";
  providerId: Hex;
  settlementMode: "v2-atomic-input-fee";
  chainId: 4_663;
  executionTarget: Address;
  providerTarget: Address;
  executionId: Hex;
  recipient: Address;
  inputAsset: Address;
  outputAsset: Address;
  inputAmountAtomic: string;
  protectedOutputAtomic: string;
  deadline: string;
  poolKey: RmtUniswapV4PoolKeyV2;
  poolId: Hex;
  hooks: Address;
  feeEconomics: RmtExecutionFeeV2Economics;
  calldata: Hex;
  calldataHash: Hex;
  simulatedOutputAtomic: string;
  simulatedFeeAtomic: string;
  simulationBlock: string;
  simulationBlockHash: Hex;
  quoteObservedBlock: string;
  quoteObservedBlockHash: Hex;
  verifiedAtMs: number;
};

export type VNextUniswapV4V2FoundationDependencies = {
  readCanonicalInventory: (query: {
    token: string;
    source: "uniswap-v4";
    limit: number;
  }) => Promise<VNextCanonicalMarketInventoryResult>;
  readFreshChainEvidence: () => Promise<{
    chainId: number;
    blockNumber: bigint;
    blockHash: Hex;
    timestampMs: number;
    executorRuntimeHash: Hex;
    poolManagerRuntimeHash: Hex;
  }>;
  simulateExactCall: (request: {
    chainId: 4_663;
    account: Address;
    target: Address;
    data: Hex;
    value: bigint;
    blockNumber: bigint;
  }) => Promise<{ actualProviderOutput: bigint; actualRmtFee: bigint }>;
  now?: () => number;
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`RMT rejected Uniswap V4 strict-verification foundation: ${message}.`);
}

function exactAddress(value: string, label: string) {
  invariant(isAddress(value, { strict: false }), `${label} is invalid`);
  return getAddress(value);
}

function exactHash(value: string, label: string) {
  invariant(isHash(value) && value.toLowerCase() !== ZERO_HASH, `${label} is invalid`);
  return value.toLowerCase() as Hex;
}

function quotePoolKey(quote: VNextQuoteAttempt): RmtUniswapV4PoolKeyV2 {
  invariant(quote.provider === "uniswap-v4" && quote.status === "indicative", "quote is not indicative Uniswap V4 evidence");
  invariant(quote.chainId === 4_663 && quote.v4Evidence, "quote has no exact V4 evidence");
  return {
    currency0: exactAddress(quote.v4Evidence.currency0, "quote currency0"),
    currency1: exactAddress(quote.v4Evidence.currency1, "quote currency1"),
    fee: quote.v4Evidence.fee,
    tickSpacing: quote.v4Evidence.tickSpacing,
    hooks: exactAddress(quote.v4Evidence.hooks, "quote hooks")
  };
}

export async function verifyVNextUniswapV4V2ExecutionFoundation(input: {
  quote: VNextQuoteAttempt;
  economics: RmtExecutionFeeV2Economics;
  config: VNextUniswapV4V2FoundationConfig;
  executionId: Hex;
  trader: string;
  recipient: string;
  deadline: string;
}, dependencies: VNextUniswapV4V2FoundationDependencies): Promise<{
  execution: RmtUniswapV4FeeExecutionV2;
  proof: VNextUniswapV4V2FoundationProof;
}> {
  const now = dependencies.now?.() ?? Date.now();
  const quote = input.quote;
  invariant(
    quote.status === "indicative" && quote.expectedOutputAtomic && quote.protectedOutputAtomic
      && quote.expiresAtMs !== null && quote.quotedAtMs !== null,
    "quote has no executable economics"
  );
  const expiresAtMs = quote.expiresAtMs;
  const quotedAtMs = quote.quotedAtMs;
  invariant(expiresAtMs >= now && quotedAtMs <= now, "quote is stale");
  invariant(quote.v4Evidence && now - quote.v4Evidence.observedAtMs <= MAX_CHAIN_EVIDENCE_AGE_MS, "quote chain evidence is stale");
  invariant(input.economics.inputAsset.endsWith(quote.inputAsset.toLowerCase()) || (quote.inputAsset === zeroAddress && input.economics.inputAsset.endsWith("/native")), "economics input changed");
  invariant(input.economics.outputAsset.endsWith(quote.outputAsset.toLowerCase()) || (quote.outputAsset === zeroAddress && input.economics.outputAsset.endsWith("/native")), "economics output changed");
  invariant(input.economics.userGrossInputAtomic === quote.inputAmountAtomic, "gross input changed");
  invariant(input.economics.providerGrossExpectedOutputAtomic === quote.expectedOutputAtomic, "expected output changed");
  invariant(input.economics.providerProtectedOutputAtomic === quote.protectedOutputAtomic, "protected output changed");
  assertRmtExecutionFeeV2Economics(input.economics);

  const executor = exactAddress(input.config.executor, "executor");
  const poolManager = exactAddress(input.config.poolManager, "PoolManager");
  invariant(poolManager === getAddress(ROBINHOOD_V4_POOL_MANAGER), "PoolManager target changed");
  const executorRuntimeHash = exactHash(input.config.executorRuntimeHash, "executor runtime hash");
  const poolManagerRuntimeHash = exactHash(input.config.poolManagerRuntimeHash, "PoolManager runtime hash");
  const trader = exactAddress(input.trader, "trader");
  const recipient = exactAddress(input.recipient, "recipient");
  invariant(recipient === getAddress(quote.v4Evidence!.recipient), "recipient changed from quote evidence");
  const poolKey = quotePoolKey(quote);
  const poolId = rmtUniswapV4PoolIdV2(poolKey);
  invariant(poolId.toLowerCase() === quote.v4Evidence!.poolId.toLowerCase(), "quoted PoolId does not match its PoolKey");

  const inventoryToken = quote.inputAsset === zeroAddress ? quote.outputAsset : quote.inputAsset;
  const inventory = await dependencies.readCanonicalInventory({
    token: inventoryToken.toLowerCase(),
    source: "uniswap-v4",
    limit: 100
  });
  invariant(inventory.status === "verified_shadow", "canonical inventory is unavailable");
  const canonical = inventory.pools.find((pool) =>
    pool.sourceId === "uniswap-v4"
    && pool.protocol === "uniswap"
    && pool.version === 4
    && pool.poolAddress === null
    && pool.poolKey === poolId.toLowerCase()
    && pool.token0 === poolKey.currency0.toLowerCase()
    && pool.token1 === poolKey.currency1.toLowerCase()
    && pool.fee === poolKey.fee
    && pool.tickSpacing === poolKey.tickSpacing
    && pool.hooks === poolKey.hooks.toLowerCase()
  );
  invariant(Boolean(canonical), "canonical inventory does not bind the quoted PoolKey");

  const chain = await dependencies.readFreshChainEvidence();
  invariant(chain.chainId === 4_663, "chain changed");
  invariant(chain.timestampMs <= now && now - chain.timestampMs <= MAX_CHAIN_EVIDENCE_AGE_MS, "chain evidence is stale");
  invariant(exactHash(chain.executorRuntimeHash, "observed executor runtime hash") === executorRuntimeHash, "executor runtime changed");
  invariant(exactHash(chain.poolManagerRuntimeHash, "observed PoolManager runtime hash") === poolManagerRuntimeHash, "PoolManager runtime changed");
  invariant(chain.blockNumber >= BigInt(quote.v4Evidence!.observedBlock), "simulation block predates quote evidence");
  const execution = createRmtUniswapV4FeeExecutionV2({
    executor,
    executorRuntimeHash,
    poolManager,
    poolManagerRuntimeHash,
    executionId: exactHash(input.executionId, "execution ID"),
    economics: input.economics,
    trader,
    recipient,
    inputAsset: quote.inputAsset,
    outputAsset: quote.outputAsset,
    deadline: input.deadline,
    poolKey
  });
  const calldata = encodeRmtUniswapV4FeeExecutionV2(execution);
  assertRmtUniswapV4FeeCalldataV2(calldata, execution, input.economics);
  const simulation = await dependencies.simulateExactCall({
    chainId: 4_663,
    account: trader,
    target: executor,
    data: calldata,
    value: quote.inputAsset === zeroAddress ? BigInt(quote.inputAmountAtomic) : 0n,
    blockNumber: chain.blockNumber
  });
  invariant(simulation.actualRmtFee === BigInt(input.economics.expectedFeeAtomic), "simulation fee changed");
  invariant(simulation.actualProviderOutput >= BigInt(input.economics.providerProtectedOutputAtomic), "simulation output is below protection");
  const proof: VNextUniswapV4V2FoundationProof = {
    state: "verified_atomic_foundation",
    implementationId: RMT_UNISWAP_V4_V2_IMPLEMENTATION_ID,
    provider: "uniswap-v4",
    providerId: RMT_UNISWAP_V4_V2_PROVIDER_ID,
    settlementMode: "v2-atomic-input-fee",
    chainId: 4_663,
    executionTarget: executor,
    providerTarget: poolManager,
    executionId: execution.executionId,
    recipient,
    inputAsset: execution.requestedInputAsset,
    outputAsset: execution.requestedOutputAsset,
    inputAmountAtomic: execution.userGrossInputAtomic,
    protectedOutputAtomic: execution.protectedOutputAtomic,
    deadline: execution.deadline,
    poolKey,
    poolId,
    hooks: poolKey.hooks,
    feeEconomics: input.economics,
    calldata,
    calldataHash: keccak256(calldata),
    simulatedOutputAtomic: simulation.actualProviderOutput.toString(),
    simulatedFeeAtomic: simulation.actualRmtFee.toString(),
    simulationBlock: chain.blockNumber.toString(),
    simulationBlockHash: exactHash(chain.blockHash, "simulation block hash"),
    quoteObservedBlock: quote.v4Evidence!.observedBlock,
    quoteObservedBlockHash: exactHash(quote.v4Evidence!.observedBlockHash, "quote block hash"),
    verifiedAtMs: now
  };
  assertVNextUniswapV4V2FoundationContinuity(proof, execution);
  return { execution, proof };
}

export function assertVNextUniswapV4V2FoundationContinuity(
  proof: VNextUniswapV4V2FoundationProof,
  execution: RmtUniswapV4FeeExecutionV2
) {
  assertRmtUniswapV4FeeExecutionV2(execution, proof.feeEconomics);
  invariant(proof.provider === "uniswap-v4" && proof.providerId === RMT_UNISWAP_V4_V2_PROVIDER_ID, "provider changed");
  invariant(proof.chainId === 4_663 && proof.settlementMode === "v2-atomic-input-fee", "settlement changed");
  invariant(proof.executionTarget === execution.executor && proof.providerTarget === execution.poolManager, "execution target changed");
  invariant(proof.executionId === execution.executionId, "execution ID changed");
  invariant(proof.recipient === execution.recipient, "recipient changed");
  invariant(proof.inputAsset === execution.requestedInputAsset && proof.outputAsset === execution.requestedOutputAsset, "assets changed");
  invariant(proof.inputAmountAtomic === execution.userGrossInputAtomic, "input amount changed");
  invariant(proof.protectedOutputAtomic === execution.protectedOutputAtomic, "minimum output changed");
  invariant(proof.deadline === execution.deadline, "deadline changed");
  invariant(proof.poolId === execution.poolId && proof.hooks === execution.poolKey.hooks, "PoolKey identity changed");
  invariant(proof.calldataHash.toLowerCase() === keccak256(proof.calldata).toLowerCase(), "calldata hash changed");
  invariant(proof.calldata.toLowerCase() === encodeRmtUniswapV4FeeExecutionV2(execution).toLowerCase(), "calldata changed");
  return true;
}
