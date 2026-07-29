import type { User } from "firebase/auth";
import { normalizeProjectSlug } from "./creator-application";
import {
  parseCreatorReleaseReview,
  type CreatorReleaseReview
} from "./creator-release-review";
import { getFirebaseClient } from "./firebase-client";
import {
  parseCreatorReleaseDecision,
  type CreatorReleaseDecision
} from "./creator-release-decision";

export async function subscribeToCreatorReleaseReviews(
  user: User,
  projectSlug: string,
  assetId: string,
  listener: (reviews: CreatorReleaseReview[]) => void,
  onError: () => void
) {
  if (!user.email || !user.emailVerified) throw new Error("Verified creator sign-in required.");
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase release reviews are not configured.");
  const slug = normalizeProjectSlug(projectSlug);
  const reference = client.firestoreApi.query(
    client.firestoreApi.collection(
      client.db,
      "projectAssignments",
      slug,
      "assets",
      assetId,
      "releaseReviews"
    ),
    client.firestoreApi.orderBy("createdAt", "desc"),
    client.firestoreApi.limit(20)
  );
  return client.firestoreApi.onSnapshot(reference, (snapshot) => {
    listener(snapshot.docs
      .map((document) => parseCreatorReleaseReview(document.id, document.data()))
      .filter((review): review is CreatorReleaseReview => Boolean(review)));
  }, onError);
}

export async function prepareCreatorReleaseReview(
  user: User,
  projectSlug: string,
  assetId: string,
  draftRevisionHash: string
) {
  const token = await user.getIdToken();
  const response = await fetch("/api/creator-release/review", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ projectSlug, assetId, draftRevisionHash })
  });
  const result = await response.json().catch(() => null) as {
    error?: unknown;
    reviewId?: unknown;
    reviewHash?: unknown;
  } | null;
  if (
    !response.ok
    || typeof result?.reviewId !== "string"
    || typeof result.reviewHash !== "string"
  ) {
    throw new Error(typeof result?.error === "string"
      ? result.error
      : "The immutable release-review snapshot could not be prepared.");
  }
  return { reviewId: result.reviewId, reviewHash: result.reviewHash };
}

export async function subscribeToCreatorReleaseDecisions(
  user: User,
  projectSlug: string,
  listener: (decisions: CreatorReleaseDecision[]) => void,
  onError: () => void
) {
  if (!user.email || !user.emailVerified) throw new Error("Verified creator sign-in required.");
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase release decisions are not configured.");
  const slug = normalizeProjectSlug(projectSlug);
  const reference = client.firestoreApi.query(
    client.firestoreApi.collection(client.db, "creatorReleaseDecisions"),
    client.firestoreApi.where("projectSlug", "==", slug),
    client.firestoreApi.limit(50)
  );
  return client.firestoreApi.onSnapshot(reference, (snapshot) => {
    listener(snapshot.docs
      .map((document) => parseCreatorReleaseDecision(document.id, document.data()))
      .filter((decision): decision is CreatorReleaseDecision => Boolean(decision)));
  }, onError);
}
