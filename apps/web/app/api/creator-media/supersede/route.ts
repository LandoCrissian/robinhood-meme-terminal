import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { normalizeProjectSlug } from "../../../../lib/creator-application";
import { parseCreatorAsset } from "../../../../lib/creator-assets";
import { parseCreatorMediaReceipt } from "../../../../lib/creator-media-receipt";
import {
  createCreatorMediaSupersession,
  parseCreatorMediaSupersession
} from "../../../../lib/creator-media-supersession";
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

function bearerToken(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~-]{100,4096})$/)?.[1] ?? "";
}

export async function POST(request: Request) {
  const guard = guardMediaRequest(request, {
    namespace: "creator-media-supersede",
    limit: 10,
    windowMs: 60_000
  });
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status, headers: HEADERS });
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Verified creator sign-in required." }, { status: 401, headers: HEADERS });
  const body = await readBoundedJsonRequest(request, 2_048);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: HEADERS });
  const input = body.value && typeof body.value === "object" && !Array.isArray(body.value)
    ? body.value as Record<string, unknown>
    : {};
  const projectSlug = normalizeProjectSlug(input.projectSlug);
  const assetId = typeof input.assetId === "string" && /^[A-Za-z0-9]{20}$/.test(input.assetId)
    ? input.assetId
    : "";
  const receiptId = typeof input.receiptId === "string" && /^[0-9a-f]{64}$/.test(input.receiptId)
    ? input.receiptId
    : "";
  if (!projectSlug || projectSlug !== input.projectSlug || !assetId || !receiptId) {
    return NextResponse.json({ error: "The metadata-correction request is invalid." }, { status: 400, headers: HEADERS });
  }
  const auth = getRmtAdminAuth();
  const db = getRmtAdminFirestore();
  if (!auth || !db) {
    return NextResponse.json({ error: "The trusted metadata-correction service is not configured." }, { status: 503, headers: HEADERS });
  }
  try {
    const identity = await auth.verifyIdToken(token, true);
    if (identity.email_verified !== true) {
      return NextResponse.json({ error: "A verified creator profile is required." }, { status: 403, headers: HEADERS });
    }
    const assignmentReference = db.collection("projectAssignments").doc(projectSlug);
    const assetReference = assignmentReference.collection("assets").doc(assetId);
    const receiptReference = assetReference.collection("mediaReceipts").doc(receiptId);
    const supersessionReference = assetReference.collection("mediaReceiptSupersessions").doc(receiptId);
    const result = await db.runTransaction(async (transaction) => {
      const [assignmentSnapshot, assetSnapshot, receiptSnapshot, supersessionSnapshot] = await Promise.all([
        transaction.get(assignmentReference),
        transaction.get(assetReference),
        transaction.get(receiptReference),
        transaction.get(supersessionReference)
      ]);
      const assignment = assignmentSnapshot.exists
        ? parseProjectAssignment(assignmentSnapshot.data())
        : null;
      const asset = assetSnapshot.exists
        ? parseCreatorAsset(assetSnapshot.id, assetSnapshot.data())
        : null;
      const receipt = receiptSnapshot.exists
        ? parseCreatorMediaReceipt(receiptSnapshot.id, receiptSnapshot.data())
        : null;
      if (!assignment || assignment.ownerId !== identity.uid || !asset || !receipt) throw new Error("owner");
      if (receipt.projectSlug !== projectSlug || receipt.assetId !== assetId) throw new Error("receipt");
      if (receipt.draftRevisionHash === asset.draftRevisionHash) throw new Error("current");
      const supersession = createCreatorMediaSupersession({
        projectSlug,
        assetId,
        receiptId,
        replacedDraftRevisionHash: receipt.draftRevisionHash,
        replacementDraftRevisionHash: asset.draftRevisionHash,
        recordedBy: identity.uid
      });
      if (supersessionSnapshot.exists) {
        const existing = parseCreatorMediaSupersession(
          supersessionSnapshot.id,
          supersessionSnapshot.data()
        );
        if (!existing || existing.supersessionHash !== supersession.supersessionHash) {
          throw new Error("conflict");
        }
        return { supersession: existing, idempotent: true };
      }
      transaction.create(supersessionReference, {
        ...supersession,
        createdAt: FieldValue.serverTimestamp()
      });
      return { supersession, idempotent: false };
    });
    return NextResponse.json({
      supersessionId: result.supersession.supersessionId,
      supersessionHash: result.supersession.supersessionHash,
      contractExecution: result.supersession.contractExecution,
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
    if (message === "owner" || message === "receipt") {
      return NextResponse.json({ error: "This profile cannot correct that metadata receipt." }, { status: 403, headers: HEADERS });
    }
    if (message === "current") {
      return NextResponse.json(
        { error: "Save the corrected asset revision before marking its previous metadata receipt superseded." },
        { status: 409, headers: HEADERS }
      );
    }
    if (message === "conflict") {
      return NextResponse.json({ error: "That receipt already has a different correction record." }, { status: 409, headers: HEADERS });
    }
    return NextResponse.json({ error: "The metadata correction could not be recorded." }, { status: 503, headers: HEADERS });
  }
}
