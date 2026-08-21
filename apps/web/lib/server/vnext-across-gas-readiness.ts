import { getAddress, isAddress, isHex, keccak256, type Address, type Hex } from "viem";
import type { AcrossFundingEvidence, AcrossFundingPreparedTransactions, AcrossFundingSourceChainId } from "./vnext-across-funding";
import { acrossRpcEndpoint, acrossRpcHeaders } from "./vnext-across-rpc";

const RPC_TIMEOUT_MS = 8_000;
const GAS_SAFETY_MARGIN_BPS = 2_500 as const;
const MAX_GAS_EVIDENCE_AGE_MS = 2 * 60 * 1_000;
const MAX_OBSERVED_BLOCK_AGE_MS = 5 * 60 * 1_000;

type RpcObject = Record<string, unknown>;

export type AcrossPostQuoteGasReadinessV1 = {
  schemaVersion: "ACROSS_POST_QUOTE_GAS_READINESS_V1";
  chainId: AcrossFundingSourceChainId;
  wallet: Address;
  approvalRequired: boolean;
  approvalGasEstimate: string | null;
  depositGasEstimate: string | null;
  feeCapBasis: {
    kind: "eip1559" | "legacy";
    baseFeePerGasAtomic: string | null;
    priorityFeePerGasAtomic: string | null;
    maxFeePerGasAtomic: string;
  } | null;
  safetyMarginBps: typeof GAS_SAFETY_MARGIN_BPS;
  estimatedUpperBoundNativeRequirementAtomic: string | null;
  observedNativeBalanceAtomic: string;
  status: "sufficient" | "insufficient" | "unavailable";
  observedBlockNumber: string;
  observedBlockHash: Hex;
  observedAtMs: number;
  validUntilMs: number;
  approvalCalldataHash: Hex | null;
  depositCalldataHash: Hex;
};

function hexQuantity(value: unknown) {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value) ? BigInt(value) : null;
}

function object(value: unknown): RpcObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RpcObject : null;
}

async function rpc(chainId: AcrossFundingSourceChainId, method: string, params: unknown[], env: NodeJS.ProcessEnv) {
  const response = await fetch(acrossRpcEndpoint(chainId, env), {
    method: "POST",
    headers: acrossRpcHeaders(chainId, env),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS)
  });
  const body = await response.json().catch(() => null) as RpcObject | null;
  if (!response.ok || !body || body.error !== undefined) throw new Error("Across gas-readiness RPC failed.");
  return body.result;
}

export function acrossQuoteRemainsFreshAfterApproval(evidence: AcrossFundingEvidence, nowMs: number) {
  return Number.isSafeInteger(nowMs)
    && nowMs > 0
    && evidence.quoteExpiresAtMs > nowMs
    && evidence.fillDeadline * 1_000 > nowMs;
}

export function evaluateAcrossPostQuoteGasReadiness(input: Omit<AcrossPostQuoteGasReadinessV1,
  "schemaVersion" | "safetyMarginBps" | "estimatedUpperBoundNativeRequirementAtomic" | "status">) {
  const approvalGas = input.approvalRequired ? input.approvalGasEstimate : "0";
  const complete = approvalGas !== null && input.depositGasEstimate !== null && input.feeCapBasis !== null;
  const baseRequirement = complete
    ? (BigInt(approvalGas) + BigInt(input.depositGasEstimate!)) * BigInt(input.feeCapBasis!.maxFeePerGasAtomic)
    : null;
  const upperBound = baseRequirement === null
    ? null
    : ((baseRequirement * BigInt(10_000 + GAS_SAFETY_MARGIN_BPS) + 9_999n) / 10_000n).toString();
  const status = upperBound === null
    ? "unavailable" as const
    : BigInt(input.observedNativeBalanceAtomic) >= BigInt(upperBound)
      ? "sufficient" as const
      : "insufficient" as const;
  return {
    schemaVersion: "ACROSS_POST_QUOTE_GAS_READINESS_V1" as const,
    ...input,
    safetyMarginBps: GAS_SAFETY_MARGIN_BPS,
    estimatedUpperBoundNativeRequirementAtomic: upperBound,
    status
  };
}

export async function readAcrossPostQuoteGasReadiness(input: {
  prepared: AcrossFundingPreparedTransactions;
  wallet: Address;
  nowMs?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<AcrossPostQuoteGasReadinessV1> {
  const env = input.env ?? process.env;
  const nowMs = input.nowMs ?? Date.now();
  const { prepared } = input;
  const chainId = prepared.evidence.sourceChainId;
  if (!isAddress(input.wallet) || getAddress(input.wallet) !== prepared.evidence.depositor
    || prepared.depositTransaction.chainId !== chainId
    || prepared.depositTransaction.target !== prepared.evidence.depositTarget
    || prepared.depositTransaction.value !== "0"
    || keccak256(prepared.depositTransaction.data) !== prepared.evidence.depositCalldataHash
    || !acrossQuoteRemainsFreshAfterApproval(prepared.evidence, nowMs)) {
    throw new Error("RMT rejected stale or mutated post-quote gas evidence.");
  }
  if (prepared.approvalRequired && (!prepared.approvalTransaction
    || prepared.approvalTransaction.chainId !== chainId
    || prepared.approvalTransaction.target !== prepared.evidence.sourceToken
    || prepared.approvalTransaction.value !== "0")) {
    throw new Error("RMT rejected a mutated exact approval transaction.");
  }

  const chainIdHex = await rpc(chainId, "eth_chainId", [], env);
  if (hexQuantity(chainIdHex) !== BigInt(chainId)) throw new Error("Across gas-readiness RPC returned the wrong chain.");
  const rawBlock = object(await rpc(chainId, "eth_getBlockByNumber", ["latest", false], env));
  const blockNumber = rawBlock ? hexQuantity(rawBlock.number) : null;
  const blockHash = rawBlock && typeof rawBlock.hash === "string" && isHex(rawBlock.hash) && rawBlock.hash.length === 66
    ? rawBlock.hash as Hex : null;
  const timestamp = rawBlock ? hexQuantity(rawBlock.timestamp) : null;
  if (blockNumber === null || !blockHash || timestamp === null) throw new Error("Across gas-readiness RPC returned an invalid block.");
  const observedAtMs = Number(timestamp) * 1_000;
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs > nowMs + 30_000 || observedAtMs < nowMs - MAX_OBSERVED_BLOCK_AGE_MS) {
    throw new Error("Across gas-readiness evidence block is stale.");
  }
  const blockTag = `0x${blockNumber.toString(16)}`;
  const nativeBalance = hexQuantity(await rpc(chainId, "eth_getBalance", [input.wallet, blockTag], env));
  if (nativeBalance === null) throw new Error("Across gas-readiness RPC returned an invalid native balance.");

  let approvalGas: bigint | null = 0n;
  let depositGas: bigint | null = null;
  try {
    if (prepared.approvalTransaction) {
      approvalGas = hexQuantity(await rpc(chainId, "eth_estimateGas", [{
        from: input.wallet,
        to: prepared.approvalTransaction.target,
        data: prepared.approvalTransaction.data,
        value: "0x0"
      }, blockTag], env));
    }
    depositGas = hexQuantity(await rpc(chainId, "eth_estimateGas", [{
      from: input.wallet,
      to: prepared.depositTransaction.target,
      data: prepared.depositTransaction.data,
      value: "0x0"
    }, blockTag], env));
  } catch {
    approvalGas = prepared.approvalRequired ? null : 0n;
    depositGas = null;
  }

  let feeCapBasis: AcrossPostQuoteGasReadinessV1["feeCapBasis"] = null;
  const baseFee = rawBlock ? hexQuantity(rawBlock.baseFeePerGas) : null;
  try {
    if (baseFee !== null) {
      const priority = hexQuantity(await rpc(chainId, "eth_maxPriorityFeePerGas", [], env));
      if (priority !== null) feeCapBasis = {
        kind: "eip1559",
        baseFeePerGasAtomic: baseFee.toString(),
        priorityFeePerGasAtomic: priority.toString(),
        maxFeePerGasAtomic: (baseFee * 2n + priority).toString()
      };
    } else {
      const gasPrice = hexQuantity(await rpc(chainId, "eth_gasPrice", [], env));
      if (gasPrice !== null) feeCapBasis = {
        kind: "legacy",
        baseFeePerGasAtomic: null,
        priorityFeePerGasAtomic: null,
        maxFeePerGasAtomic: gasPrice.toString()
      };
    }
  } catch {
    feeCapBasis = null;
  }
  const reread = object(await rpc(chainId, "eth_getBlockByNumber", [blockTag, false], env));
  if (!reread || typeof reread.hash !== "string" || reread.hash.toLowerCase() !== blockHash.toLowerCase()) {
    throw new Error("Across gas-readiness evidence block was replaced during observation.");
  }

  return evaluateAcrossPostQuoteGasReadiness({
    chainId,
    wallet: getAddress(input.wallet),
    approvalRequired: prepared.approvalRequired,
    approvalGasEstimate: approvalGas?.toString() ?? null,
    depositGasEstimate: depositGas?.toString() ?? null,
    feeCapBasis,
    observedNativeBalanceAtomic: nativeBalance.toString(),
    observedBlockNumber: blockNumber.toString(),
    observedBlockHash: blockHash,
    observedAtMs,
    validUntilMs: Math.min(prepared.evidence.quoteExpiresAtMs, nowMs + MAX_GAS_EVIDENCE_AGE_MS),
    approvalCalldataHash: prepared.approvalTransaction ? keccak256(prepared.approvalTransaction.data) : null,
    depositCalldataHash: keccak256(prepared.depositTransaction.data)
  });
}
