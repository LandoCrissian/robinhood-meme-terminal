import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { getAddress, isAddress, type Address } from "viem";
import {
  normalizeCrossChainFundingSession,
  type CrossChainFundingSession
} from "../vnext/cross-chain-funding";
import { getRmtAdminFirestore } from "./firebase-admin";

const OWNER_COLLECTION = "vnextCrossChainFundingOwners";
const SESSION_COLLECTION = "sessions";
const MAX_SERVER_SESSIONS = 24;

const IMMUTABLE_SESSION_FIELDS = [
  "schemaVersion",
  "sessionId",
  "provider",
  "wallet",
  "sourceChainId",
  "destinationChainId",
  "sourceToken",
  "destinationToken",
  "sourceSpokePool",
  "destinationSpokePool",
  "inputAmountAtomic",
  "expectedOutputAtomic",
  "protectedOutputAtomic",
  "quoteTimestamp",
  "refundChainId",
  "refundToken",
  "refundRecipient",
  "fillDeadline",
  "exclusiveRelayer",
  "exclusivityParameter",
  "message",
  "sourceSpokePoolRuntimeHash",
  "sourceSpokePoolImplementation",
  "sourceSpokePoolImplementationRuntimeHash",
  "destinationSpokePoolRuntimeHash",
  "destinationSpokePoolImplementation",
  "destinationSpokePoolImplementationRuntimeHash",
  "quoteId",
  "quoteExpiresAtMs",
  "approvalSpender",
  "exactApprovalAmountAtomic",
  "totalFeeAtomic",
  "totalFeeAsset",
  "originGasAtomic",
  "expectedCompletionSeconds",
  "settlementMode",
  "refundOnOrigin",
  "partialFillsAllowed",
  "depositCalldataHash",
  "depositValueAtomic",
  "createdAtMs"
] as const satisfies readonly (keyof CrossChainFundingSession)[];

const ANCHORED_LIFECYCLE_FIELDS = [
  "sourceTxHash",
  "depositId",
  "destinationTxHash",
  "destinationOutputAtomic",
  "refundTxHash"
] as const satisfies readonly (keyof CrossChainFundingSession)[];

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function assertCrossChainFundingSessionWrite(
  previousValue: CrossChainFundingSession,
  nextValue: CrossChainFundingSession
) {
  const previous = serializableCrossChainFundingSession(previousValue);
  const next = serializableCrossChainFundingSession(nextValue);
  if (previous.updatedAtMs > next.updatedAtMs) throw new Error("RMT rejected an out-of-order funding session write.");
  if (previous.updatedAtMs === next.updatedAtMs) {
    if (!sameValue(previous, next)) throw new Error("RMT rejected a conflicting funding session write.");
    return next;
  }
  if (IMMUTABLE_SESSION_FIELDS.some((field) => !sameValue(previous[field], next[field]))) {
    throw new Error("RMT rejected a rewrite of verified funding intent data.");
  }
  if (ANCHORED_LIFECYCLE_FIELDS.some((field) => previous[field] !== null && previous[field] !== next[field])) {
    throw new Error("RMT rejected a rewrite of anchored funding lifecycle evidence.");
  }
  if (next.events.length <= previous.events.length
    || previous.events.some((event, index) => !sameValue(event, next.events[index]))) {
    throw new Error("RMT rejected a funding lifecycle history rewrite.");
  }
  return next;
}

export function crossChainFundingOwnerKey(wallet: string) {
  if (!isAddress(wallet, { strict: false })) throw new Error("RMT rejected an invalid funding owner.");
  return createHash("sha256").update(getAddress(wallet).toLowerCase()).digest("hex");
}

export function crossChainFundingStoragePath(wallet: string, sessionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error("RMT rejected an invalid funding session path.");
  return `${OWNER_COLLECTION}/${crossChainFundingOwnerKey(wallet)}/${SESSION_COLLECTION}/${sessionId}`;
}

export function serializableCrossChainFundingSession(session: CrossChainFundingSession) {
  const normalized = normalizeCrossChainFundingSession(session);
  if (!normalized) throw new Error("RMT rejected an invalid funding session document.");
  return JSON.parse(JSON.stringify(normalized)) as CrossChainFundingSession;
}

function database(value?: Firestore | null) {
  const resolved = value === undefined ? getRmtAdminFirestore() : value;
  if (!resolved) throw new Error("Cross-chain funding persistence is not configured.");
  return resolved;
}

function sessionReference(db: Firestore, wallet: Address, sessionId: string) {
  return db.doc(crossChainFundingStoragePath(wallet, sessionId));
}

export async function saveCrossChainFundingSession(session: CrossChainFundingSession, provided?: Firestore | null) {
  const value = serializableCrossChainFundingSession(session);
  const db = database(provided);
  const reference = sessionReference(db, value.wallet, value.sessionId);
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    if (current.exists) {
      const previous = normalizeCrossChainFundingSession(current.data());
      if (!previous || previous.wallet !== value.wallet) throw new Error("RMT rejected a corrupt funding session document.");
      assertCrossChainFundingSessionWrite(previous, value);
    }
    transaction.set(reference, value);
  });
  return value;
}

export async function readCrossChainFundingSession(wallet: Address, sessionId: string, provided?: Firestore | null) {
  const db = database(provided);
  const snapshot = await sessionReference(db, getAddress(wallet), sessionId).get();
  if (!snapshot.exists) return null;
  const session = normalizeCrossChainFundingSession(snapshot.data());
  if (!session || session.wallet !== getAddress(wallet)) throw new Error("RMT rejected a corrupt funding session document.");
  return session;
}

export async function listCrossChainFundingSessions(wallet: Address, provided?: Firestore | null) {
  const db = database(provided);
  const owner = crossChainFundingOwnerKey(wallet);
  const snapshot = await db.collection(OWNER_COLLECTION).doc(owner).collection(SESSION_COLLECTION)
    .orderBy("updatedAtMs", "desc")
    .limit(MAX_SERVER_SESSIONS)
    .get();
  return snapshot.docs.map((document) => normalizeCrossChainFundingSession(document.data())).filter(
    (session): session is CrossChainFundingSession => Boolean(session && session.wallet === getAddress(wallet))
  );
}
