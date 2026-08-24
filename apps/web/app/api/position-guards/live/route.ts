import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAddress, isAddress, type Address } from "viem";
import { livePositionGuardCancellationDisposition } from "../../../../lib/live-position-guard";
import { getRmtAdminFirestore } from "../../../../lib/server/firebase-admin";
import { guardMediaRequest, readBoundedJsonRequest } from "../../../../lib/server/media-request-guard";
import { privyBearerToken, verifyPrivyIdentity } from "../../../../lib/server/privy-identity";
import { retiredTransactionPreparationResponse } from "../../../../lib/server/retired-transaction-preparation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function orderDocumentId(identityId: string, wallet: Address, token: Address) {
  return `guard_${createHash("sha256").update(`${identityId}:${wallet.toLowerCase()}:${token.toLowerCase()}`).digest("hex")}`;
}

function ownerKey(identityId: string) {
  return createHash("sha256").update(identityId).digest("hex");
}

function validAddress(value: unknown) {
  return typeof value === "string" && isAddress(value) ? getAddress(value) : null;
}

async function verifiedIdentity(request: Request) {
  const token = privyBearerToken(request);
  if (!token) return null;
  const identity = await verifyPrivyIdentity(token);
  return identity.is_guest ? null : identity;
}

function publicOrder(data: Record<string, unknown> | undefined) {
  if (!data) return {
    status: "inactive", armedAt: null, expiresAt: null, lastEvaluatedAt: null,
    revocationPending: false, revocationRequestedAt: null, transactionHash: null,
    walletCleanupReported: null
  };
  const status = typeof data.status === "string" ? data.status : "inactive";
  const revocationRequestedAt = typeof data.revocationRequestedAt === "number" ? data.revocationRequestedAt : null;
  return {
    status,
    armedAt: typeof data.armedAt === "number" ? data.armedAt : null,
    expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : null,
    lastEvaluatedAt: typeof data.lastEvaluatedAt === "number" ? data.lastEvaluatedAt : null,
    revocationPending: revocationRequestedAt !== null && (status === "executing" || status === "submitted"),
    revocationRequestedAt,
    transactionHash: typeof data.transactionHash === "string" ? data.transactionHash : null,
    walletCleanupReported: revocationRequestedAt === null ? null : typeof data.walletCleanupReportedAt === "number"
  };
}

export async function GET(request: Request) {
  try {
    const database = getRmtAdminFirestore();
    const identity = await verifiedIdentity(request);
    if (!identity) return NextResponse.json({ error: "Sign in to review prior Position Guard records." }, { status: 401, headers: HEADERS });
    if (!database) return NextResponse.json({ available: false, systemStatus: "release_locked", ...publicOrder(undefined) }, { headers: HEADERS });
    const url = new URL(request.url);
    const wallet = validAddress(url.searchParams.get("wallet"));
    const token = validAddress(url.searchParams.get("token"));
    if (!wallet || !token) return NextResponse.json({ error: "Choose a valid wallet and token." }, { status: 400, headers: HEADERS });
    const document = await database.collection("livePositionGuardOrders").doc(orderDocumentId(identity.id, wallet, token)).get();
    const data = document.data() as Record<string, unknown> | undefined;
    if (data && data.ownerKey !== ownerKey(identity.id)) {
      return NextResponse.json({ error: "Position Guard ownership could not be verified." }, { status: 403, headers: HEADERS });
    }
    return NextResponse.json({ available: false, systemStatus: "release_locked", ...publicOrder(data) }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "RMT could not verify prior Position Guard records." }, { status: 401, headers: HEADERS });
  }
}

export async function POST(request: Request) {
  const requestGuard = guardMediaRequest(request, { namespace: "live-position-guard", limit: 8, windowMs: 60_000 });
  if (!requestGuard.ok) {
    return NextResponse.json({ error: requestGuard.error }, {
      status: requestGuard.status,
      headers: { ...HEADERS, ...(requestGuard.retryAfterSeconds ? { "Retry-After": String(requestGuard.retryAfterSeconds) } : {}) }
    });
  }
  const parsed = await readBoundedJsonRequest(request, 4_096);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: HEADERS });
  const input = parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value) ? parsed.value as Record<string, unknown> : {};
  if (input.action === "arm") return retiredTransactionPreparationResponse();
  const wallet = validAddress(input.wallet);
  const token = validAddress(input.token);
  if (input.action !== "cancel" || !wallet || !token) {
    return NextResponse.json({ error: "Choose a valid Position Guard cancellation, wallet and token." }, { status: 400, headers: HEADERS });
  }

  try {
    const database = getRmtAdminFirestore();
    const identity = await verifiedIdentity(request);
    if (!identity) return NextResponse.json({ error: "Sign in to manage prior Position Guard records." }, { status: 401, headers: HEADERS });
    if (!database) return NextResponse.json({ error: "Position Guard records are temporarily unavailable." }, { status: 503, headers: { ...HEADERS, "Retry-After": "30" } });
    const identityOwnerKey = ownerKey(identity.id);
    const reference = database.collection("livePositionGuardOrders").doc(orderDocumentId(identity.id, wallet, token));
    const existing = await reference.get();
    if (!existing.exists) return NextResponse.json({ available: false, systemStatus: "release_locked", ...publicOrder(undefined) }, { headers: HEADERS });
    const existingData = existing.data() as Record<string, unknown>;
    if (existingData.ownerKey !== identityOwnerKey) return NextResponse.json({ error: "Position Guard ownership could not be verified." }, { status: 403, headers: HEADERS });
    const now = Date.now();
    const walletCleanupReportedAt = input.walletAuthorityRemoved === true ? now : null;
    const disposition = livePositionGuardCancellationDisposition(existingData.status);
    if (disposition === "reconcile") {
      const next = { ...existingData, revocationRequestedAt: now, walletCleanupReportedAt };
      await reference.set({ revocationRequestedAt: now, updatedAt: FieldValue.serverTimestamp(), walletCleanupReportedAt }, { merge: true });
      return NextResponse.json({ available: false, systemStatus: "release_locked", ...publicOrder(next) }, { headers: HEADERS });
    }
    if (disposition === "review") {
      const next = { ...existingData, reviewReason: "cancellation_unknown_state", revocationRequestedAt: now, status: "review_required", walletCleanupReportedAt };
      await reference.set({ reviewReason: "cancellation_unknown_state", revocationRequestedAt: now, status: "review_required", updatedAt: FieldValue.serverTimestamp(), walletCleanupReportedAt }, { merge: true });
      return NextResponse.json({ available: false, systemStatus: "release_locked", ...publicOrder(next) }, { headers: HEADERS });
    }
    const next = { ...existingData, cancelledAt: now, revocationRequestedAt: now, status: "cancelled", walletCleanupReportedAt };
    await reference.set({ cancelledAt: now, revocationRequestedAt: now, status: "cancelled", updatedAt: FieldValue.serverTimestamp(), walletCleanupReportedAt }, { merge: true });
    return NextResponse.json({ available: false, systemStatus: "release_locked", ...publicOrder(next) }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "RMT could not safely update prior Position Guard records." }, { status: 409, headers: HEADERS });
  }
}
