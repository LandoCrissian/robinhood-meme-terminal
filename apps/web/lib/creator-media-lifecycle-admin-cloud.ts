import type { User } from "firebase/auth";
import { RMT_ADMIN_EMAIL } from "./creator-application";
import {
  parseCreatorMediaAvailabilityStatus,
  type CreatorMediaAvailabilityStatus
} from "./creator-media-availability";
import {
  parseCreatorMediaTakedownDecision,
  parseCreatorMediaTakedownRequest,
  type CreatorMediaTakedownDecision,
  type CreatorMediaTakedownOutcome,
  type CreatorMediaTakedownRequest
} from "./creator-media-takedown";
import { getFirebaseClient } from "./firebase-client";

function requireAdmin(user: User) {
  if (!user.emailVerified || user.email?.toLowerCase() !== RMT_ADMIN_EMAIL) {
    throw new Error("RMT administrator access required.");
  }
}

export async function subscribeToAdminCreatorMediaLifecycle(
  admin: User,
  listener: (value: {
    requests: CreatorMediaTakedownRequest[];
    decisions: CreatorMediaTakedownDecision[];
    availability: CreatorMediaAvailabilityStatus[];
  }) => void,
  onError: () => void
) {
  requireAdmin(admin);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase provider lifecycle is not configured.");
  const state = {
    requests: [] as CreatorMediaTakedownRequest[],
    decisions: [] as CreatorMediaTakedownDecision[],
    availability: [] as CreatorMediaAvailabilityStatus[]
  };
  const emit = () => listener({ ...state });
  const limited = (collectionName: string) => client.firestoreApi.query(
    client.firestoreApi.collection(client.db, collectionName),
    client.firestoreApi.limit(100)
  );
  const cleanups = [
    client.firestoreApi.onSnapshot(limited("creatorMediaTakedownRequests"), (snapshot) => {
      state.requests = snapshot.docs
        .map((document) => parseCreatorMediaTakedownRequest(document.id, document.data()))
        .filter((item): item is CreatorMediaTakedownRequest => Boolean(item));
      emit();
    }, onError),
    client.firestoreApi.onSnapshot(limited("creatorMediaTakedownDecisions"), (snapshot) => {
      state.decisions = snapshot.docs
        .map((document) => parseCreatorMediaTakedownDecision(document.id, document.data()))
        .filter((item): item is CreatorMediaTakedownDecision => Boolean(item));
      emit();
    }, onError),
    client.firestoreApi.onSnapshot(limited("creatorMediaAvailability"), (snapshot) => {
      state.availability = snapshot.docs
        .map((document) => parseCreatorMediaAvailabilityStatus(document.id, document.data()))
        .filter((item): item is CreatorMediaAvailabilityStatus => Boolean(item));
      emit();
    }, onError)
  ];
  return () => cleanups.forEach((cleanup) => cleanup());
}

export async function recordCreatorMediaTakedownDecision(input: {
  admin: User;
  requestId: string;
  outcome: CreatorMediaTakedownOutcome;
  reviewNote: string;
}) {
  requireAdmin(input.admin);
  const token = await input.admin.getIdToken();
  const response = await fetch("/api/admin/creator-media/takedown/decision", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      requestId: input.requestId,
      outcome: input.outcome,
      reviewNote: input.reviewNote
    })
  });
  const result = await response.json().catch(() => null) as {
    error?: unknown;
    decisionHash?: unknown;
  } | null;
  if (!response.ok || typeof result?.decisionHash !== "string") {
    throw new Error(typeof result?.error === "string"
      ? result.error
      : "The takedown decision could not be recorded.");
  }
  return result.decisionHash;
}
