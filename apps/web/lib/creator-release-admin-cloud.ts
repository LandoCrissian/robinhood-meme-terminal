import type { User } from "firebase/auth";
import { RMT_ADMIN_EMAIL } from "./creator-application";
import {
  parseCreatorReleaseDecision,
  type CreatorReleaseDecision,
  type CreatorReleaseOutcome,
  type CreatorReleaseReasonCode
} from "./creator-release-decision";
import {
  parseCreatorReleaseReview,
  type CreatorReleaseReview
} from "./creator-release-review";
import { getFirebaseClient } from "./firebase-client";

function requireAdmin(user: User) {
  if (!user.emailVerified || user.email?.toLowerCase() !== RMT_ADMIN_EMAIL) {
    throw new Error("RMT administrator access required.");
  }
}

export async function subscribeToAdminReleaseReviews(
  admin: User,
  listener: (reviews: CreatorReleaseReview[]) => void,
  onError: () => void
) {
  requireAdmin(admin);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase release reviews are not configured.");
  const reference = client.firestoreApi.query(
    client.firestoreApi.collectionGroup(client.db, "releaseReviews"),
    client.firestoreApi.orderBy("createdAt", "desc"),
    client.firestoreApi.limit(50)
  );
  return client.firestoreApi.onSnapshot(reference, (snapshot) => {
    listener(snapshot.docs
      .map((document) => parseCreatorReleaseReview(document.id, document.data()))
      .filter((review): review is CreatorReleaseReview => Boolean(review)));
  }, onError);
}

export async function subscribeToAdminReleaseDecisions(
  admin: User,
  listener: (decisions: CreatorReleaseDecision[]) => void,
  onError: () => void
) {
  requireAdmin(admin);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase release decisions are not configured.");
  const reference = client.firestoreApi.query(
    client.firestoreApi.collection(client.db, "creatorReleaseDecisions"),
    client.firestoreApi.orderBy("decidedAt", "desc"),
    client.firestoreApi.limit(50)
  );
  return client.firestoreApi.onSnapshot(reference, (snapshot) => {
    listener(snapshot.docs
      .map((document) => parseCreatorReleaseDecision(document.id, document.data()))
      .filter((decision): decision is CreatorReleaseDecision => Boolean(decision)));
  }, onError);
}

export async function recordCreatorReleaseDecision(input: {
  admin: User;
  review: CreatorReleaseReview;
  outcome: CreatorReleaseOutcome;
  reasonCode: CreatorReleaseReasonCode;
  reviewNote: string;
}) {
  requireAdmin(input.admin);
  const token = await input.admin.getIdToken();
  const response = await fetch("/api/admin/creator-release/decision", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      projectSlug: input.review.projectSlug,
      assetId: input.review.assetId,
      reviewId: input.review.reviewId,
      outcome: input.outcome,
      reasonCode: input.reasonCode,
      reviewNote: input.reviewNote
    })
  });
  const result = await response.json().catch(() => null) as { error?: unknown; decisionHash?: unknown } | null;
  if (!response.ok || typeof result?.decisionHash !== "string") {
    throw new Error(typeof result?.error === "string" ? result.error : "The review decision could not be recorded.");
  }
  return result.decisionHash;
}
