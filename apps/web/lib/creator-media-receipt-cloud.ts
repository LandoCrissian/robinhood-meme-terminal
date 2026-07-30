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
