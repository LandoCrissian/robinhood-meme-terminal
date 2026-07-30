import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { normalizeProjectSlug } from "../../../../lib/creator-application";
import { parseCreatorAsset } from "../../../../lib/creator-assets";
import { createCreatorMediaManifest } from "../../../../lib/creator-media-manifest";
import {
  createCreatorMediaReceipt,
  parseCreatorMediaReceipt,
  receiptHasVerifiedRetrieval,
  receiptMatchesManifest,
  type CreatorMediaReceipt
} from "../../../../lib/creator-media-receipt";
import { parseProjectAssignment } from "../../../../lib/project-ownership";
import {
  getRmtAdminAuth,
  getRmtAdminFirestore
} from "../../../../lib/server/firebase-admin";
import {
  guardMediaRequest,
  readBoundedJsonRequest
} from "../../../../lib/server/media-request-guard";
import { pinAndVerifyCreatorMetadata } from "../../../../lib/server/pinata-public-file";

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
    namespace: "creator-media-pin",
    limit: 5,
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
    ? body.value as {
      projectSlug?: unknown;
      assetId?: unknown;
      draftRevisionHash?: unknown;
      metadataHash?: unknown;
      manifestHash?: unknown;
    }
    : {};
  const projectSlug = normalizeProjectSlug(input.projectSlug);
  const assetId = typeof input.assetId === "string" && /^[A-Za-z0-9]{20}$/.test(input.assetId)
    ? input.assetId
    : "";
  const validHash = (value: unknown) => typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
  if (
    !projectSlug
    || projectSlug !== input.projectSlug
    || !assetId
    || !validHash(input.draftRevisionHash)
    || !validHash(input.metadataHash)
    || !validHash(input.manifestHash)
  ) {
    return NextResponse.json({ error: "The metadata-storage request is invalid." }, { status: 400, headers: RESPONSE_HEADERS });
  }

  const auth = getRmtAdminAuth();
  const db = getRmtAdminFirestore();
  if (!auth || !db) {
    return NextResponse.json(
      { error: "The trusted metadata-storage service is not configured." },
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
    const receiptsReference = assetReference.collection("mediaReceipts");
    const preflight = await db.runTransaction(async (transaction) => {
      const [assignmentSnapshot, assetSnapshot] = await Promise.all([
        transaction.get(assignmentReference),
        transaction.get(assetReference)
      ]);
      const assignment = assignmentSnapshot.exists
        ? parseProjectAssignment(assignmentSnapshot.data())
        : null;
      const asset = assetSnapshot.exists
        ? parseCreatorAsset(assetSnapshot.id, assetSnapshot.data())
        : null;
      if (!assignment || assignment.ownerId !== identity.uid || !asset) throw new Error("owner");
      if (asset.draftRevisionHash !== input.draftRevisionHash) throw new Error("stale");
      const manifest = createCreatorMediaManifest({ projectSlug, assetId, draft: asset });
      if (
        manifest.metadataHash !== input.metadataHash
        || manifest.manifestHash !== input.manifestHash
      ) throw new Error("manifest");
      if (manifest.mediaIntegrity !== "content_addressed") throw new Error("mutable");
      return manifest;
    });

    const existingSnapshot = await receiptsReference
      .where("manifestHash", "==", preflight.manifestHash)
      .limit(10)
      .get();
    const existing = existingSnapshot.docs
      .map((document) => parseCreatorMediaReceipt(document.id, document.data()))
      .find((receipt): receipt is CreatorMediaReceipt => (
        receipt !== null
        && receiptHasVerifiedRetrieval(receipt)
        && receiptMatchesManifest(receipt, preflight)
      ));
    if (existing) {
      return NextResponse.json({
        receiptId: existing.receiptId,
        metadataCid: existing.metadataCid,
        metadataUri: existing.metadataUri,
        providerRecordVerified: existing.providerRecordVerified,
        retrievalVerified: existing.retrievalVerified,
        retrievalChecks: existing.retrievalChecks,
        contractExecution: existing.contractExecution,
        idempotent: true
      }, { headers: RESPONSE_HEADERS });
    }

    const stored = await pinAndVerifyCreatorMetadata(preflight);
    const receipt = createCreatorMediaReceipt({ manifest: preflight, ...stored });
    const result = await db.runTransaction(async (transaction) => {
      const [assignmentSnapshot, assetSnapshot] = await Promise.all([
        transaction.get(assignmentReference),
        transaction.get(assetReference)
      ]);
      const assignment = assignmentSnapshot.exists
        ? parseProjectAssignment(assignmentSnapshot.data())
        : null;
      const asset = assetSnapshot.exists
        ? parseCreatorAsset(assetSnapshot.id, assetSnapshot.data())
        : null;
      if (!assignment || assignment.ownerId !== identity.uid || !asset) throw new Error("owner");
      if (asset.draftRevisionHash !== preflight.draftRevisionHash) throw new Error("stale");
      const currentManifest = createCreatorMediaManifest({ projectSlug, assetId, draft: asset });
      if (!receiptMatchesManifest(receipt, currentManifest)) throw new Error("manifest");
      const receiptReference = receiptsReference.doc(receipt.receiptId);
      const receiptSnapshot = await transaction.get(receiptReference);
      if (receiptSnapshot.exists) {
        const saved = parseCreatorMediaReceipt(receiptSnapshot.id, receiptSnapshot.data());
        if (
          !saved
          || !receiptHasVerifiedRetrieval(saved)
          || !receiptMatchesManifest(saved, currentManifest)
        ) throw new Error("conflict");
        return { receipt: saved, idempotent: true };
      }
      transaction.create(receiptReference, {
        ...receipt,
        createdAt: FieldValue.serverTimestamp()
      });
      return { receipt, idempotent: false };
    });

    return NextResponse.json({
      receiptId: result.receipt.receiptId,
      metadataCid: result.receipt.metadataCid,
      metadataUri: result.receipt.metadataUri,
      providerRecordVerified: result.receipt.providerRecordVerified,
      retrievalVerified: result.receipt.retrievalVerified,
      retrievalChecks: result.receipt.retrievalChecks,
      contractExecution: result.receipt.contractExecution,
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
    if (message === "stale" || message === "manifest") {
      return NextResponse.json({ error: "The asset changed. Save and review the current revision before pinning metadata." }, { status: 409, headers: RESPONSE_HEADERS });
    }
    if (message === "mutable") {
      return NextResponse.json(
        { error: "Replace every HTTPS media URL with an IPFS reference before pinning marketplace metadata." },
        { status: 409, headers: RESPONSE_HEADERS }
      );
    }
    return NextResponse.json(
      { error: "The exact metadata bytes could not be pinned and independently verified." },
      { status: 503, headers: { ...RESPONSE_HEADERS, "Retry-After": "15" } }
    );
  }
}
