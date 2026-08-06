import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import {
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hex
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import {
  livePositionGuardOnchainOrderMatchesPlan,
  livePositionGuardRuntimeAuthority,
  normalizeLivePositionGuardOnchainOrder,
  normalizeLivePositionGuardOnchainPreview,
  normalizeLivePositionGuardSettings,
  rmtPositionGuardExecutorAbi,
  type LivePositionGuardPreparedPlan
} from "../../../../../lib/live-position-guard";
import { getRmtAdminFirestore } from "../../../../../lib/server/firebase-admin";
import { quoteAndBuildExternalUniswapSwap } from "../../../../../lib/server/external-uniswap-trade";
import {
  buildLivePositionGuardCheckpointCall,
  buildLivePositionGuardExecutorCall,
  livePositionGuardServerConfiguration,
  sendLivePositionGuardTransaction
} from "../../../../../lib/server/live-position-guard-execution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const LEASE_MS = 55_000;
const MAX_ORDERS = 8;
const SUBMITTED_REVIEW_AFTER_MS = 15 * 60_000;
const MAX_UINT128 = (1n << 128n) - 1n;
const ORDER_STATUS = ["active", "executing", "submitted"];
const ORDER_ID = /^0x[0-9a-fA-F]{64}$/;
const HIGH_WATERMARK_CHECKPOINT_BPS = 50n;
const BPS = 10_000n;
const CONFIRMATION_RESET_SECONDS = 60;

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

function orderId(value: unknown) {
  return typeof value === "string" && ORDER_ID.test(value) ? value as Hex : null;
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

async function readOrder(executor: Address, wallet: Address, id: Hex) {
  return normalizeLivePositionGuardOnchainOrder(await client.readContract({
    address: executor,
    abi: rmtPositionGuardExecutorAbi,
    functionName: "getV3Order",
    args: [wallet, id]
  }));
}

async function readPreview(executor: Address, wallet: Address, id: Hex) {
  return normalizeLivePositionGuardOnchainPreview(await client.readContract({
    address: executor,
    abi: rmtPositionGuardExecutorAbi,
    functionName: "previewV3Order",
    args: [wallet, id]
  }));
}

function immutableOrderMatches(input: {
  amountIn: bigint;
  order: NonNullable<ReturnType<typeof normalizeLivePositionGuardOnchainOrder>>;
  pair: Address;
  settings: NonNullable<ReturnType<typeof normalizeLivePositionGuardSettings>>;
  token: Address;
}) {
  return input.order.token.toLowerCase() === input.token.toLowerCase()
    && input.order.pool.toLowerCase() === input.pair.toLowerCase()
    && input.order.amountIn === input.amountIn
    && input.order.stopLossBps === input.settings.stopLossBps
    && input.order.trailingStopBps === input.settings.trailingStopBps
    && input.order.breakEvenActivationBps === input.settings.breakEvenActivationBps;
}

async function sendAndConfirm(input: {
  call: { data: Hex; to: Address };
  configuration: NonNullable<ReturnType<typeof livePositionGuardServerConfiguration>>;
  idempotencyKey: string;
  walletId: string;
}) {
  const result = await sendLivePositionGuardTransaction(input);
  if (typeof result.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result.hash)) {
    throw new Error("Position Guard transaction hash was not returned.");
  }
  const hash = result.hash as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 45_000 });
  if (receipt.status !== "success") throw new Error("Position Guard transaction reverted.");
  return hash;
}

async function reconcileSubmitted(
  reference: FirebaseFirestore.DocumentReference,
  data: Record<string, unknown>,
  now: number,
  configuration: NonNullable<ReturnType<typeof livePositionGuardServerConfiguration>>
) {
  const transactionHash = typeof data.transactionHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(data.transactionHash)
    ? data.transactionHash as Hex
    : null;
  const submittedAt = safeInteger(data.submittedAt);
  const wallet = address(data.wallet);
  const id = orderId(data.orderId);
  if (!transactionHash || submittedAt === null || !wallet || !id) {
    await reference.set({
      lastEvaluatedAt: now,
      status: "review_required",
      reviewReason: !transactionHash
        ? "missing_transaction_hash"
        : submittedAt === null
          ? "missing_submitted_at"
          : "missing_onchain_order_identity",
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return "review_required";
  }
  try {
    const receipt = await client.getTransactionReceipt({ hash: transactionHash });
    const onchainOrder = await readOrder(configuration.executor, wallet, id).catch(() => null);
    const executed = receipt.status === "success" && onchainOrder?.status === 3;
    await reference.set({
      confirmedAt: now,
      lastEvaluatedAt: now,
      onchainOrderClosedAt: executed ? now : FieldValue.delete(),
      status: executed ? "executed" : "review_required",
      reviewReason: executed
        ? FieldValue.delete()
        : receipt.status === "success"
          ? "execution_receipt_order_mismatch"
          : "transaction_reverted",
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return executed ? "executed" : "review_required";
  } catch {
    if (now - submittedAt >= SUBMITTED_REVIEW_AFTER_MS) {
      await reference.set({
        lastEvaluatedAt: now,
        status: "review_required",
        reviewReason: "transaction_receipt_timeout",
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return "review_required";
    }
    await reference.set({
      lastEvaluatedAt: now,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return "pending";
  }
}

async function storeSnapshot(input: {
  database: Firestore;
  document: FirebaseFirestore.QueryDocumentSnapshot;
  now: number;
  order: NonNullable<ReturnType<typeof normalizeLivePositionGuardOnchainOrder>>;
  preview: NonNullable<ReturnType<typeof normalizeLivePositionGuardOnchainPreview>>;
  revision: number;
  checkpointHash?: Hex;
}) {
  return input.database.runTransaction(async (transaction) => {
    const fresh = await transaction.get(input.document.ref);
    if (fresh.data()?.status !== "active" || fresh.data()?.revision !== input.revision) return false;
    transaction.set(input.document.ref, {
      checkpointTransactionHash: input.checkpointHash ?? FieldValue.delete(),
      currentUnitQuoteX18: input.preview.currentUnitQuoteX18.toString(),
      effectiveFloorUnitQuoteX18: input.preview.effectiveFloorUnitQuoteX18.toString(),
      firstBelowFloorAt: input.order.firstBelowFloorAt || null,
      firstBelowFloorBlock: input.order.firstBelowFloorBlock > 0n
        ? input.order.firstBelowFloorBlock.toString()
        : null,
      highWatermarkUnitQuoteX18: input.order.highWatermarkUnitQuoteX18.toString(),
      lastEvaluatedAt: input.now,
      lastEvaluationError: FieldValue.delete(),
      lastTriggerState: input.preview.state,
      reviewReason: FieldValue.delete(),
      revision: input.revision + 1,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return true;
  });
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
  if (status === "submitted") return reconcileSubmitted(reference, data, input.now, input.configuration);
  if (status === "executing") {
    const executionStartedAt = safeInteger(data.executionStartedAt) ?? input.now;
    if (input.now - executionStartedAt > 120_000) {
      await reference.set({
        lastEvaluatedAt: input.now,
        reviewReason: "execution_result_unknown",
        status: "review_required",
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return "review_required";
    }
    await reference.set({ lastEvaluatedAt: input.now, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return "executing";
  }

  const wallet = address(data.wallet);
  const token = address(data.token);
  const pair = address(data.pair);
  const executor = address(data.executor);
  const amountLimit = positiveBigInt(data.amountIn, MAX_UINT128);
  const settings = normalizeLivePositionGuardSettings(data.settings);
  const expiresAt = safeInteger(data.expiresAt);
  const walletId = typeof data.walletId === "string" && /^[A-Za-z0-9_-]{8,160}$/.test(data.walletId)
    ? data.walletId
    : "";
  const id = orderId(data.orderId);
  const fee = safeInteger(data.fee);
  const twapSeconds = safeInteger(data.twapSeconds);
  const maxSlippageBps = safeInteger(data.maxSlippageBps);
  const revision = safeInteger(data.revision);
  if (
    !wallet || !token || !pair || executor !== input.configuration.executor || !amountLimit || !settings
    || !expiresAt || !walletId || !id || fee === null || twapSeconds === null
    || maxSlippageBps === null || revision === null
  ) {
    await reference.set({
      lastEvaluatedAt: input.now,
      status: "review_required",
      reviewReason: "invalid_order_record",
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return "review_required";
  }

  const [balance, allowance, onchainOrder] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [wallet, executor] }),
    readOrder(executor, wallet, id)
  ]);
  if (!onchainOrder || !immutableOrderMatches({ amountIn: amountLimit, order: onchainOrder, pair, settings, token })) {
    await reference.set({
      lastEvaluatedAt: input.now,
      status: "review_required",
      reviewReason: "onchain_order_mismatch",
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return "review_required";
  }

  if (onchainOrder.status !== 1) {
    const mapped = onchainOrder.status === 2
      ? "cancelled"
      : onchainOrder.status === 3
        ? "executed"
        : onchainOrder.status === 4
          ? "expired"
          : "review_required";
    const residualAllowance = allowance > 0n;
    await reference.set({
      lastEvaluatedAt: input.now,
      onchainOrderClosedAt: mapped === "review_required" ? FieldValue.delete() : input.now,
      status: residualAllowance ? "review_required" : mapped,
      reviewReason: residualAllowance
        ? "residual_executor_allowance"
        : mapped === "review_required"
          ? "unknown_onchain_order_status"
          : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return residualAllowance ? "review_required" : mapped;
  }

  const plan: LivePositionGuardPreparedPlan = {
    amountIn: amountLimit,
    breakEvenActivationBps: settings.breakEvenActivationBps,
    expiresAt: Math.floor(expiresAt / 1_000),
    fee,
    maxSlippageBps,
    orderId: id,
    pair,
    stopLossBps: settings.stopLossBps,
    token,
    trailingStopBps: settings.trailingStopBps,
    twapSeconds
  };
  if (!livePositionGuardOnchainOrderMatchesPlan(onchainOrder, plan)) {
    await reference.set({
      lastEvaluatedAt: input.now,
      status: "review_required",
      reviewReason: "onchain_order_plan_mismatch",
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return "review_required";
  }

  const authority = livePositionGuardRuntimeAuthority({ allowance, balance, amountLimit });
  if (authority.status !== "ready") {
    await reference.set({
      lastEvaluatedAt: input.now,
      status: authority.status,
      reviewReason: authority.reviewReason ?? FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return authority.status;
  }

  let preview = await readPreview(executor, wallet, id);
  if (!preview) {
    await reference.set({
      lastEvaluatedAt: input.now,
      lastEvaluationError: "onchain_preview_unavailable",
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return "failed_safely";
  }
  const nowSeconds = Math.floor(input.now / 1_000);
  const significantHigh = preview.highWatermarkUnitQuoteX18 * BPS
    >= onchainOrder.highWatermarkUnitQuoteX18 * (BPS + HIGH_WATERMARK_CHECKPOINT_BPS);
  const staleConfirmation = onchainOrder.firstBelowFloorAt > 0
    && nowSeconds > onchainOrder.firstBelowFloorAt + CONFIRMATION_RESET_SECONDS;
  const needsCheckpoint = preview.state === 3
    || (preview.state === 0 && (onchainOrder.firstBelowFloorAt > 0 || significantHigh))
    || (preview.state === 1 && (onchainOrder.firstBelowFloorAt === 0 || staleConfirmation));

  if (needsCheckpoint) {
    try {
      const checkpointHash = await sendAndConfirm({
        call: buildLivePositionGuardCheckpointCall({ executor, orderId: id }),
        configuration: input.configuration,
        idempotencyKey: `rmt-guard-checkpoint-${input.document.id}-${revision}`,
        walletId
      });
      const refreshedOrder = await readOrder(executor, wallet, id);
      if (!refreshedOrder) throw new Error("Checkpointed order could not be reread.");
      if (refreshedOrder.status === 4) {
        await reference.set({
          checkpointTransactionHash: checkpointHash,
          expiredAt: input.now,
          lastEvaluatedAt: input.now,
          onchainOrderClosedAt: input.now,
          status: allowance > 0n ? "review_required" : "expired",
          reviewReason: allowance > 0n ? "residual_executor_allowance" : FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        return allowance > 0n ? "review_required" : "expired";
      }
      preview = await readPreview(executor, wallet, id);
      if (!preview) throw new Error("Checkpointed preview could not be reread.");
      await storeSnapshot({
        checkpointHash,
        database: input.database,
        document: input.document,
        now: input.now,
        order: refreshedOrder,
        preview,
        revision
      });
      return preview.state === 1 ? "confirming" : "active";
    } catch {
      await reference.set({
        lastEvaluatedAt: input.now,
        lastEvaluationError: "checkpoint_submission_failed_safely",
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return "failed_safely";
    }
  }

  if (preview.state !== 2) {
    await storeSnapshot({
      database: input.database,
      document: input.document,
      now: input.now,
      order: onchainOrder,
      preview,
      revision
    });
    return preview.state === 1 ? "confirming" : "active";
  }

  const quote = await quoteAndBuildExternalUniswapSwap({
    token,
    pair,
    recipient: wallet,
    side: "sell",
    amountIn: amountLimit,
    maxPriceImpact: settings.maxPriceImpactBps / 10_000
  });
  if (
    quote.executionFee || !quote.grossQuoteOut || !quote.grossMinimumOut
    || quote.marketPair.toLowerCase() !== pair.toLowerCase() || quote.fee !== onchainOrder.fee
  ) {
    await reference.set({
      lastEvaluatedAt: input.now,
      status: "review_required",
      reviewReason: "ineligible_route",
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return "review_required";
  }
  const contractMinimum = preview.twapAmountOut
    * BigInt(BPS - BigInt(onchainOrder.maxSlippageBps)) / BPS;
  const grossQuoteOut = BigInt(quote.grossQuoteOut);
  if (grossQuoteOut < contractMinimum) {
    await reference.set({
      currentUnitQuoteX18: preview.currentUnitQuoteX18.toString(),
      effectiveFloorUnitQuoteX18: preview.effectiveFloorUnitQuoteX18.toString(),
      lastEvaluatedAt: input.now,
      lastEvaluationError: "fresh_quote_below_twap_minimum",
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return "triggered_waiting_quote";
  }
  const quoteMinimum = BigInt(quote.grossMinimumOut);
  const amountOutMinimum = quoteMinimum > contractMinimum ? quoteMinimum : contractMinimum;
  const attemptId = randomUUID();
  const transitioned = await input.database.runTransaction(async (transaction) => {
    const fresh = await transaction.get(reference);
    if (fresh.data()?.status !== "active" || fresh.data()?.revision !== revision) return false;
    transaction.set(reference, {
      executionAttemptId: attemptId,
      executionStartedAt: input.now,
      lastEvaluatedAt: input.now,
      status: "executing",
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return true;
  });
  if (!transitioned) return "raced";

  try {
    const result = await sendLivePositionGuardTransaction({
      call: buildLivePositionGuardExecutorCall({
        amountOutMinimum,
        deadline: BigInt(quote.deadline),
        executor,
        orderId: id
      }),
      configuration: input.configuration,
      idempotencyKey: `rmt-guard-execute-${attemptId}`,
      walletId
    });
    if (typeof result.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result.hash)) {
      throw new Error("Position Guard transaction hash was not returned.");
    }
    await reference.set({
      lastEvaluatedAt: Date.now(),
      orderId: id,
      status: "submitted",
      submittedAt: Date.now(),
      transactionHash: result.hash,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return "submitted";
  } catch {
    await reference.set({
      lastEvaluatedAt: Date.now(),
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
  const lease = await acquireLease(database, now);
  if (!lease) return NextResponse.json({ status: "already_running" }, { headers: HEADERS });
  const heartbeat = database.collection("livePositionGuardSystem").doc("evaluatorHeartbeat");
  try {
    await heartbeat.set({ lastSeenAt: now, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const orders = await database.collection("livePositionGuardOrders")
      .where("status", "in", ORDER_STATUS)
      .orderBy("lastEvaluatedAt", "asc")
      .limit(MAX_ORDERS)
      .get();
    const results = await Promise.all(orders.docs.map(async (document) => {
      try {
        return await evaluateOrder({ configuration, database, document, now });
      } catch {
        await document.ref.set({
          lastEvaluatedAt: now,
          lastEvaluationError: "evaluation_failed_safely",
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        return "failed_safely";
      }
    }));
    const counts = results.reduce<Record<string, number>>((summary, result) => ({
      ...summary,
      [result]: (summary[result] ?? 0) + 1
    }), {});
    await heartbeat.set({
      lastCompletedAt: Date.now(),
      lastProcessed: orders.size,
      lastResultCounts: counts,
      lastSeenAt: Date.now(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return NextResponse.json({ counts, processed: orders.size, status: "complete" }, { headers: HEADERS });
  } finally {
    await releaseLease(database, lease).catch(() => undefined);
  }
}
