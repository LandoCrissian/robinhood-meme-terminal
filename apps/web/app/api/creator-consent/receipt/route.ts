import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import {
  decodeCreatorConsentResponsePacket,
  parseCreatorConsentInvitationRecord,
  parseCreatorConsentPublicStatus
} from "../../../../lib/creator-consent";
import { parseCreatorAsset } from "../../../../lib/creator-assets";
import {
  CreatorConsentReceiptError,
  evaluateCreatorConsentReceipt
} from "../../../../lib/server/creator-consent-receipt";
import { getRmtAdminFirestore } from "../../../../lib/server/firebase-admin";
import {
  guardMediaRequest,
  readBoundedJsonRequest
} from "../../../../lib/server/media-request-guard";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };
const MAX_REQUEST_BYTES = 12_000;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorStatus(error: CreatorConsentReceiptError) {
  if (error.code === "missing") return 404;
  if (error.code === "wrong_signer") return 403;
  if (["revoked", "expired", "stale_revision", "conflict"].includes(error.code)) return 409;
  return 400;
}

export async function POST(request: Request) {
  const guard = guardMediaRequest(request, {
    namespace: "creator-consent-receipt",
    limit: 20,
    windowMs: 60_000
  });
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 429 ? "Too many consent responses. Please wait and try again." : guard.error },
      {
        status: guard.status,
        headers: {
          ...RESPONSE_HEADERS,
          ...(guard.retryAfterSeconds ? { "Retry-After": String(guard.retryAfterSeconds) } : {})
        }
      }
    );
  }

  const body = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: RESPONSE_HEADERS });
  const responseCode = body.value && typeof body.value === "object" && !Array.isArray(body.value)
    ? (body.value as { responseCode?: unknown }).responseCode
    : null;
  if (typeof responseCode !== "string") {
    return NextResponse.json({ error: "A signed consent response is required." }, { status: 400, headers: RESPONSE_HEADERS });
  }
  const packet = decodeCreatorConsentResponsePacket(responseCode);
  if (!packet) {
    return NextResponse.json({ error: "The signed consent response is malformed." }, { status: 400, headers: RESPONSE_HEADERS });
  }

  const db = getRmtAdminFirestore();
  if (!db) {
    return NextResponse.json(
      { error: "The trusted consent receipt service is not configured." },
      { status: 503, headers: { ...RESPONSE_HEADERS, "Retry-After": "60" } }
    );
  }

  const invitationId = packet.response.invitationDigest.slice(2);
  const statusReference = db.collection("creatorConsentStatuses").doc(invitationId);
  try {
    const result = await db.runTransaction(async (transaction) => {
      const statusSnapshot = await transaction.get(statusReference);
      const publicStatus = statusSnapshot.exists
        ? parseCreatorConsentPublicStatus(statusSnapshot.id, statusSnapshot.data())
        : null;
      if (!publicStatus) {
        throw new CreatorConsentReceiptError("missing", "The consent invitation is unavailable.");
      }
      const assetReference = db
        .collection("projectAssignments")
        .doc(publicStatus.projectSlug)
        .collection("assets")
        .doc(publicStatus.assetId);
      const invitationReference = assetReference
        .collection("consentInvitations")
        .doc(invitationId);
      const [assetSnapshot, invitationSnapshot] = await Promise.all([
        transaction.get(assetReference),
        transaction.get(invitationReference)
      ]);
      const asset = assetSnapshot.exists
        ? parseCreatorAsset(assetSnapshot.id, assetSnapshot.data())
        : null;
      const invitation = invitationSnapshot.exists
        ? parseCreatorConsentInvitationRecord(invitationSnapshot.id, invitationSnapshot.data())
        : null;
      const nowSeconds = Timestamp.now().seconds;
      const evaluated = await evaluateCreatorConsentReceipt({
        asset,
        invitation,
        nowSeconds,
        publicStatus,
        response: packet.response
      });
      if (!evaluated.idempotent) {
        transaction.update(invitationReference, {
          status: evaluated.status,
          responseAction: packet.response.action,
          responseSignature: packet.response.signature,
          respondedAt: packet.response.respondedAt,
          signerWallet: packet.response.collaboratorWallet,
          receivedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
        transaction.update(statusReference, {
          status: evaluated.status,
          updatedAt: FieldValue.serverTimestamp()
        });
      }
      return evaluated;
    });
    return NextResponse.json({
      invitationDigest: packet.response.invitationDigest,
      status: result.status,
      idempotent: result.idempotent,
      recorded: true
    }, { headers: RESPONSE_HEADERS });
  } catch (error) {
    if (error instanceof CreatorConsentReceiptError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: errorStatus(error), headers: RESPONSE_HEADERS }
      );
    }
    return NextResponse.json(
      { error: "The consent receipt could not be recorded. The signed response remains available to copy." },
      { status: 503, headers: { ...RESPONSE_HEADERS, "Retry-After": "10" } }
    );
  }
}
