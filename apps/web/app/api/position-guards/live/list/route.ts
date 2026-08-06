import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import {
  livePositionGuardHeartbeatIsFresh
} from "../../../../../lib/live-position-guard";
import { getRmtAdminFirestore } from "../../../../../lib/server/firebase-admin";
import { livePositionGuardServerConfiguration } from "../../../../../lib/server/live-position-guard-execution";
import { privyBearerToken, verifyPrivyIdentity } from "../../../../../lib/server/privy-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};
const MAX_ORDERS = 200;

function ownerKey(identityId: string) {
  return createHash("sha256").update(identityId).digest("hex");
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function addressOrNull(value: unknown) {
  return typeof value === "string" && isAddress(value) ? getAddress(value) : null;
}

function hashOrNull(value: unknown) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value) ? value : null;
}

function amountOrNull(value: unknown) {
  return typeof value === "string" && /^[0-9]{1,39}$/.test(value) ? value : null;
}

function settingsOrNull(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const stopLossBps = numberOrNull(candidate.stopLossBps);
  const trailingStopBps = numberOrNull(candidate.trailingStopBps);
  const breakEvenActivationBps = numberOrNull(candidate.breakEvenActivationBps);
  const maxPriceImpactBps = numberOrNull(candidate.maxPriceImpactBps);
  if (
    stopLossBps === null || trailingStopBps === null
    || breakEvenActivationBps === null || maxPriceImpactBps === null
  ) return null;
  return { stopLossBps, trailingStopBps, breakEvenActivationBps, maxPriceImpactBps };
}

async function verifiedIdentity(request: Request) {
  const token = privyBearerToken(request);
  if (!token) return null;
  const identity = await verifyPrivyIdentity(token);
  return identity.is_guest ? null : identity;
}

async function systemStatus(database: NonNullable<ReturnType<typeof getRmtAdminFirestore>>) {
  const configuration = livePositionGuardServerConfiguration();
  if (!configuration) return "release_locked" as const;
  const heartbeat = await database.collection("livePositionGuardSystem")
    .doc("evaluatorHeartbeat")
    .get();
  return livePositionGuardHeartbeatIsFresh(heartbeat.data()?.lastSeenAt)
    ? "ready" as const
    : "worker_offline" as const;
}

export async function GET(request: Request) {
  try {
    const identity = await verifiedIdentity(request);
    if (!identity) {
      return NextResponse.json({ error: "Sign in to review automatic Position Guard orders." }, {
        status: 401,
        headers: HEADERS
      });
    }
    const database = getRmtAdminFirestore();
    if (!database) {
      return NextResponse.json({
        available: false,
        orders: [],
        systemStatus: "release_locked"
      }, { headers: HEADERS });
    }

    const requestedWallet = new URL(request.url).searchParams.get("wallet");
    const walletFilter = requestedWallet && isAddress(requestedWallet)
      ? getAddress(requestedWallet).toLowerCase()
      : null;
    const snapshot = await database.collection("livePositionGuardOrders")
      .where("ownerKey", "==", ownerKey(identity.id))
      .limit(MAX_ORDERS)
      .get();

    const orders = snapshot.docs
      .map((document) => {
        const data = document.data() as Record<string, unknown>;
        const wallet = addressOrNull(data.wallet);
        const token = addressOrNull(data.token);
        const pair = addressOrNull(data.pair);
        const executor = addressOrNull(data.executor);
        if (!wallet || !token || !pair || !executor) return null;
        const status = typeof data.status === "string" ? data.status : "review_required";
        const revocationRequestedAt = numberOrNull(data.revocationRequestedAt);
        return {
          id: document.id,
          wallet,
          token,
          pair,
          executor,
          status,
          amountIn: amountOrNull(data.amountIn),
          armedAt: numberOrNull(data.armedAt),
          expiresAt: numberOrNull(data.expiresAt),
          lastEvaluatedAt: numberOrNull(data.lastEvaluatedAt),
          revocationRequestedAt,
          revocationPending: revocationRequestedAt !== null
            && (status === "executing" || status === "submitted"),
          walletCleanupReported: revocationRequestedAt === null
            ? null
            : typeof data.walletCleanupReportedAt === "number",
          transactionHash: hashOrNull(data.transactionHash),
          settings: settingsOrNull(data.settings)
        };
      })
      .filter((order): order is NonNullable<typeof order> => order !== null)
      .filter((order) => !walletFilter || order.wallet.toLowerCase() === walletFilter)
      .sort((a, b) => (b.armedAt ?? 0) - (a.armedAt ?? 0));

    return NextResponse.json({
      available: true,
      capped: snapshot.size >= MAX_ORDERS,
      orders,
      systemStatus: await systemStatus(database),
      updatedAt: Date.now()
    }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "RMT could not verify the automatic-order inventory." }, {
      status: 401,
      headers: HEADERS
    });
  }
}
