import type { User } from "firebase/auth";
import {
  normalizeProjectSlug,
  parsePublicProject,
  type PublicProjectRecord
} from "./creator-application";
import { getFirebaseClient } from "./firebase-client";

export const PROJECT_FOLLOW_SCHEMA_VERSION = 1 as const;
export const PROJECT_AUDIENCE_SCHEMA_VERSION = 1 as const;
export const PRIVATE_FOLLOWING_LIMIT = 50;

function requireVerifiedUser(user: User | null): User {
  if (!user || !user.emailVerified) {
    throw new Error("Sign in with a verified RMT profile before following a project.");
  }
  return user;
}

function parseFollowerCount(value: unknown) {
  if (!value || typeof value !== "object") return 0;
  const data = value as Record<string, unknown>;
  return data.schemaVersion === PROJECT_AUDIENCE_SCHEMA_VERSION
    && typeof data.followerCount === "number"
    && Number.isSafeInteger(data.followerCount)
    && data.followerCount >= 0
      ? data.followerCount
      : 0;
}

function parseFollowSlug(documentId: string, value: unknown) {
  if (!value || typeof value !== "object") return "";
  const data = value as Record<string, unknown>;
  const projectSlug = normalizeProjectSlug(data.projectSlug);
  return data.schemaVersion === PROJECT_FOLLOW_SCHEMA_VERSION
    && projectSlug === normalizeProjectSlug(documentId)
      ? projectSlug
      : "";
}

export async function subscribeToFollowedProjects(
  user: User,
  listener: (projects: PublicProjectRecord[]) => void,
  onError: () => void
) {
  const verified = requireVerifiedUser(user);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase profile sync is not configured.");
  const reference = client.firestoreApi.query(
    client.firestoreApi.collection(client.db, "users", verified.uid, "projectFollows"),
    client.firestoreApi.limit(PRIVATE_FOLLOWING_LIMIT)
  );
  let snapshotVersion = 0;
  return client.firestoreApi.onSnapshot(reference, (snapshot) => {
    const currentVersion = ++snapshotVersion;
    const slugs = snapshot.docs
      .map((document) => parseFollowSlug(document.id, document.data()))
      .filter(Boolean);
    if (slugs.length === 0) {
      listener([]);
      return;
    }
    void Promise.all(slugs.map(async (slug) => {
      const projectSnapshot = await client.firestoreApi.getDoc(
        client.firestoreApi.doc(client.db, "projects", slug)
      );
      return projectSnapshot.exists() ? parsePublicProject(projectSnapshot.data()) : null;
    })).then((projects) => {
      if (currentVersion !== snapshotVersion) return;
      listener(
        projects
          .filter((project): project is PublicProjectRecord => Boolean(project))
          .sort((left, right) => left.name.localeCompare(right.name))
      );
    }).catch(onError);
  }, onError);
}

export async function subscribeToProjectFollowerCount(
  projectSlug: string,
  listener: (count: number) => void,
  onError: () => void
) {
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase project discovery is not configured.");
  const slug = normalizeProjectSlug(projectSlug);
  const reference = client.firestoreApi.doc(client.db, "projectStats", slug);
  return client.firestoreApi.onSnapshot(reference, (snapshot) => {
    listener(snapshot.exists() ? parseFollowerCount(snapshot.data()) : 0);
  }, onError);
}

export async function subscribeToProjectFollow(
  user: User,
  projectSlug: string,
  listener: (following: boolean) => void,
  onError: () => void
) {
  const verified = requireVerifiedUser(user);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase profile sync is not configured.");
  const slug = normalizeProjectSlug(projectSlug);
  const reference = client.firestoreApi.doc(client.db, "users", verified.uid, "projectFollows", slug);
  return client.firestoreApi.onSnapshot(reference, (snapshot) => listener(snapshot.exists()), onError);
}

export async function setProjectFollow(user: User, projectSlug: string, following: boolean) {
  const verified = requireVerifiedUser(user);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase profile sync is not configured.");
  const slug = normalizeProjectSlug(projectSlug);
  if (!slug) throw new Error("The project page is not valid.");
  const userReference = client.firestoreApi.doc(client.db, "users", verified.uid);
  const projectReference = client.firestoreApi.doc(client.db, "projects", slug);
  const followReference = client.firestoreApi.doc(userReference, "projectFollows", slug);
  const statsReference = client.firestoreApi.doc(client.db, "projectStats", slug);

  await client.firestoreApi.runTransaction(client.db, async (transaction) => {
    const [userSnapshot, projectSnapshot, followSnapshot, statsSnapshot] = await Promise.all([
      transaction.get(userReference),
      transaction.get(projectReference),
      transaction.get(followReference),
      transaction.get(statsReference)
    ]);
    const project = projectSnapshot.exists() ? parsePublicProject(projectSnapshot.data()) : null;
    if (!userSnapshot.exists()) throw new Error("Finish creating your RMT profile before following projects.");
    if (!project) throw new Error("This approved project page is unavailable.");
    if (followSnapshot.exists() === following) return;

    const followerCount = statsSnapshot.exists() ? parseFollowerCount(statsSnapshot.data()) : 0;
    const now = client.firestoreApi.serverTimestamp();
    if (following) {
      transaction.set(followReference, {
        schemaVersion: PROJECT_FOLLOW_SCHEMA_VERSION,
        projectSlug: slug,
        followedAt: now
      });
      transaction.set(statsReference, {
        schemaVersion: PROJECT_AUDIENCE_SCHEMA_VERSION,
        projectSlug: slug,
        followerCount: followerCount + 1,
        updatedAt: now
      });
      return;
    }

    if (!statsSnapshot.exists() || followerCount < 1) {
      throw new Error("The project audience count is being repaired. Try again shortly.");
    }
    transaction.delete(followReference);
    transaction.update(statsReference, {
      followerCount: followerCount - 1,
      updatedAt: now
    });
  });
}
