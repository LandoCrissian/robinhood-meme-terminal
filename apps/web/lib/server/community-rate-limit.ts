import { createHmac } from "node:crypto";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { mediaClientAddress } from "./media-request-guard";

type StoredRateBucket = {
  count?: unknown;
  resetAt?: unknown;
};

export type CommunityRateLimitDecision = {
  allowed: boolean;
  count: number;
  resetAt: number;
  retryAfterSeconds: number;
};

function timestampMillis(value: unknown) {
  if (!value || typeof value !== "object" || !("toMillis" in value)) return 0;
  const toMillis = (value as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== "function") return 0;
  const result = toMillis.call(value);
  return typeof result === "number" && Number.isFinite(result) && result > 0 ? result : 0;
}

export function decideCommunityRateLimit(
  stored: StoredRateBucket | undefined,
  options: { limit: number; windowMs: number; now: number }
): CommunityRateLimitDecision {
  const storedResetAt = timestampMillis(stored?.resetAt);
  const sameWindow = storedResetAt > options.now;
  const count = sameWindow && Number.isInteger(stored?.count) && Number(stored?.count) >= 0
    ? Number(stored?.count)
    : 0;
  const resetAt = sameWindow ? storedResetAt : options.now + options.windowMs;
  const allowed = count < options.limit;
  return {
    allowed,
    count: allowed ? count + 1 : count,
    resetAt,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt - options.now) / 1_000))
  };
}

function rateBucketId(secret: string, namespace: string, request: Request) {
  return createHmac("sha256", secret)
    .update(`rmt-community-rate:${namespace}:${mediaClientAddress(request)}`)
    .digest("hex")
    .slice(0, 40);
}

export async function consumeCommunityRateLimit(
  db: Firestore,
  secret: string,
  request: Request,
  options: { namespace: string; limit: number; windowMs: number; now?: number }
) {
  const now = options.now ?? Date.now();
  const reference = db.collection("communityRateLimits").doc(
    `${options.namespace}--${rateBucketId(secret, options.namespace, request)}`
  );
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const decision = decideCommunityRateLimit(snapshot.data(), {
      limit: options.limit,
      windowMs: options.windowMs,
      now
    });
    if (decision.allowed) {
      transaction.set(reference, {
        schemaVersion: 1,
        namespace: options.namespace,
        count: decision.count,
        resetAt: Timestamp.fromMillis(decision.resetAt),
        expiresAt: Timestamp.fromMillis(decision.resetAt),
        updatedAt: FieldValue.serverTimestamp()
      });
    }
    return decision;
  });
}
