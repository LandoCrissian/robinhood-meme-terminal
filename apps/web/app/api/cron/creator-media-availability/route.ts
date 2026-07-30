import { timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import {
  availabilityStatusFromObservation,
  createCreatorMediaAvailabilityObservation,
  parseCreatorMediaAvailabilityStatus
} from "../../../../lib/creator-media-availability";
import {
  parseCreatorMediaReceipt,
  receiptHasVerifiedRetrieval,
  type CreatorMediaReceipt
} from "../../../../lib/creator-media-receipt";
import { getRmtAdminFirestore } from "../../../../lib/server/firebase-admin";
import { checkCreatorMediaAvailability } from "../../../../lib/server/pinata-public-file";

const HEADERS = { "Cache-Control": "no-store" };
const LEASE_MS = 55_000;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const configured = process.env.CRON_SECRET?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.match(/^Bearer (.{16,256})$/)?.[1] ?? "";
  if (configured.length < 16 || supplied.length !== configured.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(configured));
}

function monitorLimit() {
  const value = Number(process.env.CREATOR_MEDIA_MONITOR_MAX_RECEIPTS ?? "8");
  return Number.isSafeInteger(value) ? Math.min(12, Math.max(1, value)) : 8;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Scheduled monitor authorization required." }, { status: 401, headers: HEADERS });
  }
  if (process.env.CREATOR_MEDIA_MONITOR_ENABLED !== "true") {
    return NextResponse.json({ error: "Creator-media monitoring is not enabled." }, { status: 503, headers: HEADERS });
  }
  const db = getRmtAdminFirestore();
  if (!db) return NextResponse.json({ error: "Creator-media monitoring is not configured." }, { status: 503, headers: HEADERS });
  const now = Date.now();
  const maintenanceReference = db.collection("creatorMediaMaintenance").doc("availability");
  const locked = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(maintenanceReference);
    const leaseUntilMs = Number(snapshot.data()?.leaseUntilMs ?? 0);
    if (Number.isSafeInteger(leaseUntilMs) && leaseUntilMs > now) return false;
    transaction.set(maintenanceReference, {
      leaseUntilMs: now + LEASE_MS,
      startedAtMs: now,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return true;
  });
  if (!locked) {
    return NextResponse.json({ status: "busy", checked: 0 }, { status: 202, headers: HEADERS });
  }
  try {
    const snapshot = await db.collectionGroup("mediaReceipts").limit(monitorLimit()).get();
    const receipts = snapshot.docs
      .map((document) => parseCreatorMediaReceipt(document.id, document.data()))
      .filter((receipt): receipt is CreatorMediaReceipt => (
        receipt !== null && receiptHasVerifiedRetrieval(receipt)
      ));
    const results = await Promise.all(receipts.map(async (receipt) => {
      try {
        const availability = await checkCreatorMediaAvailability(receipt);
        return { receipt, availability };
      } catch (error) {
        const failure = error instanceof Error && /^[a-z0-9_]{3,80}$/.test(error.message)
          ? error.message
          : "monitor_failed";
        return {
          receipt,
          availability: {
            providerState: "unknown" as const,
            gatewayState: "unavailable" as const,
            overallState: "unavailable" as const,
            checksAttempted: 1,
            checksPassed: 0,
            failureCode: failure
          }
        };
      }
    }));
    const batch = db.batch();
    let healthy = 0;
    for (const { receipt, availability } of results) {
      const statusReference = db.collection("creatorMediaAvailability").doc(receipt.receiptId);
      const previousSnapshot = await statusReference.get();
      const previous = previousSnapshot.exists
        ? parseCreatorMediaAvailabilityStatus(previousSnapshot.id, previousSnapshot.data())
        : null;
      const observation = createCreatorMediaAvailabilityObservation({
        schemaVersion: 1,
        receiptId: receipt.receiptId,
        projectSlug: receipt.projectSlug,
        assetId: receipt.assetId,
        metadataCid: receipt.metadataCid,
        ...availability,
        observedAtMs: now,
        providerExecution: "disabled"
      });
      const status = availabilityStatusFromObservation(observation, previous);
      if (status.overallState === "healthy") healthy += 1;
      batch.create(db.collection("creatorMediaAvailabilityObservations").doc(observation.observationId), observation);
      batch.set(statusReference, {
        ...status,
        updatedAt: FieldValue.serverTimestamp()
      });
    }
    batch.set(maintenanceReference, {
      leaseUntilMs: 0,
      completedAtMs: Date.now(),
      checked: results.length,
      healthy,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    await batch.commit();
    return NextResponse.json({
      status: "complete",
      checked: results.length,
      healthy,
      attention: results.length - healthy,
      providerExecution: "disabled"
    }, { headers: HEADERS });
  } catch {
    await maintenanceReference.set({
      leaseUntilMs: 0,
      failedAtMs: Date.now(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => undefined);
    return NextResponse.json({ error: "The creator-media monitor did not complete." }, { status: 503, headers: HEADERS });
  }
}
