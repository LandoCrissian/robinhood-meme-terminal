import type { User } from "firebase/auth";
import { normalizeProjectSlug } from "./creator-application";
import type { CreatorMediaManifest } from "./creator-media-manifest";
import {
  parseCreatorMediaReceipt,
  receiptHasVerifiedRetrieval,
  type CreatorMediaReceipt
} from "./creator-media-receipt";
import { getFirebaseClient } from "./firebase-client";
import {
  parseCreatorMediaSupersession,
  type CreatorMediaSupersession
} from "./creator-media-supersession";
import {
  parseCreatorMediaAvailabilityStatus,
  type CreatorMediaAvailabilityStatus
} from "./creator-media-availability";
import {
  parseCreatorMediaTakedownDecision,
  parseCreatorMediaTakedownRequest,
  type CreatorMediaTakedownDecision,
  type CreatorMediaTakedownReason,
  type CreatorMediaTakedownRequest
} from "./creator-media-takedown";

export async function subscribeToCreatorMediaReceipts(
  user: User,
  projectSlug: string,
  assetId: string,
  listener: (receipts: CreatorMediaReceipt[]) => void,
  onError: () => void
) {
  if (!user.email || !user.emailVerified) throw new Error("Verified creator sign-in required.");
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase media receipts are not configured.");
  const slug = normalizeProjectSlug(projectSlug);
  const reference = client.firestoreApi.query(
    client.firestoreApi.collection(
      client.db,
      "projectAssignments",
      slug,
      "assets",
      assetId,
      "mediaReceipts"
    ),
    client.firestoreApi.orderBy("createdAt", "desc"),
    client.firestoreApi.limit(20)
  );
  return client.firestoreApi.onSnapshot(reference, (snapshot) => {
    listener(snapshot.docs
      .map((document) => parseCreatorMediaReceipt(document.id, document.data()))
      .filter((receipt): receipt is CreatorMediaReceipt => (
        Boolean(receipt) && receiptHasVerifiedRetrieval(receipt!)
      )));
  }, onError);
}

export async function pinCreatorMediaManifest(
  user: User,
  manifest: CreatorMediaManifest
) {
  const token = await user.getIdToken();
  const response = await fetch("/api/creator-media/pin", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      projectSlug: manifest.projectSlug,
      assetId: manifest.assetId,
      draftRevisionHash: manifest.draftRevisionHash,
      metadataHash: manifest.metadataHash,
      manifestHash: manifest.manifestHash
    })
  });
  const result = await response.json().catch(() => null) as {
    error?: unknown;
    receiptId?: unknown;
    metadataCid?: unknown;
    metadataUri?: unknown;
  } | null;
  if (
    !response.ok
    || typeof result?.receiptId !== "string"
    || typeof result.metadataCid !== "string"
    || typeof result.metadataUri !== "string"
  ) {
    throw new Error(typeof result?.error === "string"
      ? result.error
      : "The exact metadata bytes could not be pinned and verified.");
  }
  return {
    receiptId: result.receiptId,
    metadataCid: result.metadataCid,
    metadataUri: result.metadataUri
  };
}

export async function subscribeToCreatorMediaSupersessions(
  user: User,
  projectSlug: string,
  assetId: string,
  listener: (supersessions: CreatorMediaSupersession[]) => void,
  onError: () => void
) {
  if (!user.email || !user.emailVerified) throw new Error("Verified creator sign-in required.");
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase media corrections are not configured.");
  const slug = normalizeProjectSlug(projectSlug);
  const reference = client.firestoreApi.query(
    client.firestoreApi.collection(
      client.db,
      "projectAssignments",
      slug,
      "assets",
      assetId,
      "mediaReceiptSupersessions"
    ),
    client.firestoreApi.orderBy("createdAt", "desc"),
    client.firestoreApi.limit(20)
  );
  return client.firestoreApi.onSnapshot(reference, (snapshot) => {
    listener(snapshot.docs
      .map((document) => parseCreatorMediaSupersession(document.id, document.data()))
      .filter((item): item is CreatorMediaSupersession => Boolean(item)));
  }, onError);
}

export async function supersedeCreatorMediaReceipt(
  user: User,
  projectSlug: string,
  assetId: string,
  receiptId: string
) {
  const token = await user.getIdToken();
  const response = await fetch("/api/creator-media/supersede", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ projectSlug, assetId, receiptId })
  });
  const result = await response.json().catch(() => null) as {
    error?: unknown;
    supersessionId?: unknown;
    supersessionHash?: unknown;
  } | null;
  if (
    !response.ok
    || typeof result?.supersessionId !== "string"
    || typeof result.supersessionHash !== "string"
  ) {
    throw new Error(typeof result?.error === "string"
      ? result.error
      : "The metadata correction could not be recorded.");
  }
  return {
    supersessionId: result.supersessionId,
    supersessionHash: result.supersessionHash
  };
}

export async function subscribeToCreatorMediaLifecycle(
  user: User,
  projectSlug: string,
  assetId: string,
  listener: (value: {
    requests: CreatorMediaTakedownRequest[];
    decisions: CreatorMediaTakedownDecision[];
    availability: CreatorMediaAvailabilityStatus[];
  }) => void,
  onError: () => void
) {
  if (!user.email || !user.emailVerified) throw new Error("Verified creator sign-in required.");
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase provider lifecycle is not configured.");
  const slug = normalizeProjectSlug(projectSlug);
  const state = {
    requests: [] as CreatorMediaTakedownRequest[],
    decisions: [] as CreatorMediaTakedownDecision[],
    availability: [] as CreatorMediaAvailabilityStatus[]
  };
  const emit = () => listener({
    requests: state.requests.filter((item) => item.assetId === assetId),
    decisions: state.decisions.filter((item) => item.assetId === assetId),
    availability: state.availability.filter((item) => item.assetId === assetId)
  });
  const scoped = (collectionName: string) => client.firestoreApi.query(
    client.firestoreApi.collection(client.db, collectionName),
    client.firestoreApi.where("projectSlug", "==", slug),
    client.firestoreApi.limit(50)
  );
  const cleanups = [
    client.firestoreApi.onSnapshot(scoped("creatorMediaTakedownRequests"), (snapshot) => {
      state.requests = snapshot.docs
        .map((document) => parseCreatorMediaTakedownRequest(document.id, document.data()))
        .filter((item): item is CreatorMediaTakedownRequest => Boolean(item));
      emit();
    }, onError),
    client.firestoreApi.onSnapshot(scoped("creatorMediaTakedownDecisions"), (snapshot) => {
      state.decisions = snapshot.docs
        .map((document) => parseCreatorMediaTakedownDecision(document.id, document.data()))
        .filter((item): item is CreatorMediaTakedownDecision => Boolean(item));
      emit();
    }, onError),
    client.firestoreApi.onSnapshot(scoped("creatorMediaAvailability"), (snapshot) => {
      state.availability = snapshot.docs
        .map((document) => parseCreatorMediaAvailabilityStatus(document.id, document.data()))
        .filter((item): item is CreatorMediaAvailabilityStatus => Boolean(item));
      emit();
    }, onError)
  ];
  return () => cleanups.forEach((cleanup) => cleanup());
}

export async function requestCreatorMediaTakedown(input: {
  user: User;
  projectSlug: string;
  assetId: string;
  receiptId: string;
  reasonCode: CreatorMediaTakedownReason;
  requestNote: string;
}) {
  const token = await input.user.getIdToken();
  const response = await fetch("/api/creator-media/takedown", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      projectSlug: input.projectSlug,
      assetId: input.assetId,
      receiptId: input.receiptId,
      reasonCode: input.reasonCode,
      requestNote: input.requestNote
    })
  });
  const result = await response.json().catch(() => null) as {
    error?: unknown;
    requestId?: unknown;
    requestHash?: unknown;
  } | null;
  if (
    !response.ok
    || typeof result?.requestId !== "string"
    || typeof result.requestHash !== "string"
  ) {
    throw new Error(typeof result?.error === "string"
      ? result.error
      : "The provider-takedown request could not be recorded.");
  }
  return { requestId: result.requestId, requestHash: result.requestHash };
}
