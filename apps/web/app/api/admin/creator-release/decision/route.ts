import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import {
  CREATOR_RELEASE_OUTCOMES,
  CREATOR_RELEASE_REASON_CODES,
  createCreatorReleaseDecision,
  parseCreatorReleaseDecision
} from "../../../../../lib/creator-release-decision";
import { parseCreatorReleaseReview } from "../../../../../lib/creator-release-review";
import { RMT_ADMIN_EMAIL, normalizeProjectSlug } from "../../../../../lib/creator-application";
import {
  getRmtAdminAuth,
  getRmtAdminFirestore
} from "../../../../../lib/server/firebase-admin";
import {
  guardMediaRequest,
  readBoundedJsonRequest
} from "../../../../../lib/server/media-request-guard";

const HEADERS = { "Cache-Control": "no-store" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function tokenFrom(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~-]{100,4096})$/)?.[1] ?? "";
}

export async function POST(request: Request) {
  const guard = guardMediaRequest(request, { namespace: "creator-release-decision", limit: 20, windowMs: 60_000 });
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status, headers: HEADERS });
  const token = tokenFrom(request);
  if (!token) return NextResponse.json({ error: "RMT administrator sign-in required." }, { status: 401, headers: HEADERS });
  const body = await readBoundedJsonRequest(request, 4_096);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: HEADERS });
  const input = body.value && typeof body.value === "object" && !Array.isArray(body.value)
    ? body.value as Record<string, unknown>
    : {};
  const projectSlug = normalizeProjectSlug(input.projectSlug);
  const assetId = typeof input.assetId === "string" && /^[A-Za-z0-9]{20}$/.test(input.assetId) ? input.assetId : "";
  const reviewId = typeof input.reviewId === "string" && /^[0-9a-f]{64}$/.test(input.reviewId) ? input.reviewId : "";
  const outcome = typeof input.outcome === "string" && CREATOR_RELEASE_OUTCOMES.includes(input.outcome as never)
    ? input.outcome as typeof CREATOR_RELEASE_OUTCOMES[number]
    : null;
  const reasonCode = typeof input.reasonCode === "string" && CREATOR_RELEASE_REASON_CODES.includes(input.reasonCode as never)
    ? input.reasonCode as typeof CREATOR_RELEASE_REASON_CODES[number]
    : null;
  const reviewNote = typeof input.reviewNote === "string" ? input.reviewNote : "";
  if (!projectSlug || projectSlug !== input.projectSlug || !assetId || !reviewId || !outcome || !reasonCode) {
    return NextResponse.json({ error: "The review decision request is invalid." }, { status: 400, headers: HEADERS });
  }
  const auth = getRmtAdminAuth();
  const db = getRmtAdminFirestore();
  if (!auth || !db) return NextResponse.json({ error: "The review service is not configured." }, { status: 503, headers: HEADERS });

  try {
    const identity = await auth.verifyIdToken(token, true);
    if (identity.email_verified !== true || identity.email?.toLowerCase() !== RMT_ADMIN_EMAIL) {
      return NextResponse.json({ error: "RMT administrator access required." }, { status: 403, headers: HEADERS });
    }
    const reviewReference = db.collection("projectAssignments").doc(projectSlug)
      .collection("assets").doc(assetId).collection("releaseReviews").doc(reviewId);
    const decisionReference = db.collection("creatorReleaseDecisions").doc(reviewId);
    const result = await db.runTransaction(async (transaction) => {
      const [reviewSnapshot, decisionSnapshot] = await Promise.all([
        transaction.get(reviewReference),
        transaction.get(decisionReference)
      ]);
      const review = reviewSnapshot.exists ? parseCreatorReleaseReview(reviewSnapshot.id, reviewSnapshot.data()) : null;
      if (!review) throw new Error("missing");
      const decision = createCreatorReleaseDecision({
        reviewId,
        reviewHash: review.reviewHash,
        projectSlug,
        assetId,
        outcome,
        reasonCode,
        reviewNote,
        reviewerId: identity.uid
      });
      if (decisionSnapshot.exists) {
        const existing = parseCreatorReleaseDecision(decisionSnapshot.id, decisionSnapshot.data());
        if (!existing || existing.decisionHash !== decision.decisionHash) throw new Error("decided");
        return { decision: existing, idempotent: true };
      }
      transaction.create(decisionReference, { ...decision, decidedAt: FieldValue.serverTimestamp() });
      return { decision, idempotent: false };
    });
    return NextResponse.json({
      outcome: result.decision.outcome,
      decisionHash: result.decision.decisionHash,
      contractExecution: result.decision.contractExecution,
      idempotent: result.idempotent
    }, { headers: HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code.startsWith("auth/")) return NextResponse.json({ error: "Administrator sign-in expired." }, { status: 401, headers: HEADERS });
    if (message === "missing") return NextResponse.json({ error: "The immutable release snapshot is unavailable." }, { status: 404, headers: HEADERS });
    if (message === "decided") return NextResponse.json({ error: "This snapshot already has a different immutable decision." }, { status: 409, headers: HEADERS });
    if (/decision is invalid|Preparation-ready/.test(message)) return NextResponse.json({ error: message }, { status: 400, headers: HEADERS });
    return NextResponse.json({ error: "The review decision could not be recorded." }, { status: 503, headers: HEADERS });
  }
}
