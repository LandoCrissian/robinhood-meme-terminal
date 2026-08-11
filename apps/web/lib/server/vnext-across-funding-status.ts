import { decodeEventLog, getAddress, isAddress, isHash, keccak256, type Address, type Hash, type Hex } from "viem";
import {
  transitionCrossChainFundingSession,
  type CrossChainFundingSession
} from "../vnext/cross-chain-funding";
import {
  ACROSS_SPOKE_POOLS,
  readAcrossSpokePoolDeployment,
  verifyAcrossSpokePoolDeployment
} from "./vnext-across-funding";
import { acrossRpcEndpoint, acrossRpcHeaders, type AcrossRpcChainId } from "./vnext-across-rpc";

const ACROSS_API_URL = "https://app.across.to/api";
const ACROSS_STATUS_TIMEOUT_MS = 8_000;
const MAX_EXCLUSIVITY_PERIOD_SECONDS = 31_536_000;

const transferEventAbi = [{
  type: "event",
  name: "Transfer",
  anonymous: false,
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false }
  ]
}] as const;

export const acrossFundsDepositedEventAbi = [{
  type: "event",
  name: "FundsDeposited",
  anonymous: false,
  inputs: [
    { name: "inputToken", type: "bytes32", indexed: false },
    { name: "outputToken", type: "bytes32", indexed: false },
    { name: "inputAmount", type: "uint256", indexed: false },
    { name: "outputAmount", type: "uint256", indexed: false },
    { name: "destinationChainId", type: "uint256", indexed: true },
    { name: "depositId", type: "uint256", indexed: true },
    { name: "quoteTimestamp", type: "uint32", indexed: false },
    { name: "fillDeadline", type: "uint32", indexed: false },
    { name: "exclusivityDeadline", type: "uint32", indexed: false },
    { name: "depositor", type: "bytes32", indexed: true },
    { name: "recipient", type: "bytes32", indexed: false },
    { name: "exclusiveRelayer", type: "bytes32", indexed: false },
    { name: "message", type: "bytes", indexed: false }
  ]
}] as const;

type JsonObject = Record<string, unknown>;

export type AcrossFundingProviderStatus = "pending" | "filled" | "expired" | "refunded";

export type AcrossFundingStatusObservation = {
  providerStatus: AcrossFundingProviderStatus;
  sourceTxHash: Hash;
  depositId: string;
  destinationTxHash: Hash | null;
  refundTxHash: Hash | null;
  destinationOutputAtomic: string;
};

export type EvmReceiptEvidence = {
  transactionHash: Hash;
  status: "success" | "reverted";
  to: Address | null;
  blockTimestamp: number;
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[];
};

export type EvmTransactionEvidence = {
  transactionHash: Hash;
  from: Address;
  to: Address | null;
  input: Hex;
  valueAtomic: string;
};

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function address(value: unknown) {
  return typeof value === "string" && isAddress(value, { strict: false }) ? getAddress(value) : null;
}

function hash(value: unknown) {
  return typeof value === "string" && isHash(value) ? value.toLowerCase() as Hash : null;
}

function consistentHash(...values: unknown[]) {
  const present = values.filter((value) => value !== null && value !== undefined);
  if (present.length === 0) return null;
  const hashes = present.map(hash);
  if (hashes.some((value) => value === null) || new Set(hashes).size !== 1) return null;
  return hashes[0];
}

function atomic(value: unknown) {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? value : null;
}

function bytes32Address(value: unknown) {
  return typeof value === "string" && /^0x0{24}[0-9a-fA-F]{40}$/.test(value)
    ? getAddress(`0x${value.slice(-40)}`)
    : null;
}

function epochSeconds(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9][0-9]{0,9}$/.test(value)) return Number(value);
  if (typeof value === "string") {
    const milliseconds = Date.parse(value);
    if (Number.isSafeInteger(milliseconds) && milliseconds > 0 && milliseconds % 1_000 === 0) return milliseconds / 1_000;
  }
  return null;
}

function depositStatus(value: unknown): AcrossFundingProviderStatus | null {
  if (value === "pending" || value === "received") return "pending";
  return value === "filled" || value === "expired" || value === "refunded" ? value : null;
}

function noAction(value: JsonObject) {
  return [
    "actionsTargetRecipient",
    "actionsTargetToken",
    "actionsTargetAmount",
    "actionsTargetTxnRef",
    "actionsTargetBlockTimestamp",
    "actionsTargetChainId",
    "swapOutputToken",
    "swapOutputTokenAmount",
    "swapTransactionHash",
    "swapToken",
    "swapTokenAmount"
  ].every((field) => value[field] === null || value[field] === undefined);
}

export function verifyAcrossFundingStatusResponse(input: {
  body: unknown;
  session: CrossChainFundingSession;
}): AcrossFundingStatusObservation {
  const root = object(input.body);
  const deposit = root && object(root.deposit);
  const session = input.session;
  if (!deposit || !session.sourceTxHash) throw new Error("Across tracking omitted the submitted deposit.");
  const status = depositStatus(deposit.status);
  const sourceTxHash = consistentHash(deposit.depositTxnRef, deposit.depositTxHash);
  const destinationTxHash = consistentHash(deposit.fillTxnRef, deposit.fillTx);
  const refundTxHash = consistentHash(deposit.depositRefundTxnRef, deposit.depositRefundTxHash);
  const depositId = typeof deposit.depositId === "string" && /^[0-9]{1,78}$/.test(deposit.depositId) ? deposit.depositId : null;
  const outputAmount = atomic(deposit.outputAmount);
  const refundAddress = deposit.depositRefundAddress === null || deposit.depositRefundAddress === undefined
    ? session.wallet
    : address(deposit.depositRefundAddress);
  if (
    !status || !sourceTxHash || sourceTxHash !== session.sourceTxHash || !depositId || !outputAmount
    || deposit.originChainId !== session.sourceChainId || deposit.destinationChainId !== session.destinationChainId
    || address(deposit.depositor) !== session.wallet || address(deposit.recipient) !== session.wallet
    || address(deposit.inputToken) !== session.sourceToken || address(deposit.outputToken) !== session.destinationToken
    || atomic(deposit.inputAmount) !== session.inputAmountAtomic || outputAmount !== session.protectedOutputAtomic
    || epochSeconds(deposit.quoteTimestamp) !== session.quoteTimestamp || epochSeconds(deposit.fillDeadline) !== session.fillDeadline
    || address(deposit.exclusiveRelayer) !== session.exclusiveRelayer
    || deposit.message !== session.message || refundAddress !== session.refundRecipient
    || !noAction(deposit)
  ) throw new Error("Across tracking data does not match the verified funding intent.");
  if (status === "filled" && !destinationTxHash) throw new Error("Across reported a fill without a destination transaction.");
  if (status !== "filled" && destinationTxHash) throw new Error("Across returned a destination transaction for an unfilled deposit.");
  if (status === "refunded" && !refundTxHash) throw new Error("Across reported a refund without an origin transaction.");
  if (status !== "refunded" && refundTxHash) throw new Error("Across returned a refund transaction before refund completion.");
  return {
    providerStatus: status,
    sourceTxHash,
    depositId,
    destinationTxHash,
    refundTxHash,
    destinationOutputAtomic: outputAmount
  };
}

function transferredTo(receipt: EvmReceiptEvidence, token: Address, recipient: Address) {
  let total = 0n;
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== token) continue;
    try {
      const decoded = decodeEventLog({ abi: transferEventAbi, eventName: "Transfer", topics: log.topics as [Hex, ...Hex[]], data: log.data });
      if (getAddress(decoded.args.to) === recipient) total += decoded.args.value;
    } catch {
      // Ignore unrelated token logs; an exact matching Transfer is required below.
    }
  }
  return total;
}

export function verifyAcrossDestinationReceipt(input: {
  session: CrossChainFundingSession;
  observation: AcrossFundingStatusObservation;
  receipt: EvmReceiptEvidence;
}) {
  const { session, observation, receipt } = input;
  if (
    observation.providerStatus !== "filled" || !observation.destinationTxHash
    || receipt.transactionHash !== observation.destinationTxHash || receipt.status !== "success"
    || receipt.to !== ACROSS_SPOKE_POOLS[session.destinationChainId]
    || transferredTo(receipt, session.destinationToken, session.wallet) < BigInt(session.protectedOutputAtomic)
  ) throw new Error("RMT could not prove the destination USDG delivery.");
  return true;
}

export function verifyAcrossRefundReceipt(input: {
  session: CrossChainFundingSession;
  observation: AcrossFundingStatusObservation;
  receipt: EvmReceiptEvidence;
}) {
  const { session, observation, receipt } = input;
  if (
    observation.providerStatus !== "refunded" || !observation.refundTxHash
    || receipt.transactionHash !== observation.refundTxHash || receipt.status !== "success"
    || transferredTo(receipt, session.refundToken, session.refundRecipient) <= 0n
  ) throw new Error("RMT could not prove the origin-chain USDC refund.");
  return true;
}

export function verifyAcrossSourceTransaction(input: {
  session: CrossChainFundingSession;
  expectedTransactionHash: Hash;
  transaction: EvmTransactionEvidence;
}) {
  const { session, expectedTransactionHash, transaction } = input;
  if (
    transaction.transactionHash !== expectedTransactionHash.toLowerCase()
    || transaction.from !== session.wallet
    || transaction.to !== session.sourceSpokePool
    || transaction.valueAtomic !== session.depositValueAtomic
    || keccak256(transaction.input).toLowerCase() !== session.depositCalldataHash
  ) throw new Error("RMT could not prove the submitted Across source transaction.");
  return true;
}

export function verifyAcrossSourceReceipt(input: {
  session: CrossChainFundingSession;
  receipt: EvmReceiptEvidence;
}) {
  const { session, receipt } = input;
  if (
    !session.sourceTxHash || receipt.transactionHash !== session.sourceTxHash
    || receipt.status !== "success" || receipt.to !== session.sourceSpokePool
  ) throw new Error("RMT could not prove the Across source deposit receipt.");
  const expectedExclusivityDeadline = session.exclusivityParameter === 0
    ? 0
    : session.exclusivityParameter <= MAX_EXCLUSIVITY_PERIOD_SECONDS
      ? receipt.blockTimestamp + session.exclusivityParameter
      : session.exclusivityParameter;
  const deposits = receipt.logs.flatMap((log) => {
    if (log.address !== session.sourceSpokePool) return [];
    try {
      const decoded = decodeEventLog({
        abi: acrossFundsDepositedEventAbi,
        eventName: "FundsDeposited",
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data
      });
      return [decoded.args];
    } catch {
      return [];
    }
  });
  if (deposits.length !== 1) throw new Error("RMT could not prove one exact Across source deposit event.");
  const deposit = deposits[0];
  const depositId = deposit.depositId.toString();
  if (
    bytes32Address(deposit.inputToken) !== session.sourceToken
    || bytes32Address(deposit.outputToken) !== session.destinationToken
    || deposit.inputAmount.toString() !== session.inputAmountAtomic
    || deposit.outputAmount.toString() !== session.protectedOutputAtomic
    || Number(deposit.destinationChainId) !== session.destinationChainId
    || !/^[0-9]{1,78}$/.test(depositId)
    || Number(deposit.quoteTimestamp) !== session.quoteTimestamp
    || Number(deposit.fillDeadline) !== session.fillDeadline
    || Number(deposit.exclusivityDeadline) !== expectedExclusivityDeadline
    || bytes32Address(deposit.depositor) !== session.wallet
    || bytes32Address(deposit.recipient) !== session.wallet
    || bytes32Address(deposit.exclusiveRelayer) !== session.exclusiveRelayer
    || deposit.message !== session.message
  ) throw new Error("RMT rejected source deposit event data that changed the verified intent.");
  return { depositId } as const;
}

export function applyAcrossFundingObservation(
  session: CrossChainFundingSession,
  observation: AcrossFundingStatusObservation,
  nowMs: number,
  receiptVerified = false
) {
  let next = session;
  if (next.depositId === null) throw new Error("Across provider status cannot establish the source deposit identity.");
  if (next.depositId !== observation.depositId) throw new Error("Across changed the deposit identifier.");
  if (observation.providerStatus === "pending") {
    if (next.state === "deposit_confirmed" || next.state === "bridging") next = transitionCrossChainFundingSession(next, { type: "fill_pending" }, nowMs + 1);
    return next;
  }
  if (observation.providerStatus === "filled") {
    if (!observation.destinationTxHash) throw new Error("Across fill evidence is incomplete.");
    if (["deposit_confirmed", "bridging", "fill_pending"].includes(next.state)) {
      next = transitionCrossChainFundingSession(next, {
        type: "destination_confirmed",
        destinationTxHash: observation.destinationTxHash,
        destinationOutputAtomic: observation.destinationOutputAtomic
      }, nowMs + 1);
    }
    return receiptVerified && next.state === "destination_confirmed"
      ? transitionCrossChainFundingSession(next, { type: "completed" }, nowMs + 2)
      : next;
  }
  if (observation.providerStatus === "expired") {
    if (["deposit_confirmed", "bridging", "fill_pending"].includes(next.state)) next = transitionCrossChainFundingSession(next, { type: "expired" }, nowMs + 1);
    return next.state === "expired" ? transitionCrossChainFundingSession(next, { type: "refund_eligible" }, nowMs + 2) : next;
  }
  if (["deposit_confirmed", "bridging", "fill_pending"].includes(next.state)) next = transitionCrossChainFundingSession(next, { type: "expired" }, nowMs + 1);
  if (next.state === "expired") next = transitionCrossChainFundingSession(next, { type: "refund_pending" }, nowMs + 2);
  if (next.state === "refund_eligible") next = transitionCrossChainFundingSession(next, { type: "refund_pending" }, nowMs + 2);
  return receiptVerified && next.state === "refund_pending"
    ? transitionCrossChainFundingSession(next, { type: "refunded", refundTxHash: observation.refundTxHash }, nowMs + 3)
    : next;
}

export async function fetchAcrossFundingStatus(session: CrossChainFundingSession, env: NodeJS.ProcessEnv = process.env) {
  if (!session.sourceTxHash) throw new Error("Across tracking requires a source transaction hash.");
  const apiKey = env.RMT_ACROSS_API_KEY?.trim();
  if (!apiKey) throw new Error("Across tracking is awaiting its server credential.");
  const url = new URL("/api/deposit", ACROSS_API_URL);
  url.searchParams.set("depositTxnRef", session.sourceTxHash);
  const response = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(ACROSS_STATUS_TIMEOUT_MS)
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(response.status === 404 ? "Across has not indexed this deposit yet." : "Across tracking is temporarily unavailable.");
  return verifyAcrossFundingStatusResponse({ body, session });
}

function rpcChainId(chainId: number): AcrossRpcChainId {
  if (chainId === 1 || chainId === 42_161 || chainId === 8_453 || chainId === 4_663) return chainId;
  throw new Error("RMT rejected an unsupported receipt chain.");
}

export async function fetchEvmTransactionEvidence(chainId: number, transactionHash: Hash, env: NodeJS.ProcessEnv = process.env) {
  const verifiedChainId = rpcChainId(chainId);
  const response = await fetch(acrossRpcEndpoint(verifiedChainId, env), {
    method: "POST",
    headers: acrossRpcHeaders(verifiedChainId, env),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [transactionHash] }),
    cache: "no-store",
    signal: AbortSignal.timeout(ACROSS_STATUS_TIMEOUT_MS)
  });
  const body = object(await response.json().catch(() => null));
  const result = body && object(body.result);
  if (!response.ok || !body || body.error) throw new Error("RMT could not read the submitted source transaction.");
  if (!result) return null;
  const observedHash = hash(result.hash);
  const from = address(result.from);
  const to = result.to === null ? null : address(result.to);
  const inputData = result.input;
  const value = result.value;
  if (
    !observedHash || observedHash !== transactionHash.toLowerCase() || !from
    || (result.to !== null && !to)
    || typeof inputData !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(inputData)
    || typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)
  ) throw new Error("RMT received a malformed source transaction.");
  return {
    transactionHash: observedHash,
    from,
    to,
    input: inputData as Hex,
    valueAtomic: BigInt(value).toString()
  } satisfies EvmTransactionEvidence;
}

export async function fetchEvmReceiptEvidence(chainId: number, transactionHash: Hash, env: NodeJS.ProcessEnv = process.env) {
  const verifiedChainId = rpcChainId(chainId);
  const endpoint = acrossRpcEndpoint(verifiedChainId, env);
  const headers = acrossRpcHeaders(verifiedChainId, env);
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [transactionHash] }),
    cache: "no-store",
    signal: AbortSignal.timeout(ACROSS_STATUS_TIMEOUT_MS)
  });
  const body = object(await response.json().catch(() => null));
  const result = body && object(body.result);
  if (!response.ok || !body || body.error) throw new Error("RMT could not read the lifecycle receipt.");
  if (!result) return null;
  const receiptHash = hash(result.transactionHash);
  const receiptTo = result.to === null ? null : address(result.to);
  const blockNumber = result.blockNumber;
  if (!receiptHash || (result.to !== null && !receiptTo) || (result.status !== "0x1" && result.status !== "0x0") || !Array.isArray(result.logs)
    || typeof blockNumber !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(blockNumber)) {
    throw new Error("RMT received a malformed lifecycle receipt.");
  }
  const blockResponse = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_getBlockByNumber", params: [blockNumber, false] }),
    cache: "no-store",
    signal: AbortSignal.timeout(ACROSS_STATUS_TIMEOUT_MS)
  });
  const blockBody = object(await blockResponse.json().catch(() => null));
  const block = blockBody && object(blockBody.result);
  const blockTimestampHex = block?.timestamp;
  if (!blockResponse.ok || !blockBody || blockBody.error || !block
    || typeof blockTimestampHex !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(blockTimestampHex)) {
    throw new Error("RMT could not read the lifecycle block timestamp.");
  }
  const blockTimestamp = Number(BigInt(blockTimestampHex));
  if (!Number.isSafeInteger(blockTimestamp) || blockTimestamp <= 0) throw new Error("RMT received an invalid lifecycle block timestamp.");
  const logs: EvmReceiptEvidence["logs"] = result.logs.map((value) => {
    const log = object(value);
    const logAddress = log && address(log.address);
    const data = log?.data;
    const topics = log?.topics;
    if (!logAddress || typeof data !== "string" || !/^0x[0-9a-fA-F]*$/.test(data) || !Array.isArray(topics)
      || !topics.every((topic) => typeof topic === "string" && /^0x[0-9a-fA-F]{64}$/.test(topic))) {
      throw new Error("RMT received a malformed lifecycle receipt log.");
    }
    return { address: logAddress, data: data as Hex, topics: topics as Hex[] };
  });
  return {
    transactionHash: receiptHash,
    status: result.status === "0x1" ? "success" : "reverted",
    to: receiptTo,
    blockTimestamp,
    logs
  } satisfies EvmReceiptEvidence;
}

export async function refreshAcrossFundingSession(session: CrossChainFundingSession, env: NodeJS.ProcessEnv = process.env) {
  let next = session;
  if (next.state === "source_submitted") {
    const deployment = await readAcrossSpokePoolDeployment(next.sourceChainId, next.sourceSpokePool, env);
    verifyAcrossSpokePoolDeployment(deployment, {
      proxyRuntimeHash: next.sourceSpokePoolRuntimeHash,
      implementationAddress: next.sourceSpokePoolImplementation,
      implementationRuntimeHash: next.sourceSpokePoolImplementationRuntimeHash
    }, "source");
    const sourceReceipt = await fetchEvmReceiptEvidence(next.sourceChainId, next.sourceTxHash!, env);
    if (!sourceReceipt) return next;
    const { depositId } = verifyAcrossSourceReceipt({ session: next, receipt: sourceReceipt });
    next = transitionCrossChainFundingSession(
      next,
      { type: "deposit_confirmed", depositId },
      Math.max(Date.now(), next.updatedAtMs + 1)
    );
  }
  let observation: AcrossFundingStatusObservation;
  try {
    observation = await fetchAcrossFundingStatus(next, env);
  } catch (cause) {
    if (cause instanceof Error && cause.message === "Across has not indexed this deposit yet.") return next;
    throw cause;
  }
  let receiptVerified = false;
  if (observation.providerStatus === "filled" && observation.destinationTxHash) {
    const deployment = await readAcrossSpokePoolDeployment(next.destinationChainId, next.destinationSpokePool, env);
    verifyAcrossSpokePoolDeployment(deployment, {
      proxyRuntimeHash: next.destinationSpokePoolRuntimeHash,
      implementationAddress: next.destinationSpokePoolImplementation,
      implementationRuntimeHash: next.destinationSpokePoolImplementationRuntimeHash
    }, "destination");
    const receipt = await fetchEvmReceiptEvidence(next.destinationChainId, observation.destinationTxHash, env);
    receiptVerified = Boolean(receipt && verifyAcrossDestinationReceipt({ session: next, observation, receipt }));
  } else if (observation.providerStatus === "refunded" && observation.refundTxHash) {
    const deployment = await readAcrossSpokePoolDeployment(next.sourceChainId, next.sourceSpokePool, env);
    verifyAcrossSpokePoolDeployment(deployment, {
      proxyRuntimeHash: next.sourceSpokePoolRuntimeHash,
      implementationAddress: next.sourceSpokePoolImplementation,
      implementationRuntimeHash: next.sourceSpokePoolImplementationRuntimeHash
    }, "source");
    const receipt = await fetchEvmReceiptEvidence(next.refundChainId, observation.refundTxHash, env);
    receiptVerified = Boolean(receipt && verifyAcrossRefundReceipt({ session: next, observation, receipt }));
  }
  return applyAcrossFundingObservation(next, observation, Math.max(Date.now(), next.updatedAtMs + 1), receiptVerified);
}
