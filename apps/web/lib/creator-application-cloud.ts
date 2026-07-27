import type { User } from "firebase/auth";
import { getFirebaseClient } from "./firebase-client";
import {
  CREATOR_APPLICATION_SCHEMA_VERSION,
  PROJECT_MODULES,
  PROJECT_RECORD_SCHEMA_VERSION,
  RMT_ADMIN_EMAIL,
  normalizeCreatorApplication,
  normalizeProjectIdentity,
  normalizeProjectSlug,
  parseCreatorApplication,
  parsePublicProject,
  validateProjectIdentity,
  type CreatorApplication,
  type CreatorApplicationDraft,
  type CreatorApplicationStatus,
  type ProjectIdentityDraft,
  type PublicProjectRecord,
  type RequestedProjectModule
} from "./creator-application";
import {
  MODULE_ACTIVATION_REQUEST_SCHEMA_VERSION,
  PROJECT_ASSIGNMENT_SCHEMA_VERSION,
  parseModuleActivationRequest,
  parseProjectAssignment,
  type ModuleActivationRequest,
  type ModuleActivationRequestStatus,
  type ProjectAssignment
} from "./project-ownership";

export type AdminCreatorApplication = CreatorApplication & { userId: string };
export type AdminModuleActivationRequest = ModuleActivationRequest & { projectSlug: string };

export async function subscribeToPublicProjects(
  listener: (projects: PublicProjectRecord[]) => void,
  onError: () => void
) {
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase project discovery is not configured.");
  const reference = client.firestoreApi.query(
    client.firestoreApi.collection(client.db, "projects"),
    client.firestoreApi.where("status", "==", "live"),
    client.firestoreApi.limit(50)
  );
  return client.firestoreApi.onSnapshot(reference, (snapshot) => {
    const projects = snapshot.docs
      .map((document) => parsePublicProject(document.data()))
      .filter((project): project is PublicProjectRecord => Boolean(project));
    listener(projects);
  }, onError);
}

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

export async function subscribeToProjectAssignment(
  user: User,
  projectSlug: string,
  listener: (assignment: ProjectAssignment | null) => void,
  onError: () => void
) {
  const verified = requireVerifiedUser(user);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase project ownership is not configured.");
  const slug = normalizeProjectSlug(projectSlug);
  const reference = client.firestoreApi.doc(client.db, "projectAssignments", slug);
  return client.firestoreApi.onSnapshot(reference, (snapshot) => {
    const assignment = snapshot.exists() ? parseProjectAssignment(snapshot.data()) : null;
    listener(assignment?.ownerId === verified.uid ? assignment : null);
  }, onError);
}

export async function subscribeToModuleActivationRequests(
  user: User,
  projectSlug: string,
  listener: (requests: Partial<Record<RequestedProjectModule, ModuleActivationRequest>>) => void,
  onError: () => void
) {
  requireVerifiedUser(user);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase project ownership is not configured.");
  const slug = normalizeProjectSlug(projectSlug);
  const reference = client.firestoreApi.collection(
    client.db,
    "projectAssignments",
    slug,
    "moduleRequests"
  );
  return client.firestoreApi.onSnapshot(reference, (snapshot) => {
    const requests: Partial<Record<RequestedProjectModule, ModuleActivationRequest>> = {};
    for (const document of snapshot.docs) {
      const module = PROJECT_MODULES.includes(document.id as RequestedProjectModule)
        ? document.id as RequestedProjectModule
        : null;
      if (!module) continue;
      const request = parseModuleActivationRequest(module, document.data());
      if (request) requests[module] = request;
    }
    listener(requests);
  }, onError);
}

export async function requestModuleActivation(
  user: User,
  projectSlug: string,
  module: RequestedProjectModule
) {
  const verified = requireVerifiedUser(user);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase project ownership is not configured.");
  const slug = normalizeProjectSlug(projectSlug);
  const assignmentReference = client.firestoreApi.doc(client.db, "projectAssignments", slug);
  const assignmentSnapshot = await client.firestoreApi.getDoc(assignmentReference);
  const assignment = assignmentSnapshot.exists()
    ? parseProjectAssignment(assignmentSnapshot.data())
    : null;
  if (!assignment || assignment.ownerId !== verified.uid) {
    throw new Error("This profile is not assigned to manage the project.");
  }
  if (!assignment.allowedModules.includes(module)) {
    throw new Error("That module was not included in the approved project application.");
  }
  const requestReference = client.firestoreApi.doc(assignmentReference, "moduleRequests", module);
  await client.firestoreApi.setDoc(requestReference, {
    schemaVersion: MODULE_ACTIVATION_REQUEST_SCHEMA_VERSION,
    module,
    status: "requested",
    requestedAt: client.firestoreApi.serverTimestamp(),
    updatedAt: client.firestoreApi.serverTimestamp()
  });
}

export async function updateProjectIdentity(
  user: User,
  project: PublicProjectRecord,
  value: ProjectIdentityDraft
) {
  const verified = requireVerifiedUser(user);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase project ownership is not configured.");
  const validationError = validateProjectIdentity(value);
  if (validationError) throw new Error(validationError);
  const identity = normalizeProjectIdentity(value);
  const projectReference = client.firestoreApi.doc(client.db, "projects", project.slug);
  const assignmentReference = client.firestoreApi.doc(client.db, "projectAssignments", project.slug);
  await client.firestoreApi.runTransaction(client.db, async (transaction) => {
    const [projectSnapshot, assignmentSnapshot] = await Promise.all([
      transaction.get(projectReference),
      transaction.get(assignmentReference)
    ]);
    const currentProject = projectSnapshot.exists() ? parsePublicProject(projectSnapshot.data()) : null;
    const assignment = assignmentSnapshot.exists() ? parseProjectAssignment(assignmentSnapshot.data()) : null;
    if (!currentProject || !assignment || assignment.ownerId !== verified.uid) {
      throw new Error("This profile is not assigned to manage the project.");
    }
    transaction.update(projectReference, {
      ...identity,
      updatedAt: client.firestoreApi.serverTimestamp()
    });
  });
}

export async function subscribeToAdminModuleActivationRequests(
  user: User,
  listener: (requests: AdminModuleActivationRequest[]) => void,
  onError: () => void
) {
  requireAdmin(user);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase project ownership is not configured.");
  const reference = client.firestoreApi.query(
    client.firestoreApi.collectionGroup(client.db, "moduleRequests"),
    client.firestoreApi.limit(100)
  );
  return client.firestoreApi.onSnapshot(reference, (snapshot) => {
    const requests = snapshot.docs.flatMap((document) => {
      const projectSlug = document.ref.parent.parent?.id ?? "";
      const module = PROJECT_MODULES.includes(document.id as RequestedProjectModule)
        ? document.id as RequestedProjectModule
        : null;
      if (!projectSlug || !module) return [];
      const request = parseModuleActivationRequest(module, document.data());
      return request ? [{ ...request, projectSlug }] : [];
    });
    const rank: Record<ModuleActivationRequestStatus, number> = {
      requested: 0,
      reviewing: 1,
      ready: 2,
      declined: 3
    };
    requests.sort((left, right) => rank[left.status] - rank[right.status]
      || left.projectSlug.localeCompare(right.projectSlug)
      || left.module.localeCompare(right.module));
    listener(requests);
  }, onError);
}

export async function reviewModuleActivationRequest(input: {
  admin: User;
  request: AdminModuleActivationRequest;
  status: Exclude<ModuleActivationRequestStatus, "requested">;
  reviewNote: string;
}) {
  requireAdmin(input.admin);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase project ownership is not configured.");
  const reviewNote = input.reviewNote.trim().slice(0, 600);
  if (input.status !== "reviewing" && reviewNote.length < 10) {
    throw new Error("Ready and declined decisions require a clear private review note.");
  }
  const reference = client.firestoreApi.doc(
    client.db,
    "projectAssignments",
    input.request.projectSlug,
    "moduleRequests",
    input.request.module
  );
  await client.firestoreApi.runTransaction(client.db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.exists()
      ? parseModuleActivationRequest(input.request.module, snapshot.data())
      : null;
    if (!current) throw new Error("The module request is no longer available.");
    const validTransition = input.status === "reviewing"
      ? current.status === "requested"
      : current.status === "reviewing";
    if (!validTransition) throw new Error("The module request changed. Refresh the review queue.");
    const now = client.firestoreApi.serverTimestamp();
    transaction.update(reference, {
      status: input.status,
      reviewNote,
      reviewedAt: now,
      updatedAt: now
    });
  });
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
  const assignmentReference = client.firestoreApi.doc(client.db, "projectAssignments", slug);
  await client.firestoreApi.runTransaction(client.db, async (transaction) => {
    const [currentApplicationSnapshot, existingProjectSnapshot, existingAssignmentSnapshot] = await Promise.all([
      transaction.get(applicationReference),
      transaction.get(projectReference),
      transaction.get(assignmentReference)
    ]);
    const currentApplication = currentApplicationSnapshot.exists()
      ? parseCreatorApplication(currentApplicationSnapshot.data())
      : null;
    if (!currentApplication || currentApplication.status !== "pending") {
      throw new Error("Only a currently pending application can be approved.");
    }
    if (existingProjectSnapshot.exists() || existingAssignmentSnapshot.exists()) {
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
      logoUri: "",
      bannerUri: "",
      tokenAddress: currentApplication.tokenAddress,
      availableModules: currentApplication.requestedModules,
      status: "live",
      publishedAt: now,
      updatedAt: now
    });
    transaction.set(assignmentReference, {
      schemaVersion: PROJECT_ASSIGNMENT_SCHEMA_VERSION,
      projectSlug: slug,
      ownerId: input.application.userId,
      allowedModules: currentApplication.requestedModules,
      createdAt: now,
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
