import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import {
  COMMUNITY_PRIVATE_RETENTION_MS,
  COMMUNITY_SCHEMA_VERSION,
  normalizeCommunityRoomId
} from "../../../../lib/community";
import { normalizeCommunityReportReason } from "../../../../lib/community-moderation";
import {
  communityAuthorKey,
  communityBearerToken,
  communityIdentitySecret,
  isVerifiedCommunityMember
} from "../../../../lib/server/community-identity";
import { getRmtAdminAuth, getRmtAdminFirestore } from "../../../../lib/server/firebase-admin";
import { consumeCommunityRateLimit } from "../../../../lib/server/community-rate-limit";
import { guardMediaRequest, readBoundedJsonRequest } from "../../../../lib/server/media-request-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const guard = guardMediaRequest(request, { namespace: "community-report", limit: 30, windowMs: 60 * 60_000 });
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status, headers: HEADERS });
  const token = communityBearerToken(request);
  if (!token) return NextResponse.json({ error: "Community identity required." }, { status: 401, headers: HEADERS });
  const body = await readBoundedJsonRequest(request, 512);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: HEADERS });
  const input = body.value && typeof body.value === "object" && !Array.isArray(body.value)
    ? body.value as Record<string, unknown>
    : {};
  const roomId = normalizeCommunityRoomId(input.roomId);
  const messageId = typeof input.messageId === "string" && /^[A-Za-z0-9]{20}$/.test(input.messageId)
    ? input.messageId
    : "";
  const reason = normalizeCommunityReportReason(input.reason);
  if (!roomId || !messageId || !reason) {
    return NextResponse.json({ error: "The report is invalid." }, { status: 400, headers: HEADERS });
  }

  const auth = getRmtAdminAuth();
  const db = getRmtAdminFirestore();
  const secret = communityIdentitySecret();
  if (!auth || !db || !secret) {
    return NextResponse.json({ error: "Community reporting is awaiting secure configuration." }, { status: 503, headers: HEADERS });
  }

  try {
    const identity = await auth.verifyIdToken(token, true);
    const guest = identity.firebase?.sign_in_provider === "anonymous";
    if (!guest && !isVerifiedCommunityMember(identity)) {
      return NextResponse.json({ error: "Verified member or guest identity required." }, { status: 403, headers: HEADERS });
    }
    const distributedLimit = await consumeCommunityRateLimit(db, secret, request, {
      namespace: "report",
      limit: 30,
      windowMs: 60 * 60_000
    });
    if (!distributedLimit.allowed) {
      return NextResponse.json({ error: "Too many community reports from this network. Please wait and try again." }, {
        status: 429,
        headers: { ...HEADERS, "Retry-After": String(distributedLimit.retryAfterSeconds) }
      });
    }
    const reporterKey = communityAuthorKey(secret, identity.uid);
    const now = Date.now();
    const messageReference = db.collection("communityRooms").doc(roomId).collection("messages").doc(messageId);
    const reportId = `${messageId}--${reporterKey}`;
    const reportReference = db.collection("communityReports").doc(reportId);
    const result = await db.runTransaction(async (transaction) => {
      const [messageSnapshot, reportSnapshot] = await Promise.all([
        transaction.get(messageReference),
        transaction.get(reportReference)
      ]);
      const message = messageSnapshot.data();
      if (!messageSnapshot.exists || message?.status !== "visible") throw new Error("missing");
      if (message.authorKey === reporterKey) throw new Error("self");
      if (reportSnapshot.exists) return { idempotent: true };
      transaction.create(reportReference, {
        schemaVersion: COMMUNITY_SCHEMA_VERSION,
        reportId,
        roomId,
        messageId,
        messageAuthorKey: message.authorKey,
        reporterKey,
        reporterKind: guest ? "guest" : "member",
        reason,
        authorLabelSnapshot: String(message.authorLabel ?? "").slice(0, 40),
        messageBodySnapshot: String(message.body ?? "").slice(0, 500),
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(now + COMMUNITY_PRIVATE_RETENTION_MS)
      });
      return { idempotent: false };
    });
    return NextResponse.json({ reportId, idempotent: result.idempotent }, { headers: HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code.startsWith("auth/")) return NextResponse.json({ error: "Community identity expired." }, { status: 401, headers: HEADERS });
    if (message === "missing") return NextResponse.json({ error: "This message is no longer reportable." }, { status: 404, headers: HEADERS });
    if (message === "self") return NextResponse.json({ error: "You cannot report your own message." }, { status: 409, headers: HEADERS });
    return NextResponse.json({ error: "The report could not be recorded." }, { status: 503, headers: HEADERS });
  }
}
