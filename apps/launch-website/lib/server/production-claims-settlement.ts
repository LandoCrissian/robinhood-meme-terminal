import { parseAbi, parseEventLogs, zeroHash, type Hash } from "viem";
import { claimProfileDigest, isClaimExecutionReview, type ClaimExecutionReview } from "../claim-profiles";
import { claimSettlementProfile, claimFinality, type ClaimActivityIdentity, type ClaimFinalityPolicy,
  type ClaimIndexedEvidence, type ClaimSettlementPoint, type ClaimSettlementResult } from "../production-claims";
import { claimCalldataMatches } from "../earnings-claims";
import { isTransactionHash } from "../test-creation";
import { verifyClaimExecutionProfileAt } from "./claim-profiles";
import { recoverEarningsClaimHash, verifyProfiledEarningsClaim, type EarningsSettlementInput } from "./earnings-claims";
import { readEarningsContracts, readFactoryCreationFees, type EarningsReadContext, type EarningsRegistration, type EarningsRpc } from "./earnings-contracts";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
// Safe v1.4.1 contracts/Safe.sol indexes txHash. The payment is the sole
// non-indexed argument. Match the pinned implementation's actual log layout.
const safeEvents = parseAbi(["event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)", "event ExecutionFailure(bytes32 indexed txHash,uint256 payment)"]);
const productionSources = { official: "https://rpc.mainnet.chain.robinhood.com", pocket: "https://robinhood.api.pocket.network" } as const;
const allowedMethods = new Set(["getChainId", "getBlock", "getCode", "getTransactionCount", "getTransaction", "getTransactionReceipt",
  "getBalance", "getStorageAt", "readContract", "call", "estimateGas", "getGasPrice", "estimateMaxPriorityFeePerGas", "request"]);
const allowedRpc = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getCode", "eth_getTransactionCount", "eth_getTransactionByHash",
  "eth_getTransactionReceipt", "eth_getBalance", "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_getStorageAt", "debug_traceTransaction"]);

export type ClaimSettlementProvider = { id: string; context: EarningsReadContext };
export type ClaimSettlementInput = {
  contexts: readonly [ClaimSettlementProvider, ClaimSettlementProvider]; review: ClaimExecutionReview; registration?: EarningsRegistration;
  transactionHash?: Hash; indexed?: (activity: ClaimActivityIdentity, checkpoint: ClaimSettlementPoint) => Promise<ClaimIndexedEvidence | null>;
  finalityPolicy?: ClaimFinalityPolicy;
};
type Proof = {
  status: "submitted" | "receipt-observed" | "confirmed" | "reverted" | "unavailable";
  reason?: string; hash?: Hash; outerReceiptStatus?: "success" | "reverted"; innerExecution?: "success" | "reverted" | "unproven";
  checkpoint?: ClaimSettlementPoint; activity?: ClaimActivityIdentity;
};
const point = (b: { number: bigint; hash: Hash | null; timestamp: bigint }): ClaimSettlementPoint => {
  if (!b.hash) throw Error("Canonical header missing");
  return { blockNumber: b.number.toString(), blockHash: b.hash, timestamp: new Date(Number(b.timestamp) * 1000).toISOString() };
};

/** Bound public method dispatch as well as ABI calls. Verification has no write
 * RPC capability, no retry loop and no unbounded trace/history scan. */
export function boundedClaimVerificationRpc(rpc: EarningsRpc, now = Date.now, maximum = 256, timeoutMs = 25_000): EarningsRpc {
  let count = 0; const deadline = now() + timeoutMs;
  return new Proxy(rpc, { get(target, property) {
    const value = Reflect.get(target, property);
    if (typeof value !== "function") return value;
    return (...args: unknown[]) => {
      if (!allowedMethods.has(String(property)) || ++count > maximum || now() >= deadline) throw Error("Claim verification read budget unavailable");
      if (property === "request" && (!args[0] || typeof args[0] !== "object" || !allowedRpc.has(String((args[0] as { method?: unknown }).method)))) {
        throw Error("Claim verification permits read-only RPC methods only");
      }
      const result = Reflect.apply(value, target, args);
      let timer: ReturnType<typeof setTimeout> | undefined;
      // Network clients retain their own short transport timeout. Bound our
      // caller as well if an admitted provider never resolves a read promise.
      return Promise.race([Promise.resolve(result), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("Claim verification read budget unavailable")), Math.max(1, deadline - now()));
      })]).finally(() => { if (timer) clearTimeout(timer); });
    };
  } });
}

function validSources(input: ClaimSettlementInput) {
  const sources = input.contexts;
  if (!Array.isArray(sources) || sources.length !== 2 || sources.some(p => !/^[a-z][a-z0-9-]{1,31}$/.test(p.id))
      || sources[0].id === sources[1].id || sources.some(p => p.context.chainId !== input.review.chainId)
      || claimProfileDigest(sources[0].context.checkpoint) !== claimProfileDigest(sources[1].context.checkpoint)) return false;
  if (input.review.chainId === 31337) return true;
  return sources.every(p => Object.hasOwn(productionSources, p.id)
    && (p.context.rpc as unknown as { transport?: { url?: string } }).transport?.url === productionSources[p.id as keyof typeof productionSources]);
}

async function verifyTargetAtReview(context: EarningsReadContext, review: ClaimExecutionReview, registration?: EarningsRegistration) {
  const r = review.inner;
  const at = { ...context, historicalReceipt: true as const, checkpoint: {
    blockNumber: BigInt(r.reviewBlockNumber).toString(), blockHash: r.reviewBlockHash, timestamp: new Date(r.reviewTimestamp * 1000).toISOString() } };
  if (!await claimCalldataMatches(r)) return false;
  if (r.operation === "creation-fees") {
    const fees = await readFactoryCreationFees(at, r.beneficiary);
    return fees.status === "ready" && same(fees.recipient, r.beneficiary) && same(r.to, context.factory)
      && same(r.ledger, context.factory) && same(r.targetRuntimeHash, context.factoryRuntimeHash)
      && BigInt(fees.availableNativeWei) >= BigInt(r.expectedNativeWei);
  }
  if (!registration) return false;
  const state = await readEarningsContracts(at, registration, r.discoveryRecipient);
  if (state.status !== "ready" || !same(state.originalCurve, r.originCurve) || !same(state.token, r.token) || !state.rights.roles.length) return false;
  if (r.operation === "curve-claim") return same(r.to, state.curve.ledger) && same(r.ledger, state.curve.ledger)
    && same(r.targetRuntimeHash, state.curve.runtimeHash) && same(r.beneficiary, state.beneficiary)
    && BigInt(state.curve.claimableNativeWei) >= BigInt(r.expectedNativeWei);
  if (state.lp.status !== "ready" || !same(state.lp.ledger, r.ledger) || state.lp.positionTokenId !== r.positionTokenId
      || state.lp.liquidityWei !== r.principalLiquidityWei) return false;
  if (r.operation === "lp-collect") return same(r.to, state.lp.collectionContract) && same(r.targetRuntimeHash, state.lp.collectionRuntimeHash)
    && same(r.beneficiary, state.lp.ledger) && BigInt(state.lp.uncollectedNativeWei) >= BigInt(r.expectedNativeWei)
    && BigInt(state.lp.uncollectedTokenWei) >= BigInt(r.expectedTokenWei);
  return same(r.to, state.lp.ledger) && same(r.targetRuntimeHash, state.lp.runtimeHash) && same(r.beneficiary, state.beneficiary)
    && BigInt(state.lp.claimableNativeWei) >= BigInt(r.expectedNativeWei) && BigInt(state.lp.claimableTokenWei) >= BigInt(r.expectedTokenWei);
}

async function oneProvider(source: ClaimSettlementProvider, input: ClaimSettlementInput): Promise<Proof> {
  const { review, registration } = input;
  try {
    const context = { ...source.context, rpc: boundedClaimVerificationRpc(source.context.rpc) };
    const rpc = context.rpc, r = review.inner, outer = review.outer;
    if (!outer || !await verifyTargetAtReview(context, review, registration)
        || !await verifyClaimExecutionProfileAt(context, review, BigInt(r.reviewBlockNumber), "review")) return { status: "unavailable", reason: "review-profile-or-target-invalidated" };
    const current = await rpc.getBlock({ blockNumber: BigInt(context.checkpoint.blockNumber) });
    const located = input.transactionHash ?? await recoverEarningsClaimHash(rpc, current, { from: outer.from, nonce: outer.nonce, reviewBlockNumber: r.reviewBlockNumber });
    const found = isTransactionHash(located) ? located.toLowerCase() as Hash : located;
    if (found === "pending") return { status: "submitted", reason: "original-payer-nonce-not-confirmed" };
    if (found === "unavailable") return { status: "unavailable", reason: "original-hash-outside-bounded-recovery-window" };
    const transaction = await rpc.getTransaction({ hash: found });
    if (transaction.blockNumber === null) return { status: "submitted", hash: found };
    const receipt = await rpc.getTransactionReceipt({ hash: found });
    if (receipt.status !== "success" && receipt.status !== "reverted") return { status: "unavailable", hash: found, reason: "receipt-status-unavailable" };
    const header = await rpc.getBlock({ blockNumber: receipt.blockNumber });
    const checkpoint = point(header);
    if (!same(transaction.from, outer.from) || !same(transaction.to ?? "", outer.to) || !same(transaction.input, outer.data)
        || transaction.value !== 0n || transaction.nonce !== Number(BigInt(outer.nonce)) || transaction.chainId !== review.chainId
        || transaction.type !== "eip1559" || ("authorizationList" in transaction && transaction.authorizationList !== undefined)
        || !same(receipt.transactionHash, found) || !same(receipt.from, outer.from) || !same(receipt.to ?? "", outer.to)
        || transaction.blockHash !== receipt.blockHash || transaction.blockNumber !== receipt.blockNumber
        || transaction.transactionIndex !== receipt.transactionIndex || !same(header.transactions[receipt.transactionIndex] as string, found)
        || receipt.blockNumber <= BigInt(r.reviewBlockNumber) || receipt.blockNumber > current.number
        || receipt.logs.length > 128 || new Set(receipt.logs.map(log => log.logIndex)).size !== receipt.logs.length
        || !receipt.logs.every(log => !log.removed && log.logIndex !== null && log.logIndex >= 0 && same(log.transactionHash!, found)
          && same(log.blockHash!, receipt.blockHash) && log.blockNumber === receipt.blockNumber && log.transactionIndex === receipt.transactionIndex && log.data.length <= 8194)
        || !same(receipt.blockHash, checkpoint.blockHash) || receipt.gasUsed > transaction.gas
        || (outer.gas !== undefined && transaction.gas !== BigInt(outer.gas))
        || (outer.maxFeePerGas !== undefined && transaction.maxFeePerGas !== BigInt(outer.maxFeePerGas))
        || (outer.maxPriorityFeePerGas !== undefined && transaction.maxPriorityFeePerGas !== BigInt(outer.maxPriorityFeePerGas))) {
      return { status: "unavailable", hash: found, reason: "receipt-or-reviewed-gas-conflict" };
    }
    const phase = receipt.status === "reverted" ? "reverted-receipt" : "receipt";
    if (!await verifyClaimExecutionProfileAt(context, review, receipt.blockNumber, phase)) return { status: "unavailable", hash: found, reason: "historical-wallet-profile-conflict" };
    let innerFailed = false;
    if (review.kind === "safe-1.4.1" && receipt.status === "success") {
      const executions = parseEventLogs({ abi: safeEvents, strict: true, logs: receipt.logs.filter(log => same(log.address, review.actor)) });
      if (executions.length !== 1 || !same(executions[0].args.txHash, review.wallet.safe?.transactionHash ?? "") || executions[0].args.payment !== 0n) {
        return { status: "unavailable", hash: found, reason: "safe-execution-evidence-conflict" };
      }
      innerFailed = executions[0].eventName === "ExecutionFailure";
      // Safe may return success while its CALL failed. Such a receipt cannot
      // carry a fee event from this exact inner ledger at the same time.
      if (innerFailed && receipt.logs.some(log => same(log.address, r.to))) return { status: "unavailable", hash: found, reason: "safe-failure-with-fee-logs" };
      const targetCode = await rpc.getCode({ address: r.to, blockNumber: receipt.blockNumber });
      if (!targetCode || (await import("viem")).keccak256(targetCode) !== r.targetRuntimeHash) return { status: "unavailable", hash: found, reason: "safe-target-runtime-conflict" };
    }
    let detail: Parameters<NonNullable<EarningsSettlementInput["verifiedEvidence"]>>[0] | undefined;
    const core = await verifyProfiledEarningsClaim({ context, registration, request: r, transactionHash: found,
      outer: { ...outer, chainId: Number(BigInt(outer.chainId)) }, verifiedEvidence: proof => { detail = proof; } });
    const outerReceiptStatus = receipt.status, innerExecution = innerFailed || core.status === "reverted" ? "reverted" as const
      : core.status === "confirmed" ? "success" as const : "unproven" as const;
    // Independently recheck the receipt and original review anchors after all
    // potentially slow traces/archived state. Do not publish a mid-read orphan.
    const [again, reviewedAgain] = await Promise.all([rpc.getBlock({ blockNumber: receipt.blockNumber }), rpc.getBlock({ blockNumber: BigInt(r.reviewBlockNumber) })]);
    if (!same(again.hash ?? "", receipt.blockHash) || !same(reviewedAgain.hash ?? "", r.reviewBlockHash)) return { status: "unavailable", hash: found, reason: "canonical-anchor-invalidated" };
    if (innerFailed) {
      // This is a successful canonical outer receipt with a failed inner CALL,
      // never an Ethereum transaction revert or a completed beneficiary claim.
      return { status: "reverted", hash: found, checkpoint, outerReceiptStatus, innerExecution, reason: "safe-inner-call-reverted" };
    }
    if (core.status === "reverted") return { status: "reverted", hash: found, checkpoint, outerReceiptStatus, innerExecution, reason: "outer-transaction-reverted" };
    if (core.status === "pending") return { status: "receipt-observed", hash: found, checkpoint, outerReceiptStatus, innerExecution,
      reason: core.settlementPending ? "exact-payment-or-inner-call-trace-unavailable" : "receipt-proof-incomplete" };
    if (core.status !== "confirmed" || !detail || !core.amounts) return { status: "unavailable", hash: found, reason: core.reason ?? "canonical-settlement-proof-conflict" };
    const activity: ClaimActivityIdentity = { schemaVersion: 1, chainId: review.chainId, factory: context.factory, manager: context.poolManager.address,
      registry: context.registry, deploymentBlockHash: context.deploymentBlockHash, token: r.operation === "creation-fees" ? null : r.token,
      ledger: r.ledger, actor: review.actor, gasPayer: outer.from, beneficiary: r.beneficiary, operation: r.operation,
      transactionHash: found, blockNumber: detail.block.blockNumber, blockHash: detail.block.blockHash, logIndex: detail.logIndex,
      nativeWei: core.amounts.nativeWei, tokenWei: core.amounts.tokenWei, outerNonce: BigInt(outer.nonce).toString(), innerNonce: BigInt(r.nonce).toString(),
      intentHash: review.intentHash, pool: detail.pool };
    return { status: "confirmed", hash: found, checkpoint, activity, outerReceiptStatus, innerExecution };
  } catch { return { status: "unavailable", ...(input.transactionHash && { hash: input.transactionHash }), reason: "provider-read-or-proof-unavailable" }; }
}

function identityMatches(a: ClaimActivityIdentity, b: ClaimActivityIdentity) {
  const normalize = (v: unknown): unknown => typeof v === "string" && /^0x[0-9a-f]+$/i.test(v) ? v.toLowerCase()
    : Array.isArray(v) ? v.map(normalize) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([key, value]) => [key, normalize(value)])) : v;
  return JSON.stringify(a).length <= 12_000 && claimProfileDigest(normalize(a)) === claimProfileDigest(normalize(b));
}

/** Read-only recovery. Two matching independent production providers are
 * mandatory. Neither this API nor its index callback signs or resubmits. */
export async function verifyProductionClaimSettlement(input: ClaimSettlementInput): Promise<ClaimSettlementResult> {
  const chainId = input.review?.chainId === 31337 ? 31337 : 4663;
  const base: ClaimSettlementResult = { schemaVersion: 1, profile: claimSettlementProfile, chainId,
    scope: chainId === 31337 ? "synthetic-local" : "production-read-only", stage: "unavailable", executionEnabled: false,
    intentHash: isTransactionHash(input.review?.intentHash) ? input.review.intentHash : zeroHash,
    reviewHash: isTransactionHash(input.review?.reviewHash) ? input.review.reviewHash : zeroHash,
    ...(input.transactionHash && { transactionHash: input.transactionHash }), receiptObserved: false,
    providers: { status: "unavailable", ids: Array.isArray(input.contexts) ? input.contexts.map(source => source.id) : [] }, finality: claimFinality(chainId, undefined, undefined) };
  if (!isClaimExecutionReview(input.review) || !input.review.outer || input.review.status !== "review-only"
      || (input.transactionHash !== undefined && !isTransactionHash(input.transactionHash)) || !validSources(input)) {
    return { ...base, reason: "invalid-review-or-independent-provider-bindings" };
  }
  const proofs = await Promise.all(input.contexts.map(source => oneProvider(source, input)));
  if (proofs.some(p => p.status === "unavailable")) {
    const differs = claimProfileDigest(proofs[0]) !== claimProfileDigest(proofs[1]);
    const conflict = differs && proofs.some(p => /conflict|invalidated/.test(p.reason ?? ""));
    return { ...base, providers: { status: conflict ? "conflict" : "unavailable", ids: base.providers.ids },
      reason: conflict ? "independent-provider-disagreement" : proofs.find(p => p.status === "unavailable")?.reason ?? "provider-evidence-unavailable" };
  }
  if (proofs.some(p => p.status === "receipt-observed") && proofs.every(p => p.status === "receipt-observed" || p.status === "confirmed")
      && proofs[0].hash === proofs[1].hash && claimProfileDigest(proofs[0].checkpoint) === claimProfileDigest(proofs[1].checkpoint)) {
    return { ...base, stage: "receipt-observed", transactionHash: proofs[0].hash, canonicalAt: proofs[0].checkpoint,
      receiptObserved: true, outerReceiptStatus: proofs[0].outerReceiptStatus, innerExecution: "unproven",
      providers: { status: proofs[0].status === proofs[1].status ? "agree" : "unavailable", ids: base.providers.ids },
      reason: "independent-settlement-proof-incomplete" };
  }
  if (claimProfileDigest(proofs[0]) !== claimProfileDigest(proofs[1])) return { ...base, providers: { status: "conflict", ids: base.providers.ids }, reason: "independent-provider-disagreement" };
  const proof = proofs[0], common = { ...base, providers: { status: "agree" as const, ids: base.providers.ids },
    ...(proof.hash && { transactionHash: proof.hash }), ...(proof.checkpoint && { canonicalAt: proof.checkpoint }),
    ...(proof.outerReceiptStatus && { outerReceiptStatus: proof.outerReceiptStatus }), ...(proof.innerExecution && { innerExecution: proof.innerExecution }),
    receiptObserved: proof.checkpoint !== undefined, reason: proof.reason };
  if (proof.status === "submitted") return { ...common, stage: "submitted" };
  if (proof.status === "reverted") return { ...common, stage: "reverted" };
  if (proof.status === "receipt-observed") return { ...common, stage: "receipt-observed" };
  if (!proof.activity || !proof.checkpoint) return { ...common, reason: "incomplete-canonical-proof" };
  let indexed = false;
  try {
    const observed = await input.indexed?.(proof.activity, proof.checkpoint);
    if (observed?.schemaVersion === 1 && observed.status === "canonical" && identityMatches(observed.activity, proof.activity)
        && /^[1-9][0-9]{0,15}$/.test(observed.checkpoint.blockNumber) && isTransactionHash(observed.checkpoint.blockHash)
        && Number.isFinite(Date.parse(observed.checkpoint.timestamp)) && BigInt(observed.checkpoint.blockNumber) >= BigInt(proof.activity.blockNumber)) {
      const anchors = await Promise.all(input.contexts.map(source => source.context.rpc.getBlock({ blockNumber: BigInt(observed.checkpoint.blockNumber) })));
      indexed = anchors.every(anchor => same(anchor.hash ?? "", observed.checkpoint.blockHash)
        && new Date(Number(anchor.timestamp) * 1000).toISOString() === observed.checkpoint.timestamp);
    }
  } catch { /* A verified payment is not proof of durable indexing. */ }
  const finality = claimFinality(chainId, proof.checkpoint, input.finalityPolicy);
  return { ...common, stage: !indexed ? "indexing-pending" : finality.status === "synthetic-local" ? "settled" : "canonical-l2",
    amounts: { nativeWei: proof.activity.nativeWei, tokenWei: proof.activity.tokenWei }, activity: proof.activity, indexed, finality,
    reason: !indexed ? "exact-canonical-fee-activity-not-indexed" : finality.reason };
}
