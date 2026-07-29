import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { COMMUNITY_SCHEMA_VERSION } from "../../../../lib/community";
import {
  normalizeCommunityFeedbackCategory,
  normalizeCommunityFeedbackDescription,
  normalizeCommunityFeedbackStatus,
  normalizeCommunityFeedbackTitle,
  validateCommunityFeedbackContent
} from "../../../../lib/community-feedback";
import {
  communityAuthorKey,
  communityBearerToken,
  communityIdentitySecret
} from "../../../../lib/server/community-identity";
import { getRmtAdminAuth, getRmtAdminFirestore } from "../../../../lib/server/firebase-admin";
import { guardMediaRequest, readBoundedJsonRequest } from "../../../../lib/server/media-request-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store" };
const WINDOW_MS = 24 * 60 * 60_000;
const COOLDOWN_MS = 2 * 60_000;

export async function POST(request: Request) {
  const guard = guardMediaRequest(request, { namespace: "community-feedback", limit: 8, windowMs: 24 * 60 * 60_000 });
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status, headers: HEADERS });
  const token = communityBearerToken(request);
  if (!token) return NextResponse.json({ error: "Community identity required." }, { status: 401, headers: HEADERS });
  const body = await readBoundedJsonRequest(request, 2_048);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: HEADERS });
  const input = body.value && typeof body.value === "object" && !Array.isArray(body.value)
    ? body.value as Record<string, unknown>
    : {};
  const category = normalizeCommunityFeedbackCategory(input.category);
  const title = normalizeCommunityFeedbackTitle(input.title);
  const description = normalizeCommunityFeedbackDescription(input.description);
  if (!category || title.length < 4 || description.length < 10) {
    return NextResponse.json({ error: "Add a category, a clear title, and at least 10 characters of detail." }, { status: 400, headers: HEADERS });
  }

  const auth = getRmtAdminAuth();
  const db = getRmtAdminFirestore();
  const secret = communityIdentitySecret();
  if (!auth || !db || !secret) {
    return NextResponse.json({ error: "Community feedback is awaiting secure configuration." }, { status: 503, headers: HEADERS });
  }

  try {
    const identity = await auth.verifyIdToken(token, true);
    const guest = identity.firebase?.sign_in_provider === "anonymous";
    if (!guest && identity.email_verified !== true) {
      return NextResponse.json({ error: "Verified member or guest identity required." }, { status: 403, headers: HEADERS });
    }
    const contentError = validateCommunityFeedbackContent(title, description, guest);
    if (contentError) return NextResponse.json({ error: contentError }, { status: 400, headers: HEADERS });
    const authorKey = communityAuthorKey(secret, identity.uid);
    const actorReference = db.collection("communityActors").doc(authorKey);
    const feedbackReference = db.collection("communityFeedback").doc();
    const statusReference = db.collection("communityFeedbackStatus").doc(feedbackReference.id);
    const now = Date.now();
    await db.runTransaction(async (transaction) => {
      const actorSnapshot = await transaction.get(actorReference);
      const actor = actorSnapshot.data() as {
        lastFeedbackAt?: Timestamp;
        feedbackWindowStartedAt?: Timestamp;
        feedbackWindowCount?: number;
      } | undefined;
      if (actor?.lastFeedbackAt && now - actor.lastFeedbackAt.toMillis() < COOLDOWN_MS) throw new Error("cooldown");
      const sameWindow = Boolean(actor?.feedbackWindowStartedAt && now - actor.feedbackWindowStartedAt.toMillis() < WINDOW_MS);
      const count = sameWindow ? actor?.feedbackWindowCount ?? 0 : 0;
      if (count >= (guest ? 3 : 10)) throw new Error("quota");
      transaction.set(actorReference, {
        lastFeedbackAt: FieldValue.serverTimestamp(),
        feedbackWindowStartedAt: sameWindow ? actor!.feedbackWindowStartedAt : FieldValue.serverTimestamp(),
        feedbackWindowCount: count + 1,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      transaction.create(feedbackReference, {
        schemaVersion: COMMUNITY_SCHEMA_VERSION,
        feedbackId: feedbackReference.id,
        authorKey,
        identityKind: guest ? "guest" : "member",
        category,
        title,
        description,
        status: "submitted",
        reviewNote: "",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      transaction.create(statusReference, {
        schemaVersion: COMMUNITY_SCHEMA_VERSION,
        feedbackId: feedbackReference.id,
        category,
        status: "submitted",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    });
    return NextResponse.json({ feedbackId: feedbackReference.id, status: "submitted" }, { headers: HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code.startsWith("auth/")) return NextResponse.json({ error: "Community identity expired." }, { status: 401, headers: HEADERS });
    if (message === "cooldown") return NextResponse.json({ error: "Please wait two minutes before sending more feedback." }, { status: 429, headers: HEADERS });
    if (message === "quota") return NextResponse.json({ error: "Daily feedback limit reached. Try again tomorrow." }, { status: 429, headers: HEADERS });
    return NextResponse.json({ error: "Feedback could not be submitted." }, { status: 503, headers: HEADERS });
  }
}

export async function DELETE(request: Request) {
  const guard = guardMediaRequest(request, { namespace: "community-feedback-withdraw", limit: 12, windowMs: 60 * 60_000 });
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status, headers: HEADERS });
  const token = communityBearerToken(request);
  if (!token) return NextResponse.json({ error: "Community identity required." }, { status: 401, headers: HEADERS });
  const body = await readBoundedJsonRequest(request, 256);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: HEADERS });
  const input = body.value && typeof body.value === "object" && !Array.isArray(body.value)
    ? body.value as Record<string, unknown>
    : {};
  const feedbackId = typeof input.feedbackId === "string" && /^[A-Za-z0-9]{20}$/.test(input.feedbackId)
    ? input.feedbackId
    : "";
  if (!feedbackId) return NextResponse.json({ error: "Feedback receipt is invalid." }, { status: 400, headers: HEADERS });
  const auth = getRmtAdminAuth();
  const db = getRmtAdminFirestore();
  const secret = communityIdentitySecret();
  if (!auth || !db || !secret) {
    return NextResponse.json({ error: "Community feedback is awaiting secure configuration." }, { status: 503, headers: HEADERS });
  }

  try {
    const identity = await auth.verifyIdToken(token, true);
    const guest = identity.firebase?.sign_in_provider === "anonymous";
    if (!guest && identity.email_verified !== true) {
      return NextResponse.json({ error: "Verified member or guest identity required." }, { status: 403, headers: HEADERS });
    }
    const authorKey = communityAuthorKey(secret, identity.uid);
    const feedbackReference = db.collection("communityFeedback").doc(feedbackId);
    const statusReference = db.collection("communityFeedbackStatus").doc(feedbackId);
    const auditReference = db.collection("communityFeedbackAudit").doc();
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(feedbackReference);
      if (!snapshot.exists) throw new Error("missing");
      const record = snapshot.data();
      if (record?.authorKey !== authorKey) throw new Error("ownership");
      const previousStatus = normalizeCommunityFeedbackStatus(record?.status);
      if (!previousStatus) throw new Error("invalid");
      transaction.delete(feedbackReference);
      transaction.update(statusReference, {
        status: "closed",
        updatedAt: FieldValue.serverTimestamp()
      });
      transaction.create(auditReference, {
        feedbackId,
        previousStatus,
        status: "closed",
        action: "author_withdrawn",
        createdAt: FieldValue.serverTimestamp()
      });
    });
    return NextResponse.json({ feedbackId, status: "closed", withdrawn: true }, { headers: HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code.startsWith("auth/")) return NextResponse.json({ error: "Community identity expired." }, { status: 401, headers: HEADERS });
    if (message === "missing") return NextResponse.json({ error: "This private feedback record is already unavailable." }, { status: 404, headers: HEADERS });
    if (message === "ownership") return NextResponse.json({ error: "Only the identity that submitted this feedback can withdraw it." }, { status: 403, headers: HEADERS });
    return NextResponse.json({ error: "Feedback could not be withdrawn." }, { status: 503, headers: HEADERS });
  }
}
