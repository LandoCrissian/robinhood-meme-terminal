import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import {
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  type Address
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import {
  evaluateLivePositionGuard,
  livePositionGuardOrderId,
  normalizeLivePositionGuardSettings,
  unitQuoteX18
} from "../../../../../lib/live-position-guard";
import { getRmtAdminFirestore } from "../../../../../lib/server/firebase-admin";
import { quoteAndBuildExternalUniswapSwap } from "../../../../../lib/server/external-uniswap-trade";
import {
  buildLivePositionGuardExecutorCall,
  livePositionGuardServerConfiguration,
  sendLivePositionGuardTransaction
} from "../../../../../lib/server/live-position-guard-execution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const LEASE_MS = 55_000;
const MAX_ORDERS = 20;
const MAX_UINT128 = (1n << 128n) - 1n;
const ORDER_STATUS = ["active", "executing", "submitted"];

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_RPC_URL ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 3, timeout: 12_000 }
  )
});

function authorized(request: Request, token: string) {
  const supplied = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~-]{16,512})$/)?.[1] ?? "";
  if (!supplied) return false;
  const left = Buffer.from(token);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

function safeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function positiveBigInt(value: unknown, maximum = (1n << 256n) - 1n) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,78}$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= maximum ? parsed : null;
}

function address(value: unknown) {
  return typeof value === "string" && isAddress(value) ? getAddress(value) : null;
}

async function acquireLease(database: Firestore, now: number) {
  const reference = database.collection("livePositionGuardSystem").doc("evaluatorLease");
  const token = randomUUID();
  return database.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    const leaseUntil = safeInteger(current.data()?.leaseUntil) ?? 0;
    if (leaseUntil > now) return "";
    transaction.set(reference, {
      leaseTokenHash: createHash("sha256").update(token).digest("hex"),
      leaseUntil: now + LEASE_MS,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return token;
  });
}

async function releaseLease(database: Firestore, token: string) {
  const reference = database.collection("livePositionGuardSystem").doc("evaluatorLease");
  const hash = createHash("sha256").update(token).digest("hex");
  await database.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    if (current.data()?.leaseTokenHash !== hash) return;
    transaction.set(reference, {
      leaseTokenHash: FieldValue.delete(),
      leaseUntil: 0,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
}

async function reconcileSubmitted(reference: FirebaseFirestore.DocumentReference, data: Record<string, unknown>) {
  const transactionHash = typeof data.transactionHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(data.transactionHash)
    ? data.transactionHash as `0x${string}`
    : null;
  if (!transactionHash) {
    await reference.set({ status: "review_required", reviewReason: "missing_transaction_hash" }, { merge: true });
    return "review_required";
  }
  try {
    const receipt = await client.getTransactionReceipt({ hash: transactionHash });
    await reference.set({
      confirmedAt: Date.now(),
      status: receipt.status === "success" ? "executed" : "review_required",
      reviewReason: receipt.status === "success" ? FieldValue.delete() : "transaction_reverted",
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return receipt.status === "success" ? "executed" : "review_required";
  } catch {
    return "pending";
  }
}

async function evaluateOrder(input: {
  configuration: NonNullable<ReturnType<typeof livePositionGuardServerConfiguration>>;
  database: Firestore;
  document: FirebaseFirestore.QueryDocumentSnapshot;
  now: number;
}) {
  const reference = input.document.ref;
  const data = input.document.data() as Record<string, unknown>;
  const status = typeof data.status === "string" ? data.status : "";
  if (status === "submitted") return reconcileSubmitted(reference, data);
  if (status === "executing") {
    const executionStartedAt = safeInteger(data.executionStartedAt) ?? input.now;
    if (input.now - executionStartedAt > 120_000) {
      await reference.set({
        reviewReason: "execution_result_unknown",
        status: "review_required",
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return "review_required";
    }
    return "executing";
  }

  const wallet = address(data.wallet);
  const token = address(data.token);
  const pair = address(data.pair);
  const executor = address(data.executor);
  const amountLimit = positiveBigInt(data.amountIn, MAX_UINT128);
  const entry = positiveBigInt(data.entryUnitQuoteX18);
  const highWatermark = positiveBigInt(data.highWatermarkUnitQuoteX18);
  const settings = normalizeLivePositionGuardSettings(data.settings);
  const expiresAt = safeInteger(data.expiresAt);
  const walletId = typeof data.walletId === "string" && /^[A-Za-z0-9_-]{8,160}$/.test(data.walletId)
    ? data.walletId
    : "";
  const authorizationId = typeof data.authorizationId === "string" && /^[A-Za-z0-9_-]{8,160}$/.test(data.authorizationId)
    ? data.authorizationId
    : "";
  const revision = safeInteger(data.revision);
  if (
    !wallet || !token || !pair || executor !== input.configuration.executor || !amountLimit || !entry
    || !highWatermark || !settings || !expiresAt || !walletId || !authorizationId || revision === null
  ) {
    await reference.set({ status: "review_required", reviewReason: "invalid_order_record" }, { merge: true });
    return "review_required";
  }
  if (expiresAt <= input.now) {
    await reference.set({ expiredAt: input.now, status: "expired", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return "expired";
  }

  const [balance, allowance, currentBlock] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [wallet, executor] }),
    client.getBlockNumber()
  ]);
  const amountIn = balance < amountLimit ? balance : amountLimit;
  if (amountIn <= 0n) {
    await reference.set({ status: "no_position", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return "no_position";
  }
  if (allowance !== amountLimit) {
    const allowanceTooLarge = allowance > amountLimit;
    await reference.set({
      status: allowanceTooLarge ? "review_required" : "approval_required",
      reviewReason: allowanceTooLarge ? "allowance_exceeds_order_limit" : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return allowanceTooLarge ? "review_required" : "approval_required";
  }

  const quote = await quoteAndBuildExternalUniswapSwap({
    token,
    pair,
    recipient: wallet,
    side: "sell",
    amountIn,
    maxPriceImpact: settings.maxPriceImpactBps / 10_000
  });
  if (quote.executionFee || !quote.grossQuoteOut || !quote.grossMinimumOut) {
    await reference.set({ status: "review_required", reviewReason: "ineligible_route" }, { merge: true });
    return "review_required";
  }
  const evaluation = evaluateLivePositionGuard({
    currentBlock,
    currentUnitQuoteX18: unitQuoteX18(BigInt(quote.grossQuoteOut), amountIn),
    now: input.now,
    observation: {
      entryUnitQuoteX18: entry,
      highWatermarkUnitQuoteX18: highWatermark,
      firstBelowFloorAt: safeInteger(data.firstBelowFloorAt),
      firstBelowFloorBlock: positiveBigInt(data.firstBelowFloorBlock)
    },
    settings
  });

  if (evaluation.state !== "triggered") {
    await input.database.runTransaction(async (transaction) => {
      const fresh = await transaction.get(reference);
      if (fresh.data()?.status !== "active" || fresh.data()?.revision !== revision) return;
      transaction.set(reference, {
        effectiveFloorUnitQuoteX18: evaluation.effectiveFloorUnitQuoteX18.toString(),
        firstBelowFloorAt: evaluation.firstBelowFloorAt,
        firstBelowFloorBlock: evaluation.firstBelowFloorBlock?.toString() ?? null,
        highWatermarkUnitQuoteX18: evaluation.highWatermarkUnitQuoteX18.toString(),
        lastEvaluatedAt: input.now,
        lastEvaluatedBlock: currentBlock.toString(),
        revision: revision + 1,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
    return evaluation.state;
  }

  const attemptId = randomUUID();
  const transitioned = await input.database.runTransaction(async (transaction) => {
    const fresh = await transaction.get(reference);
    if (fresh.data()?.status !== "active" || fresh.data()?.revision !== revision) return false;
    transaction.set(reference, {
      executionAttemptId: attemptId,
      executionStartedAt: input.now,
      status: "executing",
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return true;
  });
  if (!transitioned) return "raced";

  const orderId = livePositionGuardOrderId({ authorizationId, documentId: input.document.id, wallet, token });
  const executionSlippageBps = Math.min(
    500,
    Math.max(100, Math.ceil(quote.priceImpact * 10_000) + 100)
  );
  const call = buildLivePositionGuardExecutorCall({
    amountIn,
    amountOutMinimum: BigInt(quote.grossMinimumOut),
    deadline: BigInt(quote.deadline),
    executor,
    fee: quote.fee,
    maxSlippageBps: executionSlippageBps,
    orderId,
    token
  });
  try {
    const result = await sendLivePositionGuardTransaction({
      call,
      configuration: input.configuration,
      idempotencyKey: `rmt-guard-${attemptId}`,
      walletId
    });
    await reference.set({
      orderId,
      status: "submitted",
      submittedAt: Date.now(),
      transactionHash: result.hash,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return "submitted";
  } catch {
    await reference.set({
      reviewReason: "execution_not_confirmed",
      status: "review_required",
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return "review_required";
  }
}

export async function POST(request: Request) {
  const configuration = livePositionGuardServerConfiguration();
  const database = getRmtAdminFirestore();
  if (!configuration || !database || !authorized(request, configuration.evaluatorToken)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: HEADERS });
  }
  const now = Date.now();
  await database.collection("livePositionGuardSystem").doc("evaluatorHeartbeat").set({
    lastSeenAt: now,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  const lease = await acquireLease(database, now);
  if (!lease) return NextResponse.json({ status: "already_running" }, { headers: HEADERS });
  try {
    const orders = await database.collection("livePositionGuardOrders")
      .where("status", "in", ORDER_STATUS)
      .limit(MAX_ORDERS)
      .get();
    const results: string[] = [];
    for (const document of orders.docs) {
      try {
        results.push(await evaluateOrder({ configuration, database, document, now }));
      } catch {
        await document.ref.set({
          lastEvaluatedAt: now,
          lastEvaluationError: "evaluation_failed_safely",
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        results.push("failed_safely");
      }
    }
    const counts = results.reduce<Record<string, number>>((summary, result) => ({
      ...summary,
      [result]: (summary[result] ?? 0) + 1
    }), {});
    return NextResponse.json({ counts, processed: orders.size, status: "complete" }, { headers: HEADERS });
  } finally {
    await releaseLease(database, lease).catch(() => undefined);
  }
}
