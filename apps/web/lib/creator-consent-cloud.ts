import type { User } from "firebase/auth";
import {
  CREATOR_CONSENT_SCHEMA_VERSION,
  hashCreatorConsentInvitation,
  parseCreatorConsentInvitationRecord,
  parseCreatorConsentPublicStatus,
  validateCreatorConsentInvitation,
  type CreatorConsentInvitation,
  type CreatorConsentInvitationRecord,
  type CreatorConsentPublicStatus
} from "./creator-consent";
import { getFirebaseClient } from "./firebase-client";
import { normalizeProjectSlug } from "./creator-application";
import { parseCreatorAsset } from "./creator-assets";
import { parseProjectAssignment } from "./project-ownership";

function requireVerifiedUser(user: User | null): User & { email: string } {
  if (!user || !user.email || !user.emailVerified) {
    throw new Error("Sign in with a verified Google profile to manage collaborator consent.");
  }
  return user as User & { email: string };
}

export async function subscribeToCreatorConsentInvitations(
  user: User,
  projectSlug: string,
  assetId: string,
  listener: (records: CreatorConsentInvitationRecord[]) => void,
  onError: () => void
) {
  requireVerifiedUser(user);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase creator consent is not configured.");
  const slug = normalizeProjectSlug(projectSlug);
  const reference = client.firestoreApi.query(
    client.firestoreApi.collection(
      client.db,
      "projectAssignments",
      slug,
      "assets",
      assetId,
      "consentInvitations"
    ),
    client.firestoreApi.orderBy("updatedAt", "desc"),
    client.firestoreApi.limit(50)
  );
  return client.firestoreApi.onSnapshot(reference, (snapshot) => {
    listener(snapshot.docs
      .map((document) => parseCreatorConsentInvitationRecord(document.id, document.data()))
      .filter((record): record is CreatorConsentInvitationRecord => Boolean(record)));
  }, onError);
}

export async function saveCreatorConsentInvitation(
  user: User,
  invitation: CreatorConsentInvitation
) {
  const verified = requireVerifiedUser(user);
  const validationError = validateCreatorConsentInvitation(invitation);
  if (validationError) throw new Error(validationError);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase creator consent is not configured.");
  const digest = hashCreatorConsentInvitation(invitation);
  const invitationId = digest.slice(2);
  const assignmentReference = client.firestoreApi.doc(
    client.db,
    "projectAssignments",
    invitation.projectSlug
  );
  const assetReference = client.firestoreApi.doc(
    assignmentReference,
    "assets",
    invitation.assetId
  );
  const invitationReference = client.firestoreApi.doc(
    assetReference,
    "consentInvitations",
    invitationId
  );
  const statusReference = client.firestoreApi.doc(
    client.db,
    "creatorConsentStatuses",
    invitationId
  );
  await client.firestoreApi.runTransaction(client.db, async (transaction) => {
    const [assignmentSnapshot, assetSnapshot, invitationSnapshot, statusSnapshot] = await Promise.all([
      transaction.get(assignmentReference),
      transaction.get(assetReference),
      transaction.get(invitationReference),
      transaction.get(statusReference)
    ]);
    const assignment = assignmentSnapshot.exists()
      ? parseProjectAssignment(assignmentSnapshot.data())
      : null;
    const asset = assetSnapshot.exists()
      ? parseCreatorAsset(assetSnapshot.id, assetSnapshot.data())
      : null;
    if (!assignment || assignment.ownerId !== verified.uid || !asset) {
      throw new Error("That private creator asset is unavailable.");
    }
    if (asset.draftRevisionHash !== invitation.draftRevisionHash) {
      throw new Error("The asset changed. Save and prepare a new invitation.");
    }
    if (!asset.collaborators.some((collaborator) => (
      collaborator.name === invitation.collaboratorName
      && collaborator.role === invitation.collaboratorRole
      && collaborator.walletAddress === invitation.collaboratorWallet
    ))) throw new Error("The invited collaborator no longer matches this asset revision.");
    if (invitationSnapshot.exists() || statusSnapshot.exists()) throw new Error("That invitation already exists.");
    const now = client.firestoreApi.serverTimestamp();
    transaction.set(invitationReference, {
      ...invitation,
      invitationId,
      invitationDigest: digest,
      status: "pending",
      revokedAt: null,
      responseAction: null,
      responseSignature: null,
      respondedAt: null,
      signerWallet: null,
      receivedAt: null,
      withdrawalSignature: null,
      withdrawalSignedAt: null,
      withdrawalReceivedAt: null,
      createdAt: now,
      updatedAt: now
    });
    transaction.set(statusReference, {
      schemaVersion: CREATOR_CONSENT_SCHEMA_VERSION,
      invitationId,
      invitationDigest: digest,
      projectSlug: invitation.projectSlug,
      assetId: invitation.assetId,
      status: "pending",
      expiresAt: invitation.expiresAt,
      createdAt: now,
      updatedAt: now
    });
  });
  return invitationId;
}

export async function revokeCreatorConsentInvitation(
  user: User,
  projectSlug: string,
  assetId: string,
  invitationId: string
) {
  const verified = requireVerifiedUser(user);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase creator consent is not configured.");
  const slug = normalizeProjectSlug(projectSlug);
  const assignmentReference = client.firestoreApi.doc(client.db, "projectAssignments", slug);
  const invitationReference = client.firestoreApi.doc(
    assignmentReference,
    "assets",
    assetId,
    "consentInvitations",
    invitationId
  );
  const statusReference = client.firestoreApi.doc(
    client.db,
    "creatorConsentStatuses",
    invitationId
  );
  await client.firestoreApi.runTransaction(client.db, async (transaction) => {
    const [assignmentSnapshot, invitationSnapshot, statusSnapshot] = await Promise.all([
      transaction.get(assignmentReference),
      transaction.get(invitationReference),
      transaction.get(statusReference)
    ]);
    const assignment = assignmentSnapshot.exists()
      ? parseProjectAssignment(assignmentSnapshot.data())
      : null;
    const invitation = invitationSnapshot.exists()
      ? parseCreatorConsentInvitationRecord(invitationSnapshot.id, invitationSnapshot.data())
      : null;
    const publicStatus = statusSnapshot.exists()
      ? parseCreatorConsentPublicStatus(statusSnapshot.id, statusSnapshot.data())
      : null;
    if (!assignment || assignment.ownerId !== verified.uid || !invitation || !publicStatus) {
      throw new Error("That consent invitation is unavailable.");
    }
    if (invitation.status !== "pending") throw new Error("Only a pending invitation can be revoked.");
    const now = client.firestoreApi.serverTimestamp();
    transaction.update(invitationReference, {
      status: "revoked",
      revokedAt: now,
      updatedAt: now
    });
    transaction.update(statusReference, {
      status: "revoked",
      updatedAt: now
    });
  });
}

export async function subscribeToCreatorConsentPublicStatus(
  invitationId: string,
  listener: (status: CreatorConsentPublicStatus | null) => void,
  onError: () => void
) {
  if (!/^[0-9a-f]{64}$/.test(invitationId)) throw new Error("Consent invitation identifier is invalid.");
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase creator consent is not configured.");
  const reference = client.firestoreApi.doc(client.db, "creatorConsentStatuses", invitationId);
  return client.firestoreApi.onSnapshot(reference, (snapshot) => {
    listener(snapshot.exists()
      ? parseCreatorConsentPublicStatus(snapshot.id, snapshot.data())
      : null);
  }, onError);
}
