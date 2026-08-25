import { decodeEventLog, getAddress, isAddress, isHash, type Hash, type Hex } from "viem";
import {
  RMT_UNISWAP_V4_V2_PROVIDER_ID,
  rmtUniswapV4FeeExecutorV2Abi,
  type RmtUniswapV4FeeExecutionV2
} from "./uniswap-v4-fee-executor-v2";

export type RmtUniswapV4SettlementReceiptV2 = {
  chainId: number;
  transactionHash: Hash;
  status: "success" | "reverted";
  logs: readonly {
    address: string;
    data: Hex;
    topics: readonly Hex[];
  }[];
};

export type RmtUniswapV4SettlementEvidenceV2 = {
  state: "confirmed";
  provider: "uniswap-v4";
  transactionHash: Hash;
  executor: `0x${string}`;
  executionTarget: `0x${string}`;
  poolManager: `0x${string}`;
  executionId: Hex;
  poolId: Hex;
  inputAsset: `0x${string}`;
  outputAsset: `0x${string}`;
  recipient: `0x${string}`;
  userGrossInputAtomic: string;
  actualRmtFeeAtomic: string;
  providerInputAtomic: string;
  actualProviderOutputAtomic: string;
};

export function reconcileRmtUniswapV4SettlementV2(
  execution: RmtUniswapV4FeeExecutionV2,
  receipt: RmtUniswapV4SettlementReceiptV2
): RmtUniswapV4SettlementEvidenceV2 | null {
  if (receipt.chainId !== 4_663 || receipt.status !== "success" || !isHash(receipt.transactionHash)) return null;
  const emitterLogs = receipt.logs.filter((log) =>
    isAddress(log.address, { strict: false }) && getAddress(log.address) === execution.executor
  );
  if (emitterLogs.length !== 1 || emitterLogs[0].topics.length === 0) return null;
  try {
    const decoded = decodeEventLog({
      abi: rmtUniswapV4FeeExecutorV2Abi,
      eventName: "RMTUniswapV4FeeSettledV2",
      data: emitterLogs[0].data,
      topics: emitterLogs[0].topics as [Hex, ...Hex[]]
    });
    if (decoded.eventName !== "RMTUniswapV4FeeSettledV2") return null;
    const event = decoded.args;
    if (
      event.executionId.toLowerCase() !== execution.executionId.toLowerCase()
      || event.policyIdHash.toLowerCase() !== execution.policyIdHash.toLowerCase()
      || event.policyHash.toLowerCase() !== execution.policyHash.toLowerCase()
      || event.policyVersion !== 2n
      || event.providerId.toLowerCase() !== RMT_UNISWAP_V4_V2_PROVIDER_ID.toLowerCase()
      || getAddress(event.trader) !== execution.trader
      || getAddress(event.poolManager) !== execution.poolManager
      || event.poolId.toLowerCase() !== execution.poolId.toLowerCase()
      || getAddress(event.recipient) !== execution.recipient
      || getAddress(event.requestedInputAsset) !== execution.requestedInputAsset
      || getAddress(event.requestedOutputAsset) !== execution.requestedOutputAsset
      || getAddress(event.feeAsset) !== execution.feeAsset
      || event.feeBps !== 25
      || event.feeSide !== 0
      || event.userGrossInput !== BigInt(execution.userGrossInputAtomic)
      || event.providerInput !== BigInt(execution.providerInputAtomic)
      || event.actualRmtFee !== BigInt(execution.expectedFeeAtomic)
      || event.actualRmtFee > BigInt(execution.maximumFeeAtomic)
      || event.actualProviderOutput < BigInt(execution.protectedOutputAtomic)
      || getAddress(event.treasury) !== execution.treasury
    ) return null;
    return {
      state: "confirmed",
      provider: "uniswap-v4",
      transactionHash: receipt.transactionHash.toLowerCase() as Hash,
      executor: execution.executor,
      executionTarget: execution.executor,
      poolManager: execution.poolManager,
      executionId: execution.executionId,
      poolId: execution.poolId,
      inputAsset: execution.requestedInputAsset,
      outputAsset: execution.requestedOutputAsset,
      recipient: execution.recipient,
      userGrossInputAtomic: execution.userGrossInputAtomic,
      actualRmtFeeAtomic: event.actualRmtFee.toString(),
      providerInputAtomic: execution.providerInputAtomic,
      actualProviderOutputAtomic: event.actualProviderOutput.toString()
    };
  } catch {
    return null;
  }
}
