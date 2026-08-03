import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { COMMUNITY_AUDIT_RETENTION_MS } from "../../../../../lib/community";
import {
  normalizeCommunityFeedbackStatus,
  type CommunityFeedbackStatus
} from "../../../../../lib/community-feedback";
import { RMT_ADMIN_EMAIL } from "../../../../../lib/creator-application";
import {
  communityAuthorKey,
  communityBearerToken,
  communityIdentitySecret,
  isRmtAdminIdentity
} from "../../../../../lib/server/community-identity";
import { getRmtAdminAuth, getRmtAdminFirestore } from "../../../../../lib/server/firebase-admin";
import { guardMediaRequest, readBoundedJsonRequest } from "../../../../../lib/server/media-request-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store" };
const FEEDBACK_ID = /^[A-Za-z0-9]{20}$/;
const TRANSITIONS: Record<CommunityFeedbackStatus, CommunityFeedbackStatus[]> = {
  submitted: ["under_review", "planned", "closed"],
  under_review: ["planned", "closed"],
  planned: ["shipped", "closed"],
  shipped: [],
  closed: []
};

async function verifiedAdmin(request: Request) {
  const token = communityBearerToken(request);
  const auth = getRmtAdminAuth();
  const db = getRmtAdminFirestore();
  const secret = communityIdentitySecret();
  if (!token || !auth || !db || !secret) return null;
  const identity = await auth.verifyIdToken(token, true);
  if (!isRmtAdminIdentity(identity, RMT_ADMIN_EMAIL)) return null;
  return { db, reviewerKey: communityAuthorKey(secret, identity.uid) };
}

export async function POST(request: Request) {
  const guard = guardMediaRequest(request, { namespace: "community-feedback-admin", limit: 60, windowMs: 60_000 });
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status, headers: HEADERS });
  const body = await readBoundedJsonRequest(request, 1_024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: HEADERS });
  const input = body.value && typeof body.value === "object" && !Array.isArray(body.value)
    ? body.value as Record<string, unknown>
    : {};
  try {
    const admin = await verifiedAdmin(request);
    if (!admin) return NextResponse.json({ error: "RMT administrator access required." }, { status: 403, headers: HEADERS });
    if (input.operation === "list") {
      const snapshot = await admin.db.collection("communityFeedback").orderBy("createdAt", "desc").limit(50).get();
      return NextResponse.json({
        feedback: snapshot.docs.map((document) => {
          const value = document.data();
          return {
            feedbackId: document.id,
            category: value.category,
            title: value.title,
            description: value.description,
            identityKind: value.identityKind,
            status: value.status,
            reviewNote: value.reviewNote ?? "",
            createdAt: value.createdAt?.toDate?.().toISOString?.() ?? new Date(0).toISOString()
          };
        })
      }, { headers: HEADERS });
    }
    if (input.operation !== "review") {
      return NextResponse.json({ error: "The feedback operation is invalid." }, { status: 400, headers: HEADERS });
    }
    const feedbackId = typeof input.feedbackId === "string" && FEEDBACK_ID.test(input.feedbackId) ? input.feedbackId : "";
    const nextStatus = normalizeCommunityFeedbackStatus(input.status);
    const reviewNote = typeof input.reviewNote === "string" ? input.reviewNote.trim().slice(0, 240) : "";
    if (!feedbackId || !nextStatus || reviewNote.length < 5) {
      return NextResponse.json({ error: "The feedback decision is invalid." }, { status: 400, headers: HEADERS });
    }
    const feedbackReference = admin.db.collection("communityFeedback").doc(feedbackId);
    const statusReference = admin.db.collection("communityFeedbackStatus").doc(feedbackId);
    const auditReference = admin.db.collection("communityFeedbackAudit").doc();
    await admin.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(feedbackReference);
      const currentStatus = normalizeCommunityFeedbackStatus(snapshot.data()?.status);
      if (!snapshot.exists || !currentStatus) throw new Error("missing");
      if (!TRANSITIONS[currentStatus].includes(nextStatus)) throw new Error("transition");
      transaction.update(feedbackReference, {
        status: nextStatus,
        reviewNote,
        reviewerKey: admin.reviewerKey,
        reviewedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      transaction.update(statusReference, {
        status: nextStatus,
        updatedAt: FieldValue.serverTimestamp()
      });
      transaction.create(auditReference, {
        feedbackId,
        previousStatus: currentStatus,
        status: nextStatus,
        reviewNote,
        reviewerKey: admin.reviewerKey,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + COMMUNITY_AUDIT_RETENTION_MS)
      });
    });
    return NextResponse.json({ feedbackId, status: nextStatus }, { headers: HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code.startsWith("auth/")) return NextResponse.json({ error: "Administrator sign-in expired." }, { status: 401, headers: HEADERS });
    if (message === "missing") return NextResponse.json({ error: "This feedback record is unavailable." }, { status: 404, headers: HEADERS });
    if (message === "transition") return NextResponse.json({ error: "That feedback status transition is not allowed." }, { status: 409, headers: HEADERS });
    return NextResponse.json({ error: "The feedback decision could not be recorded." }, { status: 503, headers: HEADERS });
  }
}
