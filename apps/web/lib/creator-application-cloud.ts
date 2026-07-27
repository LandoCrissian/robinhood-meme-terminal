import type { User } from "firebase/auth";
import { getFirebaseClient } from "./firebase-client";
import {
  CREATOR_APPLICATION_SCHEMA_VERSION,
  PROJECT_RECORD_SCHEMA_VERSION,
  RMT_ADMIN_EMAIL,
  normalizeCreatorApplication,
  normalizeProjectSlug,
  parseCreatorApplication,
  type CreatorApplication,
  type CreatorApplicationDraft,
  type CreatorApplicationStatus
} from "./creator-application";

export type AdminCreatorApplication = CreatorApplication & { userId: string };

function requireVerifiedUser(user: User | null): User & { email: string } {
  if (!user || !user.email || !user.emailVerified) {
    throw new Error("Sign in with a verified Google profile before applying.");
  }
  return user as User & { email: string };
}

function requireAdmin(user: User | null) {
  const verified = requireVerifiedUser(user);
  if (verified.email?.toLowerCase() !== RMT_ADMIN_EMAIL) throw new Error("RMT administrator access required.");
  return verified;
}

export async function subscribeToCreatorApplication(
  user: User,
  listener: (application: CreatorApplication | null) => void,
  onError: () => void
) {
  const verified = requireVerifiedUser(user);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase profile sync is not configured.");
  const reference = client.firestoreApi.doc(client.db, "creatorApplications", verified.uid);
  return client.firestoreApi.onSnapshot(reference, (snapshot) => {
    listener(snapshot.exists() ? parseCreatorApplication(snapshot.data()) : null);
  }, onError);
}

export async function submitCreatorApplication(user: User, value: CreatorApplicationDraft) {
  const verified = requireVerifiedUser(user);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase profile sync is not configured.");
  const draft = normalizeCreatorApplication(value);
  const reference = client.firestoreApi.doc(client.db, "creatorApplications", verified.uid);
  const existing = await client.firestoreApi.getDoc(reference);
  const existingApplication = existing.exists() ? parseCreatorApplication(existing.data()) : null;
  if (existingApplication && existingApplication.status !== "needs_changes") {
    throw new Error("This profile already has an application under review or completed.");
  }

  const now = client.firestoreApi.serverTimestamp();
  await client.firestoreApi.setDoc(reference, {
    schemaVersion: CREATOR_APPLICATION_SCHEMA_VERSION,
    ...draft,
    contactEmail: verified.email.toLowerCase(),
    status: "pending",
    submittedAt: existingApplication?.submittedAt ?? now,
    updatedAt: now
  });
}

export async function subscribeToAdminApplications(
  user: User,
  listener: (applications: AdminCreatorApplication[]) => void,
  onError: () => void
) {
  requireAdmin(user);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase profile sync is not configured.");
  const reference = client.firestoreApi.collection(client.db, "creatorApplications");
  return client.firestoreApi.onSnapshot(reference, (snapshot) => {
    const applications = snapshot.docs.flatMap((document) => {
      const application = parseCreatorApplication(document.data());
      return application ? [{ ...application, userId: document.id }] : [];
    });
    applications.sort((left, right) => {
      const rank = { pending: 0, needs_changes: 1, approved: 2, rejected: 3 };
      return rank[left.status] - rank[right.status] || left.projectName.localeCompare(right.projectName);
    });
    listener(applications);
  }, onError);
}

export async function reviewCreatorApplication(input: {
  admin: User;
  application: AdminCreatorApplication;
  status: Exclude<CreatorApplicationStatus, "pending">;
  reviewNote: string;
  projectSlug?: string;
}) {
  requireAdmin(input.admin);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase profile sync is not configured.");
  const reviewNote = input.reviewNote.trim().slice(0, 600);
  const applicationReference = client.firestoreApi.doc(client.db, "creatorApplications", input.application.userId);
  const now = client.firestoreApi.serverTimestamp();

  if (input.status !== "approved") {
    await client.firestoreApi.updateDoc(applicationReference, {
      status: input.status,
      reviewNote,
      reviewedAt: now,
      updatedAt: now,
      projectSlug: client.firestoreApi.deleteField()
    });
    return;
  }

  const slug = normalizeProjectSlug(input.projectSlug);
  if (slug.length < 3) throw new Error("Approved projects need a unique slug of at least 3 characters.");
  const projectReference = client.firestoreApi.doc(client.db, "projects", slug);
  await client.firestoreApi.runTransaction(client.db, async (transaction) => {
    const [currentApplicationSnapshot, existingProjectSnapshot] = await Promise.all([
      transaction.get(applicationReference),
      transaction.get(projectReference)
    ]);
    const currentApplication = currentApplicationSnapshot.exists()
      ? parseCreatorApplication(currentApplicationSnapshot.data())
      : null;
    if (!currentApplication || currentApplication.status !== "pending") {
      throw new Error("Only a currently pending application can be approved.");
    }
    if (existingProjectSnapshot.exists()) {
      throw new Error("That public page slug is already assigned. Choose another.");
    }
    transaction.set(projectReference, {
      schemaVersion: PROJECT_RECORD_SCHEMA_VERSION,
      slug,
      name: currentApplication.projectName,
      summary: currentApplication.summary,
      projectType: currentApplication.projectType,
      website: currentApplication.website,
      xProfile: currentApplication.xProfile,
      tokenAddress: currentApplication.tokenAddress,
      availableModules: currentApplication.requestedModules,
      status: "live",
      publishedAt: now,
      updatedAt: now
    });
    transaction.update(applicationReference, {
      status: "approved",
      reviewNote,
      reviewedAt: now,
      updatedAt: now,
      projectSlug: slug
    });
  });
}
