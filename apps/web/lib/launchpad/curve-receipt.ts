import { decodeFunctionData, erc20Abi, isHash, keccak256, parseAbi, parseEventLogs, zeroAddress, type Address, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { normalizeNativeTrace, type NormalizedNativeTrace } from "../vnext/normalized-native-trace";
import { curveAbi, curveCreatedEvent, curveCreationFeePaidEvent, curveFactoryAbi, curveFeeClaimedEvent, curveGraduatedEvent, curveGraduationAbi,
  curveLpClaimedEvent, curveLpCollectedEvent, curveLpLedgerAbi, curveSupplyPresets, curveTradeEvent, sameCurveAddress,
  type CurveCreationFeePolicy, type CurveLaunch, type CurveState } from "./curve-v1";
import { boundReceipt, displayAmount, verifySwap } from "./direct-v4";
import { NativeSettlementPending } from "./native-settlement";
import { boundedReceiptLogs } from "./receipt-logs";
import type { LaunchConfig, LaunchRequest } from "./transactions";

const permit2Abi = parseAbi([
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
  "event Approval(address indexed owner,address indexed token,address indexed spender,uint160 amount,uint48 expiration)",
]);

export function projectCurveReceipt(factory: Address, receipt: TransactionReceipt, policy: CurveCreationFeePolicy, request?: LaunchRequest): CurveLaunch {
  if (receipt.status !== "success" || !sameCurveAddress(receipt.to, factory)) throw new Error("The curve creation receipt is unavailable.");
  const logs = boundedReceiptLogs(receipt).filter((log) => sameCurveAddress(log.address, factory));
  const events = parseEventLogs({ abi: [curveCreatedEvent], logs });
  if (events.length !== 1) throw new Error("Expected one canonical curve creation event.");
  const { args, logIndex } = events[0];
  const { token, curve, creator, intentId, supply, revenueLedger, treasury, treasuryShareBps, name, symbol, projectURI } = args;
  if (!sameCurveAddress(creator, receipt.from) || !isHash(intentId) || /^0x0+$/.test(intentId)
    || !curveSupplyPresets.some((preset) => supply === BigInt(preset) * 10n ** 18n) || !name || !symbol
    || new Set([token, curve, revenueLedger, zeroAddress].map((address) => address.toLowerCase())).size !== 4
    || (treasuryShareBps === 0) !== sameCurveAddress(treasury, zeroAddress) || treasuryShareBps > 9_000
    || new TextEncoder().encode(name).length > 48 || new TextEncoder().encode(symbol).length > 12
    || new TextEncoder().encode(projectURI).length > 196) throw new Error("Curve creation evidence is malformed.");
  const fees = parseEventLogs({ abi: [curveCreationFeePaidEvent], logs });
  const [feeEvent] = fees;
  if (fees.length !== 1 || !sameCurveAddress(feeEvent.args.token, token) || !sameCurveAddress(feeEvent.args.creator, creator)
    || !sameCurveAddress(feeEvent.args.recipient, policy.recipient) || feeEvent.args.fee !== BigInt(policy.amountWei)) {
    throw new Error("The creation fee receipt does not match the immutable factory terms.");
  }
  const launch: CurveLaunch = { chainId: 31337, factory, token, curve, creator, intentId, name, symbol, projectURI,
    totalSupply: supply.toString(), treasury, treasuryShareBps, ledger: revenueLedger,
    creationFee: { amountWei: feeEvent.args.fee.toString(), recipient: feeEvent.args.recipient,
      refundWei: feeEvent.args.refund.toString(), logIndex: feeEvent.logIndex },
    transactionHash: receipt.transactionHash, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber.toString(), logIndex };
  if (request) {
    if (request.kind !== "curve-create" || request.chainId !== 31337 || !sameCurveAddress(request.to, factory) || !sameCurveAddress(request.from, creator)
      || !sameCurveAddress(intentId, request.intentId) || feeEvent.args.refund !== 0n || BigInt(request.value) !== feeEvent.args.fee) {
      throw new Error("Curve creation did not match the reviewed request.");
    }
    assertCurveCreationTransaction(launch, request.data, BigInt(request.value), BigInt(request.deadline));
  }
  return launch;
}

export function assertCurveCreationTransaction(launch: CurveLaunch, data: Hex, value: bigint, deadline?: bigint) {
  const reviewed = decodeFunctionData({ abi: curveFactoryAbi, data });
  if (reviewed.functionName !== "create" || value !== BigInt(launch.creationFee.amountWei) + BigInt(launch.creationFee.refundWei)
    || reviewed.args[0] !== launch.name || reviewed.args[1] !== launch.symbol || reviewed.args[2] !== launch.projectURI
    || !curveSupplyPresets.some((preset, index) => index === reviewed.args[3] && BigInt(launch.totalSupply) === BigInt(preset) * 10n ** 18n)
    || !sameCurveAddress(reviewed.args[4], launch.treasury) || reviewed.args[5] !== launch.treasuryShareBps
    || !sameCurveAddress(reviewed.args[6], launch.intentId) || (deadline !== undefined && reviewed.args[7] !== deadline)) {
    throw new Error("Curve creation did not match the reviewed request.");
  }
}

function successfulNativePayment(trace: NormalizedNativeTrace, from: Address, to: Address): bigint {
  if (trace.error) return 0n;
  const own = trace.type === "CALL" && sameCurveAddress(trace.from, from) && sameCurveAddress(trace.to, to) ? BigInt(trace.value!) : 0n;
  return own + trace.calls.reduce((total, child) => total + successfulNativePayment(child, from, to), 0n);
}

async function proveCurvePayoutTrace(rpc: PublicClient, receipt: TransactionReceipt,
  request: Pick<LaunchRequest, "from" | "to" | "data" | "value">, payout: bigint, from: Address, to: Address) {
  if (!payout) return;
  let raw: unknown;
  try {
    raw = await rpc.request({ method: "debug_traceTransaction", params: [receipt.transactionHash, { tracer: "callTracer" }] } as never, { retryCount: 0 });
  } catch { throw new NativeSettlementPending("unavailable"); }
  let trace: NormalizedNativeTrace;
  try { trace = normalizeNativeTrace(raw); } catch { throw new NativeSettlementPending("malformed"); }
  if (trace.error || !sameCurveAddress(trace.from, request.from) || !sameCurveAddress(trace.to, request.to) || trace.inputHash !== keccak256(request.data)
    || BigInt(trace.value!) !== BigInt(request.value)
    || successfulNativePayment(trace, from, to) !== payout) throw new NativeSettlementPending("payout_unproven");
}

export async function verifyCurveCreationRefund(rpc: PublicClient, receipt: TransactionReceipt, launch: CurveLaunch, data: Hex, value: Hex) {
  await proveCurvePayoutTrace(rpc, receipt, { from: launch.creator, to: launch.factory, data, value },
    BigInt(launch.creationFee.refundWei), launch.factory, launch.creator);
}

async function proveCurvePayout(rpc: PublicClient, receipt: TransactionReceipt, request: LaunchRequest, payout: bigint,
  from = request.to, to = request.from) {
  if (!payout) return;
  await proveCurvePayoutTrace(rpc, receipt, request, payout, from, to);
  let current: TransactionReceipt;
  try { current = await boundReceipt(rpc, receipt.transactionHash, request); }
  catch { throw new NativeSettlementPending("stale"); }
  if (current.blockHash !== receipt.blockHash || current.blockNumber !== receipt.blockNumber || current.status !== "success") {
    throw new NativeSettlementPending("stale");
  }
}

export function curveAtReceipt(launch: CurveLaunch, state: CurveState, receipt: Pick<TransactionReceipt, "blockNumber" | "blockHash" | "transactionIndex">) {
  const migrations = state.project?.migrations ?? [];
  if (state.project && BigInt(state.project.count) !== BigInt(migrations.length)) throw new Error("Historical curve evidence is outside the recovery window.");
  let curve = state.activeCurve;
  for (const migration of migrations) {
    const height = BigInt(migration.blockNumber);
    if (height === receipt.blockNumber && migration.blockHash !== receipt.blockHash) throw new Error("The migration and receipt are on different branches.");
    if (height < receipt.blockNumber || (height === receipt.blockNumber && migration.transactionIndex < receipt.transactionIndex)) break;
    if (height === receipt.blockNumber && migration.transactionIndex === receipt.transactionIndex) {
      throw new Error("A curve trade cannot settle in the migration transaction.");
    }
    if (!sameCurveAddress(curve, migration.nextEngine)) throw new Error("Historical curve evidence does not form a continuous chain.");
    curve = migration.previousEngine;
  }
  if (receipt.blockNumber < BigInt(launch.blockNumber)) throw new Error("The receipt predates the registered project.");
  return curve;
}

export async function verifyCurveAction(
  rpc: PublicClient, receipt: TransactionReceipt, request: LaunchRequest, config: Extract<LaunchConfig, { status: "ready" }>,
  launch: CurveLaunch, state: CurveState,
) {
  if (!config.curve || request.chainId !== 31337 || launch.chainId !== request.chainId || !sameCurveAddress(launch.token, request.token)
    || !sameCurveAddress(launch.factory, config.deployment.factory) || receipt.status !== "success") throw new Error("Curve recovery binding failed.");
  if (request.kind === "curve-v4-buy" || request.kind === "curve-v4-sell") {
    if (!state.position) throw new Error("The graduation evidence is unavailable. Retry after reconciliation.");
    const kind = request.kind === "curve-v4-buy" ? "buy" : "sell";
    const amount = await verifySwap(rpc, receipt, config.deployment, state.position, { ...request, kind });
    return `v4 settlement verified. Received ${displayAmount(amount)} ${kind === "buy" ? launch.symbol : "ETH"}.`;
  }
  const logs = boundedReceiptLogs(receipt);
  if (request.kind === "curve-lp-collect") {
    const engine = config.curve.graduationEngine;
    const reviewed = decodeFunctionData({ abi: curveGraduationAbi, data: request.data });
    const events = parseEventLogs({ abi: [curveLpCollectedEvent], logs: logs.filter((log) => sameCurveAddress(log.address, engine)) });
    if (!state.position || !state.lpFees || !sameCurveAddress(request.to, engine) || BigInt(request.value) !== 0n
      || reviewed.functionName !== "collectLpFees" || !sameCurveAddress(reviewed.args[0], launch.token) || reviewed.args[1] !== BigInt(request.deadline)
      || events.length !== 1 || !sameCurveAddress(events[0].args.token, launch.token) || !sameCurveAddress(events[0].args.ledger, state.lpFees.ledger)
      || events[0].args.positionTokenId.toString() !== state.position.positionTokenId) throw new Error("The locked position fee collection receipt does not match.");
    const { nativeAmount, tokenAmount } = events[0].args;
    if (!nativeAmount && !tokenAmount) throw new Error("The LP collection contains no payout.");
    if (tokenAmount) {
      const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: logs.filter((log) => sameCurveAddress(log.address, launch.token)) })
        .filter(({ args }) => sameCurveAddress(args.from, config.deployment.poolManager) && sameCurveAddress(args.to, state.lpFees?.ledger));
      if (transfers.length !== 1 || transfers[0].args.value !== tokenAmount) throw new Error("The LP fee token deposit could not be verified.");
    }
    await proveCurvePayout(rpc, receipt, request, nativeAmount, config.deployment.poolManager, state.lpFees.ledger);
    return "LP fee collection verified. Original position custody is unchanged.";
  }
  if (request.kind === "curve-lp-claim") {
    const ledger = state.lpFees?.ledger;
    const reviewed = decodeFunctionData({ abi: curveLpLedgerAbi, data: request.data });
    const events = parseEventLogs({ abi: [curveLpClaimedEvent], logs: logs.filter((log) => sameCurveAddress(log.address, ledger)) });
    if (!ledger || !sameCurveAddress(request.to, ledger) || reviewed.functionName !== "claim" || BigInt(request.value) !== 0n
      || events.length !== 1 || !sameCurveAddress(events[0].args.recipient, request.from)) throw new Error("The LP fee claim receipt does not match.");
    const { nativeAmount, tokenAmount } = events[0].args;
    if (!nativeAmount && !tokenAmount) throw new Error("The LP fee claim contains no payout.");
    if (tokenAmount) {
      const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: logs.filter((log) => sameCurveAddress(log.address, launch.token)) })
        .filter(({ args }) => sameCurveAddress(args.from, ledger) && sameCurveAddress(args.to, request.from));
      if (transfers.length !== 1 || transfers[0].args.value !== tokenAmount) throw new Error("The LP token fee transfer could not be verified.");
    }
    await proveCurvePayout(rpc, receipt, request, nativeAmount);
    return "LP fee payout verified.";
  }
  if (request.kind === "curve-v4-router-approval") {
    const reviewed = decodeFunctionData({ abi: permit2Abi, data: request.data });
    const events = parseEventLogs({ abi: permit2Abi, eventName: "Approval", logs: logs.filter((log) => sameCurveAddress(log.address, config.deployment.permit2)) });
    const [event] = events;
    if (!state.position || !sameCurveAddress(request.to, config.deployment.permit2) || BigInt(request.value) !== 0n
      || !sameCurveAddress(reviewed.args[0], launch.token) || !sameCurveAddress(reviewed.args[1], config.deployment.universalRouter)
      || reviewed.args[2] !== BigInt(request.amountIn ?? "0") || reviewed.args[3] !== request.deadline
      || events.length !== 1 || !sameCurveAddress(event.args.owner, request.from) || !sameCurveAddress(event.args.token, launch.token)
      || !sameCurveAddress(event.args.spender, config.deployment.universalRouter) || event.args.amount !== reviewed.args[2]
      || event.args.expiration !== reviewed.args[3]) throw new Error("The receipt does not verify the exact v4 router allowance.");
    return "Exact v4 router allowance verified. Review the sale to continue.";
  }
  if (request.kind === "curve-approval" || request.kind === "curve-v4-token-approval") {
    const reviewed = decodeFunctionData({ abi: erc20Abi, data: request.data });
    const events = parseEventLogs({ abi: erc20Abi, eventName: "Approval", logs: logs.filter((log) => sameCurveAddress(log.address, launch.token)) });
    const curveApproval = request.kind === "curve-approval";
    const spender = curveApproval ? request.curveTarget ?? launch.curve : config.deployment.permit2;
    if (curveApproval) {
      // The approval is bound to the curve reviewed before sending. It may mine after a migration.
      const reviewedBlock = await rpc.getBlock({ blockNumber: BigInt(request.blockNumber), includeTransactions: false });
      if (reviewedBlock.hash !== request.blockHash || reviewedBlock.number === null
        || !sameCurveAddress(curveAtReceipt(launch, state, { blockNumber: reviewedBlock.number, blockHash: reviewedBlock.hash,
          transactionIndex: Number.MAX_SAFE_INTEGER }), spender)) throw new Error("The allowance target was not canonical at review.");
    }
    if (!sameCurveAddress(request.to, launch.token) || BigInt(request.value) !== 0n || reviewed.functionName !== "approve"
      || (!curveApproval && !state.position) || !sameCurveAddress(reviewed.args[0], spender) || reviewed.args[1] !== BigInt(request.amountIn ?? "0")
      || events.length !== 1 || !sameCurveAddress(events[0].args.owner, request.from)
      || !sameCurveAddress(events[0].args.spender, spender) || events[0].args.value !== reviewed.args[1]) {
      throw new Error("The receipt does not verify the exact token allowance.");
    }
    return curveApproval && !sameCurveAddress(spender, state.activeCurve)
      ? "Historical curve allowance verified. Review a new allowance for the active curve."
      : curveApproval ? "Exact curve allowance verified. Review the sale to continue." : "Exact v4 token allowance verified. Review the sale to continue.";
  }
  if (request.kind === "curve-claim") {
    const events = parseEventLogs({ abi: [curveFeeClaimedEvent], logs: logs.filter((log) => sameCurveAddress(log.address, launch.ledger)) });
    if (!sameCurveAddress(request.to, launch.ledger) || BigInt(request.value) !== 0n || events.length !== 1
      || !sameCurveAddress(events[0].args.recipient, request.from) || events[0].args.amount <= 0n) throw new Error("The fee claim receipt does not match.");
    await proveCurvePayout(rpc, receipt, request, events[0].args.amount);
    return `Curve fee payout verified. Received ${displayAmount(events[0].args.amount)} ETH.`;
  }
  const executionCurve = curveAtReceipt(launch, state, receipt);
  if (!sameCurveAddress(request.to, executionCurve) || (request.curveTarget && !sameCurveAddress(request.curveTarget, executionCurve))) {
    throw new Error("The receipt is for a different bonding curve.");
  }
  const curveLogs = logs.filter((log) => sameCurveAddress(log.address, executionCurve));
  function verifyGraduation() {
    const events = parseEventLogs({ abi: [curveGraduatedEvent], logs: curveLogs });
    const position = state.position;
    if (events.length !== 1 || !position || events[0].args.poolId !== position.poolId
      || events[0].args.positionTokenId.toString() !== position.positionTokenId || position.transactionHash !== receipt.transactionHash
      || position.blockHash !== receipt.blockHash || events[0].args.nativeUsed.toString() !== position.amount0
      || events[0].args.tokenUsed.toString() !== position.amount1) throw new Error("The graduation receipt and locked liquidity are being reconciled.");
  }
  if (request.kind === "curve-graduate") {
    verifyGraduation();
    return "Graduation and permanently locked v4 liquidity verified.";
  }
  const buy = request.kind === "curve-buy";
  if (!buy && request.kind !== "curve-sell") throw new Error("The request belongs to a different launch workflow.");
  const events = parseEventLogs({ abi: [curveTradeEvent], logs: curveLogs });
  if (events.length !== 1 || !sameCurveAddress(events[0].args.account, request.from) || events[0].args.isBuy !== buy) {
    throw new Error("The receipt does not verify the reviewed curve trade.");
  }
  const { tokenAmount, grossNative, fee, nativeRefund } = events[0].args;
  const output = buy ? tokenAmount : grossNative - fee;
  const amountIn = BigInt(request.amountIn ?? "0");
  const min = BigInt(request.minimumOut ?? "0");
  const reviewed = decodeFunctionData({ abi: curveAbi, data: request.data });
  if (fee <= 0n || fee >= grossNative || min <= 0n || output < min
    || (buy ? (reviewed.functionName !== "buy" && reviewed.functionName !== "buyAndGraduate") || reviewed.args[0] !== min || grossNative + nativeRefund !== amountIn
      || BigInt(request.value) !== amountIn : reviewed.functionName !== "sell" || reviewed.args[0] !== amountIn
      || reviewed.args[1] !== min || tokenAmount !== amountIn || nativeRefund !== 0n || BigInt(request.value) !== 0n)) {
    throw new Error("Curve settlement did not satisfy the reviewed amount and fee bounds.");
  }
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: logs.filter((log) => sameCurveAddress(log.address, launch.token)) })
    .filter(({ args }) => sameCurveAddress(args.from, buy ? executionCurve : request.from)
      && sameCurveAddress(args.to, buy ? request.from : executionCurve));
  if (transfers.length !== 1 || transfers[0].args.value !== tokenAmount) throw new Error("The exact curve token transfer is unavailable.");
  await proveCurvePayout(rpc, receipt, request, buy ? nativeRefund : output);
  if (reviewed.functionName === "buyAndGraduate") {
    verifyGraduation();
    return `Curve settlement and locked v4 liquidity verified. Received ${displayAmount(output)} ${launch.symbol}.`;
  }
  return `Curve settlement verified. Received ${displayAmount(output)} ${buy ? launch.symbol : "ETH"}.`;
}

export function isCurveAction(request: LaunchRequest) {
  return request.kind.startsWith("curve-");
}

export async function curveReviewTime(rpc: PublicClient) {
  const block = await rpc.getBlock({ includeTransactions: false });
  const timestamp = Number(block.timestamp);
  if (block.number === null || !block.hash || !Number.isSafeInteger(timestamp) || timestamp <= 0
    || timestamp < Math.floor(Date.now() / 1_000) - 300) throw new Error("The review network timestamp is stale. Refresh before signing.");
  return timestamp;
}

export async function fetchCurveState(token: Address, account?: Address, signal?: AbortSignal): Promise<{ launch: CurveLaunch; state: CurveState }> {
  const query = new URLSearchParams({ token, ...(account ? { account } : {}) });
  const response = await fetch(`/api/launchpad/curve?${query}`, { signal, cache: "no-store" });
  const data = await response.json() as { launch?: CurveLaunch; state?: CurveState; reason?: string };
  if (!response.ok || !data.launch || !data.state) throw new Error(data.reason ?? "Curve state unavailable. Try again shortly.");
  return { launch: data.launch, state: data.state };
}
