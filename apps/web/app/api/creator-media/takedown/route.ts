import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { normalizeProjectSlug } from "../../../../lib/creator-application";
import { parseCreatorMediaReceipt } from "../../../../lib/creator-media-receipt";
import {
  CREATOR_MEDIA_TAKEDOWN_REASONS,
  createCreatorMediaTakedownRequest,
  parseCreatorMediaTakedownRequest,
  type CreatorMediaTakedownReason
} from "../../../../lib/creator-media-takedown";
import { parseProjectAssignment } from "../../../../lib/project-ownership";
import {
  getRmtAdminAuth,
  getRmtAdminFirestore
} from "../../../../lib/server/firebase-admin";
import {
  guardMediaRequest,
  readBoundedJsonRequest
} from "../../../../lib/server/media-request-guard";

const HEADERS = { "Cache-Control": "no-store" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function tokenFrom(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~-]{100,4096})$/)?.[1] ?? "";
}

export async function POST(request: Request) {
  const guard = guardMediaRequest(request, {
    namespace: "creator-media-takedown",
    limit: 5,
    windowMs: 60_000
  });
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status, headers: HEADERS });
  const token = tokenFrom(request);
  if (!token) return NextResponse.json({ error: "Verified creator sign-in required." }, { status: 401, headers: HEADERS });
  const body = await readBoundedJsonRequest(request, 4_096);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: HEADERS });
  const input = body.value && typeof body.value === "object" && !Array.isArray(body.value)
    ? body.value as Record<string, unknown>
    : {};
  const projectSlug = normalizeProjectSlug(input.projectSlug);
  const assetId = typeof input.assetId === "string" && /^[A-Za-z0-9]{20}$/.test(input.assetId) ? input.assetId : "";
  const receiptId = typeof input.receiptId === "string" && /^[0-9a-f]{64}$/.test(input.receiptId) ? input.receiptId : "";
  const reasonCode = typeof input.reasonCode === "string" && CREATOR_MEDIA_TAKEDOWN_REASONS.includes(input.reasonCode as never)
    ? input.reasonCode as CreatorMediaTakedownReason
    : null;
  const requestNote = typeof input.requestNote === "string" ? input.requestNote : "";
  if (!projectSlug || projectSlug !== input.projectSlug || !assetId || !receiptId || !reasonCode) {
    return NextResponse.json({ error: "The provider-takedown request is invalid." }, { status: 400, headers: HEADERS });
  }
  const auth = getRmtAdminAuth();
  const db = getRmtAdminFirestore();
  if (!auth || !db) {
    return NextResponse.json({ error: "The trusted provider-lifecycle service is not configured." }, { status: 503, headers: HEADERS });
  }
  try {
    const identity = await auth.verifyIdToken(token, true);
    if (identity.email_verified !== true) {
      return NextResponse.json({ error: "A verified creator profile is required." }, { status: 403, headers: HEADERS });
    }
    const assignmentReference = db.collection("projectAssignments").doc(projectSlug);
    const receiptReference = assignmentReference.collection("assets").doc(assetId)
      .collection("mediaReceipts").doc(receiptId);
    const requestReference = db.collection("creatorMediaTakedownRequests").doc(receiptId);
    const result = await db.runTransaction(async (transaction) => {
      const [assignmentSnapshot, receiptSnapshot, requestSnapshot] = await Promise.all([
        transaction.get(assignmentReference),
        transaction.get(receiptReference),
        transaction.get(requestReference)
      ]);
      const assignment = assignmentSnapshot.exists
        ? parseProjectAssignment(assignmentSnapshot.data())
        : null;
      const receipt = receiptSnapshot.exists
        ? parseCreatorMediaReceipt(receiptSnapshot.id, receiptSnapshot.data())
        : null;
      if (!assignment || assignment.ownerId !== identity.uid || !receipt) throw new Error("owner");
      const takedown = createCreatorMediaTakedownRequest({
        projectSlug,
        assetId,
        receiptId,
        metadataCid: receipt.metadataCid,
        providerFileId: receipt.providerFileId,
        reasonCode,
        requestNote,
        requestedBy: identity.uid
      });
      if (requestSnapshot.exists) {
        const existing = parseCreatorMediaTakedownRequest(requestSnapshot.id, requestSnapshot.data());
        if (!existing || existing.requestHash !== takedown.requestHash) throw new Error("requested");
        return { request: existing, idempotent: true };
      }
      transaction.create(requestReference, {
        ...takedown,
        createdAt: FieldValue.serverTimestamp()
      });
      return { request: takedown, idempotent: false };
    });
    return NextResponse.json({
      requestId: result.request.requestId,
      requestHash: result.request.requestHash,
      providerExecution: result.request.providerExecution,
      contentErasureGuarantee: result.request.contentErasureGuarantee,
      idempotent: result.idempotent
    }, { headers: HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code.startsWith("auth/")) {
      return NextResponse.json({ error: "Creator sign-in expired. Sign in again." }, { status: 401, headers: HEADERS });
    }
    if (message === "owner") {
      return NextResponse.json({ error: "This profile cannot request changes to that provider record." }, { status: 403, headers: HEADERS });
    }
    if (message === "requested") {
      return NextResponse.json({ error: "That receipt already has a different immutable takedown request." }, { status: 409, headers: HEADERS });
    }
    if (/takedown note|takedown request is invalid/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400, headers: HEADERS });
    }
    return NextResponse.json({ error: "The provider-takedown request could not be recorded." }, { status: 503, headers: HEADERS });
  }
}
