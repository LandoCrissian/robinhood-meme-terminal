import type { Firestore } from "firebase-admin/firestore";
import { profileCollections as c } from "./store";

export const profileRetentionPolicy = {
  minimumIntervalMs: 60_000, maximumDeletesPerCollection: 3, maximumDeletesPerPass: 12,
  collections: [c.nonces, c.sessions, c.budgets, c.browsers],
  semantics: "Request-driven, bounded cleanup; expiresAt is not an enabled Firestore TTL policy. No traffic means no cleanup pass.",
} as const;

/** Only these app-owned collections are eligible. No scan, scheduler, paid TTL or legacy/global Auth deletion. */
export async function cleanupExpiredProfileState(db: Firestore, now = Date.now()) {
  const lease = db.collection(c.budgets).doc("_retention_v1");
  const admitted = await db.runTransaction(async tx => {
    const prior = (await tx.get(lease)).data();
    if (prior && typeof prior.nextAt === "number" && prior.nextAt > now) return false;
    tx.set(lease, { nextAt: now + profileRetentionPolicy.minimumIntervalMs, lastAttemptAt: now });
    return true;
  });
  if (!admitted) return { status: "interval-limited" as const, deleted: 0 };
  let deleted = 0;
  for (const name of profileRetentionPolicy.collections) {
    const expired = await db.collection(name).where("expiresAt", "<=", now).limit(profileRetentionPolicy.maximumDeletesPerCollection).get();
    if (expired.empty) continue;
    const batch = db.batch();
    // A concurrently renewed budget/browser record must not be deleted from a stale query result.
    for (const row of expired.docs) batch.delete(row.ref, { lastUpdateTime: row.updateTime });
    await batch.commit();
    deleted += expired.size;
  }
  return { status: "completed" as const, deleted };
}
