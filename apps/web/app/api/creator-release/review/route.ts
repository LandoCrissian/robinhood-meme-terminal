import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { normalizeProjectSlug } from "../../../../lib/creator-application";
import { parseCreatorAsset } from "../../../../lib/creator-assets";
import { parseCreatorConsentInvitationRecord } from "../../../../lib/creator-consent";
import { RMT_MARKETPLACE_SIMULATION_POLICY } from "../../../../lib/creator-economics";
import {
  createCreatorReleaseReview,
  parseCreatorReleaseReview
} from "../../../../lib/creator-release-review";
import { parseProjectAssignment } from "../../../../lib/project-ownership";
import {
  getRmtAdminAuth,
  getRmtAdminFirestore
} from "../../../../lib/server/firebase-admin";
import {
  guardMediaRequest,
  readBoundedJsonRequest
} from "../../../../lib/server/media-request-guard";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };
const MAX_REQUEST_BYTES = 2_048;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bearerToken(request: Request) {
  const match = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~-]{100,4096})$/);
  return match?.[1] ?? "";
}

export async function POST(request: Request) {
  const guard = guardMediaRequest(request, {
    namespace: "creator-release-review",
    limit: 10,
    windowMs: 60_000
  });
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.error },
      {
        status: guard.status,
        headers: {
          ...RESPONSE_HEADERS,
          ...(guard.retryAfterSeconds ? { "Retry-After": String(guard.retryAfterSeconds) } : {})
        }
      }
    );
  }

  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Verified creator sign-in required." }, { status: 401, headers: RESPONSE_HEADERS });
  }
  const body = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: RESPONSE_HEADERS });
  const input = body.value && typeof body.value === "object" && !Array.isArray(body.value)
    ? body.value as { projectSlug?: unknown; assetId?: unknown; draftRevisionHash?: unknown }
    : {};
  const projectSlug = normalizeProjectSlug(input.projectSlug);
  const assetId = typeof input.assetId === "string" && /^[A-Za-z0-9]{20}$/.test(input.assetId)
    ? input.assetId
    : "";
  const draftRevisionHash = typeof input.draftRevisionHash === "string"
    && /^0x[0-9a-f]{64}$/.test(input.draftRevisionHash)
    ? input.draftRevisionHash
    : "";
  if (!projectSlug || projectSlug !== input.projectSlug || !assetId || !draftRevisionHash) {
    return NextResponse.json({ error: "The release-review request is invalid." }, { status: 400, headers: RESPONSE_HEADERS });
  }

  const auth = getRmtAdminAuth();
  const db = getRmtAdminFirestore();
  if (!auth || !db) {
    return NextResponse.json(
      { error: "The trusted release-review service is not configured." },
      { status: 503, headers: { ...RESPONSE_HEADERS, "Retry-After": "60" } }
    );
  }

  try {
    const identity = await auth.verifyIdToken(token, true);
    if (identity.email_verified !== true) {
      return NextResponse.json({ error: "A verified creator profile is required." }, { status: 403, headers: RESPONSE_HEADERS });
    }
    const assignmentReference = db.collection("projectAssignments").doc(projectSlug);
    const assetReference = assignmentReference.collection("assets").doc(assetId);
    const acceptedQuery = assetReference
      .collection("consentInvitations")
      .where("draftRevisionHash", "==", draftRevisionHash)
      .limit(50);

    const result = await db.runTransaction(async (transaction) => {
      const [assignmentSnapshot, assetSnapshot, consentSnapshot] = await Promise.all([
        transaction.get(assignmentReference),
        transaction.get(assetReference),
        transaction.get(acceptedQuery)
      ]);
      const assignment = assignmentSnapshot.exists
        ? parseProjectAssignment(assignmentSnapshot.data())
        : null;
      const asset = assetSnapshot.exists
        ? parseCreatorAsset(assetSnapshot.id, assetSnapshot.data())
        : null;
      if (!assignment || assignment.ownerId !== identity.uid || !asset) {
        throw new Error("owner");
      }
      if (asset.draftRevisionHash !== draftRevisionHash) {
        throw new Error("stale");
      }
      const consentRecords = consentSnapshot.docs
        .map((document) => parseCreatorConsentInvitationRecord(document.id, document.data()))
        .filter((record) => record !== null);
      const review = createCreatorReleaseReview({
        asset,
        consentRecords,
        economicsPolicy: RMT_MARKETPLACE_SIMULATION_POLICY,
        preparedBy: identity.uid
      });
      const reviewReference = assetReference.collection("releaseReviews").doc(review.reviewId);
      const existingSnapshot = await transaction.get(reviewReference);
      if (existingSnapshot.exists) {
        const existing = parseCreatorReleaseReview(existingSnapshot.id, existingSnapshot.data());
        if (!existing || existing.reviewHash !== review.reviewHash) throw new Error("conflict");
        return { review: existing, idempotent: true };
      }
      transaction.create(reviewReference, {
        ...review,
        createdAt: FieldValue.serverTimestamp()
      });
      return { review, idempotent: false };
    });

    return NextResponse.json({
      reviewId: result.review.reviewId,
      reviewHash: result.review.reviewHash,
      status: result.review.status,
      economicsMode: result.review.economicsMode,
      contractExecution: result.review.contractExecution,
      idempotent: result.idempotent
    }, { headers: RESPONSE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code.startsWith("auth/")) {
      return NextResponse.json({ error: "Creator sign-in expired. Sign in again." }, { status: 401, headers: RESPONSE_HEADERS });
    }
    if (message === "owner") {
      return NextResponse.json({ error: "This profile is not assigned to manage the project." }, { status: 403, headers: RESPONSE_HEADERS });
    }
    if (message === "stale") {
      return NextResponse.json({ error: "The asset changed. Review the current revision before preparing a snapshot." }, { status: 409, headers: RESPONSE_HEADERS });
    }
    if (/Accepted consent is missing/.test(message)) {
      return NextResponse.json({ error: message }, { status: 409, headers: RESPONSE_HEADERS });
    }
    return NextResponse.json(
      { error: "The immutable release-review snapshot could not be prepared." },
      { status: 503, headers: { ...RESPONSE_HEADERS, "Retry-After": "10" } }
    );
  }
}
