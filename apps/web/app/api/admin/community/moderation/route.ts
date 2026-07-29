import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { normalizeCommunityRoomId } from "../../../../../lib/community";
import { normalizeCommunityReportReason } from "../../../../../lib/community-moderation";
import { RMT_ADMIN_EMAIL } from "../../../../../lib/creator-application";
import {
  communityAuthorKey,
  communityBearerToken,
  communityIdentitySecret
} from "../../../../../lib/server/community-identity";
import { getRmtAdminAuth, getRmtAdminFirestore } from "../../../../../lib/server/firebase-admin";
import { guardMediaRequest, readBoundedJsonRequest } from "../../../../../lib/server/media-request-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store" };
const REPORT_ID = /^[A-Za-z0-9]{20}--[0-9a-f]{32}$/;
const RESTRICTION_MINUTES = [0, 60, 1_440] as const;

async function verifiedAdmin(request: Request) {
  const token = communityBearerToken(request);
  const auth = getRmtAdminAuth();
  const db = getRmtAdminFirestore();
  const secret = communityIdentitySecret();
  if (!token || !auth || !db || !secret) return null;
  const identity = await auth.verifyIdToken(token, true);
  if (identity.email_verified !== true || identity.email?.toLowerCase() !== RMT_ADMIN_EMAIL) return null;
  return { db, reviewerKey: communityAuthorKey(secret, identity.uid) };
}

async function pendingReports(db: Firestore) {
  const snapshot = await db.collection("communityReports")
    .where("status", "==", "pending")
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();
  return snapshot.docs.map((document) => {
    const value = document.data();
    return {
      reportId: document.id,
      roomId: value.roomId,
      messageId: value.messageId,
      reason: value.reason,
      authorLabel: value.authorLabelSnapshot,
      messageBody: value.messageBodySnapshot,
      createdAt: value.createdAt?.toDate?.().toISOString?.() ?? new Date(0).toISOString()
    };
  });
}

export async function GET(request: Request) {
  const guard = guardMediaRequest(request, { namespace: "community-moderation-read", limit: 60, windowMs: 60_000 });
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status, headers: HEADERS });
  try {
    const admin = await verifiedAdmin(request);
    if (!admin) return NextResponse.json({ error: "RMT administrator access required." }, { status: 403, headers: HEADERS });
    return NextResponse.json({ reports: await pendingReports(admin.db) }, { headers: HEADERS });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code.startsWith("auth/")) return NextResponse.json({ error: "Administrator sign-in expired." }, { status: 401, headers: HEADERS });
    return NextResponse.json({ error: "The moderation queue is temporarily unavailable." }, { status: 503, headers: HEADERS });
  }
}

export async function POST(request: Request) {
  const guard = guardMediaRequest(request, { namespace: "community-moderation-action", limit: 30, windowMs: 60_000 });
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status, headers: HEADERS });
  const body = await readBoundedJsonRequest(request, 1_024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: HEADERS });
  const input = body.value && typeof body.value === "object" && !Array.isArray(body.value)
    ? body.value as Record<string, unknown>
    : {};
  if (input.operation === "list") {
    try {
      const admin = await verifiedAdmin(request);
      if (!admin) return NextResponse.json({ error: "RMT administrator access required." }, { status: 403, headers: HEADERS });
      return NextResponse.json({ reports: await pendingReports(admin.db) }, { headers: HEADERS });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      if (code.startsWith("auth/")) return NextResponse.json({ error: "Administrator sign-in expired." }, { status: 401, headers: HEADERS });
      return NextResponse.json({ error: "The moderation queue is temporarily unavailable." }, { status: 503, headers: HEADERS });
    }
  }
  if (input.operation !== "review") {
    return NextResponse.json({ error: "The moderation operation is invalid." }, { status: 400, headers: HEADERS });
  }
  const reportId = typeof input.reportId === "string" && REPORT_ID.test(input.reportId) ? input.reportId : "";
  const action = input.action === "dismiss" || input.action === "hide" ? input.action : "";
  const restrictionMinutes = typeof input.restrictionMinutes === "number"
    && RESTRICTION_MINUTES.includes(input.restrictionMinutes as never)
    ? input.restrictionMinutes as typeof RESTRICTION_MINUTES[number]
    : -1;
  const reviewNote = typeof input.reviewNote === "string" ? input.reviewNote.trim().slice(0, 240) : "";
  if (!reportId || !action || restrictionMinutes < 0 || reviewNote.length < 5 || (action === "dismiss" && restrictionMinutes !== 0)) {
    return NextResponse.json({ error: "The moderation action is invalid." }, { status: 400, headers: HEADERS });
  }

  try {
    const admin = await verifiedAdmin(request);
    if (!admin) return NextResponse.json({ error: "RMT administrator access required." }, { status: 403, headers: HEADERS });
    const reportReference = admin.db.collection("communityReports").doc(reportId);
    const auditReference = admin.db.collection("communityModerationAudit").doc();
    await admin.db.runTransaction(async (transaction) => {
      const reportSnapshot = await transaction.get(reportReference);
      const report = reportSnapshot.data();
      if (!reportSnapshot.exists || report?.status !== "pending") throw new Error("resolved");
      const roomId = normalizeCommunityRoomId(report.roomId);
      const reason = normalizeCommunityReportReason(report.reason);
      if (!roomId || !reason || !/^[A-Za-z0-9]{20}$/.test(report.messageId) || !/^[0-9a-f]{32}$/.test(report.messageAuthorKey)) {
        throw new Error("invalid");
      }
      const messageReference = admin.db.collection("communityRooms").doc(roomId).collection("messages").doc(report.messageId);
      transaction.update(reportReference, {
        status: action === "dismiss" ? "dismissed" : "actioned",
        action,
        restrictionMinutes,
        reviewNote,
        reviewerKey: admin.reviewerKey,
        reviewedAt: FieldValue.serverTimestamp()
      });
      if (action === "hide") {
        transaction.update(messageReference, {
          status: "moderated",
          moderationReason: reason,
          moderatedAt: FieldValue.serverTimestamp()
        });
        if (restrictionMinutes > 0) {
          transaction.set(admin.db.collection("communityActors").doc(report.messageAuthorKey), {
            bannedUntil: Timestamp.fromMillis(Date.now() + restrictionMinutes * 60_000),
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });
        }
      }
      transaction.create(auditReference, {
        reportId,
        roomId,
        messageId: report.messageId,
        action,
        reason,
        restrictionMinutes,
        reviewNote,
        reviewerKey: admin.reviewerKey,
        createdAt: FieldValue.serverTimestamp()
      });
    });
    return NextResponse.json({ reportId, action, restrictionMinutes }, { headers: HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code.startsWith("auth/")) return NextResponse.json({ error: "Administrator sign-in expired." }, { status: 401, headers: HEADERS });
    if (message === "resolved") return NextResponse.json({ error: "This report was already reviewed." }, { status: 409, headers: HEADERS });
    if (message === "invalid") return NextResponse.json({ error: "This report record is invalid." }, { status: 409, headers: HEADERS });
    return NextResponse.json({ error: "The moderation action could not be recorded." }, { status: 503, headers: HEADERS });
  }
}
