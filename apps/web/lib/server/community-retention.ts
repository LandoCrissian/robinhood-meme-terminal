import { FieldValue, Timestamp, type Firestore, type Query } from "firebase-admin/firestore";

const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60_000;
const LOCAL_ATTEMPT_INTERVAL_MS = 30 * 60_000;
const DELETE_LIMIT_PER_COLLECTION = 20;
const TOP_LEVEL_RETENTION_COLLECTIONS = [
  "communityReports",
  "communityFeedback",
  "communityFeedbackStatus",
  "communityModerationAudit",
  "communityFeedbackAudit",
  "communityActors",
  "communityPresence",
  "communityRateLimits"
] as const;

let nextLocalAttemptAt = 0;

async function acquireRetentionLease(db: Firestore, now: number) {
  const lease = db.collection("communityMaintenance").doc("retention");
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lease);
    const nextRunAt = snapshot.data()?.nextRunAt;
    if (nextRunAt instanceof Timestamp && nextRunAt.toMillis() > now) return false;
    transaction.set(lease, {
      schemaVersion: 1,
      nextRunAt: Timestamp.fromMillis(now + RETENTION_SWEEP_INTERVAL_MS),
      updatedAt: FieldValue.serverTimestamp()
    });
    return true;
  });
}

async function deleteExpired(db: Firestore, query: Query, now: number) {
  const expired = await query
    .where("expiresAt", "<=", Timestamp.fromMillis(now))
    .limit(DELETE_LIMIT_PER_COLLECTION)
    .get();
  if (expired.empty) return 0;
  const batch = db.batch();
  for (const document of expired.docs) batch.delete(document.ref);
  await batch.commit();
  return expired.size;
}

export async function runCommunityRetentionSweep(db: Firestore, now = Date.now()) {
  if (now < nextLocalAttemptAt) return { ran: false, deleted: 0 };
  nextLocalAttemptAt = now + LOCAL_ATTEMPT_INTERVAL_MS;

  try {
    if (!await acquireRetentionLease(db, now)) return { ran: false, deleted: 0 };
    const deleted = await Promise.all([
      deleteExpired(db, db.collectionGroup("messages"), now),
      ...TOP_LEVEL_RETENTION_COLLECTIONS.map(
        (collection) => deleteExpired(db, db.collection(collection), now)
      )
    ]);
    return {
      ran: true,
      deleted: deleted.reduce((total, count) => total + count, 0)
    };
  } catch {
    // Retention cleanup must never make presence, posting, or moderation
    // unavailable. The distributed lease allows the next bounded attempt.
    return { ran: false, deleted: 0 };
  }
}
