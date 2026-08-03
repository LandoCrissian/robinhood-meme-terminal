import type { User } from "firebase/auth";
import {
  CREATOR_ASSET_SCHEMA_VERSION,
  hashCreatorAssetDraft,
  normalizeCreatorAsset,
  parseCreatorAsset,
  validateCreatorAsset,
  type CreatorAsset,
  type CreatorAssetDraft,
  type CreatorAssetType
} from "./creator-assets";
import { getFirebaseClient } from "./firebase-client";
import { normalizeProjectSlug } from "./creator-application";
import { parseProjectAssignment, type ProjectAssignment } from "./project-ownership";

function requireVerifiedUser(user: User | null): User & { email: string } {
  if (!user || !user.email || !user.emailVerified) {
    throw new Error("Sign in with a verified Google profile to manage creator assets.");
  }
  return user as User & { email: string };
}

function assignmentAllowsAsset(assignment: ProjectAssignment, assetType: CreatorAssetType) {
  return assetType === "music_release"
    ? assignment.allowedModules.includes("music")
    : assignment.allowedModules.includes("nft");
}

export async function subscribeToCreatorAssets(
  user: User,
  projectSlug: string,
  listener: (assets: CreatorAsset[]) => void,
  onError: () => void
) {
  requireVerifiedUser(user);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase creator assets are not configured.");
  const slug = normalizeProjectSlug(projectSlug);
  const reference = client.firestoreApi.query(
    client.firestoreApi.collection(client.db, "projectAssignments", slug, "assets"),
    client.firestoreApi.orderBy("updatedAt", "desc"),
    client.firestoreApi.limit(50)
  );
  return client.firestoreApi.onSnapshot(reference, (snapshot) => {
    const assets = snapshot.docs
      .map((document) => parseCreatorAsset(document.id, document.data()))
      .filter((asset): asset is CreatorAsset => Boolean(asset));
    listener(assets);
  }, onError);
}

export async function saveCreatorAsset(
  user: User,
  projectSlug: string,
  value: CreatorAssetDraft,
  assetId?: string
) {
  const verified = requireVerifiedUser(user);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase creator assets are not configured.");
  const slug = normalizeProjectSlug(projectSlug);
  const draft = normalizeCreatorAsset(value);
  const validationError = validateCreatorAsset(value);
  if (validationError) throw new Error(validationError);
  const assignmentReference = client.firestoreApi.doc(client.db, "projectAssignments", slug);
  const assetReference = assetId
    ? client.firestoreApi.doc(assignmentReference, "assets", assetId)
    : client.firestoreApi.doc(client.firestoreApi.collection(assignmentReference, "assets"));

  await client.firestoreApi.runTransaction(client.db, async (transaction) => {
    const [assignmentSnapshot, assetSnapshot] = await Promise.all([
      transaction.get(assignmentReference),
      transaction.get(assetReference)
    ]);
    const assignment = assignmentSnapshot.exists()
      ? parseProjectAssignment(assignmentSnapshot.data())
      : null;
    if (!assignment || assignment.ownerId !== verified.uid) {
      throw new Error("This profile is not assigned to manage the project.");
    }
    if (!assignmentAllowsAsset(assignment, draft.assetType)) {
      throw new Error(draft.assetType === "music_release"
        ? "The Music module is not approved for this project."
        : "The NFT module is not approved for this project.");
    }
    if (assetId && !assetSnapshot.exists()) throw new Error("That asset draft no longer exists.");
    const now = client.firestoreApi.serverTimestamp();
    transaction.set(assetReference, {
      schemaVersion: CREATOR_ASSET_SCHEMA_VERSION,
      assetId: assetReference.id,
      projectSlug: slug,
      ...draft,
      collaboratorConsentStatus: "unverified",
      revenueSplitTotalBps: draft.revenueSplits.reduce((total, split) => total + split.shareBps, 0),
      draftRevisionHash: hashCreatorAssetDraft(draft),
      status: "draft",
      createdAt: assetSnapshot.exists() ? assetSnapshot.data().createdAt : now,
      updatedAt: now
    });
  });
  return assetReference.id;
}

export async function deleteCreatorAsset(user: User, projectSlug: string, assetId: string) {
  const verified = requireVerifiedUser(user);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase creator assets are not configured.");
  const slug = normalizeProjectSlug(projectSlug);
  const assignmentReference = client.firestoreApi.doc(client.db, "projectAssignments", slug);
  const assetReference = client.firestoreApi.doc(assignmentReference, "assets", assetId);
  await client.firestoreApi.runTransaction(client.db, async (transaction) => {
    const [assignmentSnapshot, assetSnapshot] = await Promise.all([
      transaction.get(assignmentReference),
      transaction.get(assetReference)
    ]);
    const assignment = assignmentSnapshot.exists()
      ? parseProjectAssignment(assignmentSnapshot.data())
      : null;
    if (!assignment || assignment.ownerId !== verified.uid || !assetSnapshot.exists()) {
      throw new Error("That asset draft is unavailable.");
    }
    transaction.delete(assetReference);
  });
}
