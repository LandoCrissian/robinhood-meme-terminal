import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { RMT_ADMIN_EMAIL } from "../../../../../../lib/creator-application";
import {
  CREATOR_MEDIA_TAKEDOWN_OUTCOMES,
  createCreatorMediaTakedownDecision,
  parseCreatorMediaTakedownDecision,
  parseCreatorMediaTakedownRequest,
  type CreatorMediaTakedownOutcome
} from "../../../../../../lib/creator-media-takedown";
import {
  getRmtAdminAuth,
  getRmtAdminFirestore
} from "../../../../../../lib/server/firebase-admin";
import {
  guardMediaRequest,
  readBoundedJsonRequest
} from "../../../../../../lib/server/media-request-guard";

const HEADERS = { "Cache-Control": "no-store" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function tokenFrom(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~-]{100,4096})$/)?.[1] ?? "";
}

export async function POST(request: Request) {
  const guard = guardMediaRequest(request, {
    namespace: "creator-media-takedown-decision",
    limit: 20,
    windowMs: 60_000
  });
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status, headers: HEADERS });
  const token = tokenFrom(request);
  if (!token) return NextResponse.json({ error: "RMT administrator sign-in required." }, { status: 401, headers: HEADERS });
  const body = await readBoundedJsonRequest(request, 4_096);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: HEADERS });
  const input = body.value && typeof body.value === "object" && !Array.isArray(body.value)
    ? body.value as Record<string, unknown>
    : {};
  const requestId = typeof input.requestId === "string" && /^[0-9a-f]{64}$/.test(input.requestId) ? input.requestId : "";
  const outcome = typeof input.outcome === "string" && CREATOR_MEDIA_TAKEDOWN_OUTCOMES.includes(input.outcome as never)
    ? input.outcome as CreatorMediaTakedownOutcome
    : null;
  const reviewNote = typeof input.reviewNote === "string" ? input.reviewNote : "";
  if (!requestId || !outcome) {
    return NextResponse.json({ error: "The takedown decision request is invalid." }, { status: 400, headers: HEADERS });
  }
  const auth = getRmtAdminAuth();
  const db = getRmtAdminFirestore();
  if (!auth || !db) return NextResponse.json({ error: "The provider-lifecycle service is not configured." }, { status: 503, headers: HEADERS });
  try {
    const identity = await auth.verifyIdToken(token, true);
    if (identity.email_verified !== true || identity.email?.toLowerCase() !== RMT_ADMIN_EMAIL) {
      return NextResponse.json({ error: "RMT administrator access required." }, { status: 403, headers: HEADERS });
    }
    const requestReference = db.collection("creatorMediaTakedownRequests").doc(requestId);
    const decisionReference = db.collection("creatorMediaTakedownDecisions").doc(requestId);
    const result = await db.runTransaction(async (transaction) => {
      const [requestSnapshot, decisionSnapshot] = await Promise.all([
        transaction.get(requestReference),
        transaction.get(decisionReference)
      ]);
      const takedown = requestSnapshot.exists
        ? parseCreatorMediaTakedownRequest(requestSnapshot.id, requestSnapshot.data())
        : null;
      if (!takedown) throw new Error("missing");
      const decision = createCreatorMediaTakedownDecision({
        request: takedown,
        outcome,
        reviewNote,
        reviewedBy: identity.uid
      });
      if (decisionSnapshot.exists) {
        const existing = parseCreatorMediaTakedownDecision(decisionSnapshot.id, decisionSnapshot.data());
        if (!existing || existing.decisionHash !== decision.decisionHash) throw new Error("decided");
        return { decision: existing, idempotent: true };
      }
      transaction.create(decisionReference, {
        ...decision,
        decidedAt: FieldValue.serverTimestamp()
      });
      return { decision, idempotent: false };
    });
    return NextResponse.json({
      decisionId: result.decision.decisionId,
      decisionHash: result.decision.decisionHash,
      outcome: result.decision.outcome,
      providerExecution: result.decision.providerExecution,
      idempotent: result.idempotent
    }, { headers: HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code.startsWith("auth/")) {
      return NextResponse.json({ error: "Administrator sign-in expired." }, { status: 401, headers: HEADERS });
    }
    if (message === "missing") {
      return NextResponse.json({ error: "The immutable takedown request is unavailable." }, { status: 404, headers: HEADERS });
    }
    if (message === "decided") {
      return NextResponse.json({ error: "That request already has a different immutable decision." }, { status: 409, headers: HEADERS });
    }
    if (/takedown note|takedown decision is invalid/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400, headers: HEADERS });
    }
    return NextResponse.json({ error: "The takedown decision could not be recorded." }, { status: 503, headers: HEADERS });
  }
}
