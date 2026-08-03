import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import {
  decodeCreatorConsentWithdrawalPacket,
  parseCreatorConsentInvitationRecord,
  parseCreatorConsentPublicStatus
} from "../../../../lib/creator-consent";
import {
  CreatorConsentWithdrawalError,
  evaluateCreatorConsentWithdrawal
} from "../../../../lib/server/creator-consent-withdrawal";
import { getRmtAdminFirestore } from "../../../../lib/server/firebase-admin";
import {
  guardMediaRequest,
  readBoundedJsonRequest
} from "../../../../lib/server/media-request-guard";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };
const MAX_REQUEST_BYTES = 12_000;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorStatus(error: CreatorConsentWithdrawalError) {
  if (error.code === "missing") return 404;
  if (error.code === "wrong_signer") return 403;
  if (error.code === "not_accepted" || error.code === "conflict") return 409;
  return 400;
}

export async function POST(request: Request) {
  const guard = guardMediaRequest(request, {
    namespace: "creator-consent-withdrawal",
    limit: 12,
    windowMs: 60_000
  });
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 429 ? "Too many withdrawal attempts. Please wait and try again." : guard.error },
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
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.status, headers: RESPONSE_HEADERS });
  }
  const withdrawalCode = body.value && typeof body.value === "object" && !Array.isArray(body.value)
    ? (body.value as { withdrawalCode?: unknown }).withdrawalCode
    : null;
  if (typeof withdrawalCode !== "string") {
    return NextResponse.json(
      { error: "A signed consent withdrawal is required." },
      { status: 400, headers: RESPONSE_HEADERS }
    );
  }
  const packet = decodeCreatorConsentWithdrawalPacket(withdrawalCode);
  if (!packet) {
    return NextResponse.json(
      { error: "The signed consent withdrawal is malformed." },
      { status: 400, headers: RESPONSE_HEADERS }
    );
  }

  const db = getRmtAdminFirestore();
  if (!db) {
    return NextResponse.json(
      { error: "The trusted consent withdrawal service is not configured." },
      { status: 503, headers: { ...RESPONSE_HEADERS, "Retry-After": "60" } }
    );
  }

  const invitationId = packet.withdrawal.invitationDigest.slice(2);
  const statusReference = db.collection("creatorConsentStatuses").doc(invitationId);
  try {
    const result = await db.runTransaction(async (transaction) => {
      const statusSnapshot = await transaction.get(statusReference);
      const publicStatus = statusSnapshot.exists
        ? parseCreatorConsentPublicStatus(statusSnapshot.id, statusSnapshot.data())
        : null;
      if (!publicStatus) {
        throw new CreatorConsentWithdrawalError("missing", "The consent invitation is unavailable.");
      }
      const invitationReference = db
        .collection("projectAssignments")
        .doc(publicStatus.projectSlug)
        .collection("assets")
        .doc(publicStatus.assetId)
        .collection("consentInvitations")
        .doc(invitationId);
      const invitationSnapshot = await transaction.get(invitationReference);
      const invitation = invitationSnapshot.exists
        ? parseCreatorConsentInvitationRecord(invitationSnapshot.id, invitationSnapshot.data())
        : null;
      const evaluated = await evaluateCreatorConsentWithdrawal({
        invitation,
        nowSeconds: Timestamp.now().seconds,
        publicStatus,
        withdrawal: packet.withdrawal
      });
      if (!evaluated.idempotent) {
        transaction.update(invitationReference, {
          status: "withdrawn",
          withdrawalSignature: packet.withdrawal.signature,
          withdrawalSignedAt: packet.withdrawal.withdrawnAt,
          withdrawalReceivedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
        transaction.update(statusReference, {
          status: "withdrawn",
          updatedAt: FieldValue.serverTimestamp()
        });
      }
      return evaluated;
    });
    return NextResponse.json({
      invitationDigest: packet.withdrawal.invitationDigest,
      status: result.status,
      idempotent: result.idempotent,
      recorded: true
    }, { headers: RESPONSE_HEADERS });
  } catch (error) {
    if (error instanceof CreatorConsentWithdrawalError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: errorStatus(error), headers: RESPONSE_HEADERS }
      );
    }
    return NextResponse.json(
      { error: "The consent withdrawal could not be recorded. Nothing executable changed." },
      { status: 503, headers: { ...RESPONSE_HEADERS, "Retry-After": "10" } }
    );
  }
}
