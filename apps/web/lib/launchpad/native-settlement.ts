import { isAddress, isHash, keccak256, stringToHex, zeroAddress,
  type Address, type Hash, type PublicClient, type TransactionReceipt } from "viem";
import { normalizeNativeTrace, type NormalizedNativeTrace } from "../vnext/normalized-native-trace";
import { launchPoolId, type LaunchPoolKey, type NewLaunchRecord } from "./launch-record";
import { boundedReceiptLogs } from "./receipt-logs";
import type { LaunchRequest } from "./transactions";

const maxOutput = (1n << 127n) - 1n;
const traceDeadlineMs = 15_000;
const sourceLabel = /^[a-z][a-z0-9-]{0,31}$/;
const amountString = /^[1-9][0-9]{0,38}$/;
const heightString = /^(?:0|[1-9][0-9]{0,15})$/;
const namedHost = /^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*$/;

type PendingReason = "unavailable" | "malformed" | "rate_limited" | "disagreement" | "stale" | "payout_unproven";
const messages: Record<PendingReason, string> = {
  unavailable: "Native ETH settlement is pending: the call trace is unavailable.",
  malformed: "Native ETH settlement is pending: the call trace could not be verified.",
  rate_limited: "Native ETH settlement is pending: the provider is rate limiting verification.",
  disagreement: "Native ETH settlement is pending: receipt or trace evidence disagrees.",
  stale: "Native ETH settlement is pending: the canonical receipt could not be rechecked.",
  payout_unproven: "The exact native ETH payout is not verified yet.",
};

export class NativeSettlementPending extends Error {
  constructor(readonly reason: PendingReason) {
    super(messages[reason]);
    this.name = "NativeSettlementPending";
  }
}

type ProofMode = "local_trace" | "simulated_agreement" | "independent_agreement";
type NativeSettlementIdentity = {
  chainId: number;
  poolManager: Address;
  factory: Address;
  poolId: Hash;
  poolKey: LaunchPoolKey;
  blockHash: Hash;
  blockNumber: string;
  transactionHash: Hash;
  receiptHash: Hash;
  logIndex: number;
  account: Address;
  router: Address;
  calldataHash: Hash;
  amountAtomic: string;
};
export type NativeSettlementProof = NativeSettlementIdentity & {
  mode: ProofMode;
  sources: string[];
  evidenceHash: Hash;
  observedAtMs: number;
};
export type NativeSettlementOptions = {
  primarySource?: string;
  corroboration?: { mode: "independent" | "simulation"; source: string; client: PublicClient };
  saveProof?: (proof: NativeSettlementProof) => void | Promise<void>;
};

const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
const hash = (value: unknown) => keccak256(stringToHex(JSON.stringify(value)));

/** Encodes the exact verified payout meaning, independent of provider-specific trace formatting. */
export function nativeSettlementEvidenceHash(identity: NativeSettlementIdentity): Hash {
  const { chainId, poolManager, factory, poolId, poolKey, blockHash, blockNumber, transactionHash, receiptHash, logIndex,
    account, router, calldataHash, amountAtomic } = identity;
  return hash(["rmt-launch-native-settlement-v1", chainId, poolManager.toLowerCase(), factory.toLowerCase(),
    poolId.toLowerCase(), poolKey.currency0.toLowerCase(), poolKey.currency1.toLowerCase(), poolKey.fee, poolKey.tickSpacing,
    poolKey.hooks.toLowerCase(), blockHash.toLowerCase(), blockNumber, transactionHash.toLowerCase(), receiptHash.toLowerCase(), logIndex,
    account.toLowerCase(), router.toLowerCase(), calldataHash.toLowerCase(), amountAtomic]);
}

export function isNativeSettlementProof(proof: NativeSettlementProof): boolean {
  if (!proof || !proof.poolKey || !Array.isArray(proof.sources) || !["local_trace", "simulated_agreement", "independent_agreement"].includes(proof.mode)
    || proof.sources.length !== (proof.mode === "local_trace" ? 1 : 2)
    || new Set(proof.sources).size !== proof.sources.length || proof.sources.some((source) => typeof source !== "string" || !sourceLabel.test(source))
    || !Number.isSafeInteger(proof.chainId) || proof.chainId <= 0 || !Number.isSafeInteger(proof.logIndex) || proof.logIndex < 0
    || typeof proof.blockNumber !== "string" || !heightString.test(proof.blockNumber) || !Number.isSafeInteger(Number(proof.blockNumber))
    || typeof proof.amountAtomic !== "string" || !amountString.test(proof.amountAtomic) || BigInt(proof.amountAtomic) > maxOutput
    || !Number.isSafeInteger(proof.observedAtMs) || proof.observedAtMs <= 0
    || ![proof.poolId, proof.blockHash, proof.transactionHash, proof.receiptHash, proof.calldataHash, proof.evidenceHash]
      .every((value) => typeof value === "string" && isHash(value))
    || ![proof.poolManager, proof.factory, proof.account, proof.router, proof.poolKey.currency1, proof.poolKey.hooks]
      .every((value) => typeof value === "string" && isAddress(value, { strict: false }))
    || ![proof.poolManager, proof.factory, proof.account, proof.router, proof.poolKey.currency1].every((value) => !same(value, zeroAddress))
    || !same(proof.poolKey.currency0, zeroAddress) || proof.poolKey.fee !== 3000 || proof.poolKey.tickSpacing !== 60
    || (!same(proof.poolKey.hooks, zeroAddress) && (BigInt(proof.poolKey.hooks) & 0x3fffn) !== 0x2000n)
    || !same(proof.poolId, launchPoolId(proof.poolKey))) return false;
  return same(proof.evidenceHash, nativeSettlementEvidenceHash(proof));
}

function receiptDigest(receipt: TransactionReceipt): Hash {
  const logs = [...boundedReceiptLogs(receipt)].sort((left, right) => left.logIndex - right.logIndex).map((log) =>
    [log.logIndex, log.address.toLowerCase(), log.topics.map((topic) => topic.toLowerCase()), log.data.toLowerCase()]);
  return hash([receipt.transactionHash.toLowerCase(), receipt.blockHash.toLowerCase(), receipt.blockNumber.toString(),
    receipt.transactionIndex, receipt.from.toLowerCase(), receipt.to?.toLowerCase(), receipt.status, logs]);
}

function rpcFailure(error: unknown, otherwise: PendingReason): NativeSettlementPending {
  for (let depth = 0; depth < 6 && error && typeof error === "object"; depth++) {
    const detail = error as { status?: number; code?: number; cause?: unknown };
    if (detail.status === 429 || detail.code === 429 || detail.code === -32005) return new NativeSettlementPending("rate_limited");
    error = detail.cause;
  }
  return new NativeSettlementPending(otherwise);
}

function independentOrigin(client: PublicClient): string | undefined {
  const transport = client.transport as { type?: string; url?: string };
  if (transport?.type !== "http" || !transport.url) return;
  try {
    const url = new URL(transport.url);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol === "https:" && namedHost.test(host) && !/\.(?:localhost|local|localdomain)$/.test(host)) return host;
  } catch { /* Transport metadata cannot establish a distinct source. */ }
}

function nativePayout(trace: NormalizedNativeTrace, manager: Address, account: Address): bigint {
  if (trace.error) return 0n;
  const ownValue = trace.type === "CALL" && same(trace.from, manager) && same(trace.to, account) ? BigInt(trace.value!) : 0n;
  return ownValue + trace.calls.reduce((sum, call) => sum + nativePayout(call, manager, account), 0n);
}

type RebindReceipt = (rpc: PublicClient, hash: Hash) => Promise<TransactionReceipt>;
type SettlementRecord = Pick<NewLaunchRecord, "factory" | "poolManager" | "poolKey" | "poolId"> & { chainId: number };
type SettlementRequest = Pick<LaunchRequest, "from" | "to" | "data" | "value">;
export async function verifyNativeSettlement(
  client: PublicClient, receipt: TransactionReceipt, record: SettlementRecord, request: SettlementRequest,
  logIndex: number, output: bigint, rebindReceipt: RebindReceipt,
  options: NativeSettlementOptions = {},
) {
  const primarySource = options.primarySource ?? "local-fork";
  const second = options.corroboration;
  if (typeof primarySource !== "string" || !sourceLabel.test(primarySource) || (second && (typeof second.source !== "string"
    || !sourceLabel.test(second.source) || second.source === primarySource
    || second.client === client || !["simulation", "independent"].includes(second.mode)))) {
    throw new NativeSettlementPending("disagreement");
  }
  if (second?.mode === "independent") {
    const firstOrigin = independentOrigin(client);
    const secondOrigin = independentOrigin(second.client);
    if (!options.primarySource || !firstOrigin || !secondOrigin || firstOrigin === secondOrigin) {
      throw new NativeSettlementPending("disagreement");
    }
  }

  const original = receiptDigest(receipt);
  const calldataHash = keccak256(request.data);
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const assertFresh = async (source: PublicClient, mismatch: PendingReason) => {
    let fresh: TransactionReceipt;
    let freshDigest: Hash;
    try {
      fresh = await rebindReceipt(source, receipt.transactionHash);
      freshDigest = receiptDigest(fresh);
    }
    catch (error) { throw rpcFailure(error, "stale"); }
    if (freshDigest !== original) throw new NativeSettlementPending(mismatch);
  };
  const inspect = async (source: PublicClient, corroborating: boolean) => {
    if (corroborating) await assertFresh(source, "disagreement");
    if (closed) throw new NativeSettlementPending("unavailable");
    let raw: unknown;
    try {
      raw = await source.request({ method: "debug_traceTransaction",
        params: [receipt.transactionHash, { tracer: "callTracer" }],
      } as never, { retryCount: 0 });
    } catch (error) { throw rpcFailure(error, "unavailable"); }
    if (raw === null || raw === undefined) throw new NativeSettlementPending("payout_unproven");
    let trace: NormalizedNativeTrace;
    try { trace = normalizeNativeTrace(raw); }
    catch { throw new NativeSettlementPending("malformed"); }
    if (!same(trace.from, request.from) || !same(trace.to, request.to) || trace.inputHash !== calldataHash
      || BigInt(trace.value!) !== BigInt(request.value)) throw new NativeSettlementPending("disagreement");
    if (closed) throw new NativeSettlementPending("unavailable");
    await assertFresh(source, corroborating ? "disagreement" : "stale");
    return nativePayout(trace, record.poolManager, request.from);
  };
  try {
    const [primaryPayout, witnessPayout] = await Promise.race([
      Promise.all([inspect(client, false), ...(second ? [inspect(second.client, true)] : [])]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new NativeSettlementPending("unavailable")), traceDeadlineMs);
      }),
    ]);
    if (witnessPayout !== undefined && witnessPayout !== primaryPayout) throw new NativeSettlementPending("disagreement");
    if (primaryPayout !== output) throw new NativeSettlementPending("payout_unproven");
  } finally {
    closed = true;
    if (timer) clearTimeout(timer);
  }

  const identity = { chainId: record.chainId, poolManager: record.poolManager, factory: record.factory,
    poolId: record.poolId, poolKey: record.poolKey, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber.toString(),
    transactionHash: receipt.transactionHash, receiptHash: original, logIndex, account: request.from, router: request.to, calldataHash,
    amountAtomic: output.toString() };
  const mode = second ? second.mode === "independent" ? "independent_agreement" : "simulated_agreement" : "local_trace";
  const proof: NativeSettlementProof = { ...identity, mode, sources: second ? [primarySource, second.source] : [primarySource],
    evidenceHash: nativeSettlementEvidenceHash(identity), observedAtMs: Date.now() };
  if (!isNativeSettlementProof(proof)) throw new NativeSettlementPending("malformed");
  try { await options.saveProof?.(proof); }
  catch { throw new NativeSettlementPending("unavailable"); }
  return proof;
}
