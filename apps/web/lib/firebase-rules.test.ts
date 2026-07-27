import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch
} from "firebase/firestore";

const PROJECT_ID = "rmt-rules-test";
const OWNER_ID = "owner-user";
const OTHER_ID = "other-user";
const ADMIN_ID = "rmt-admin";
const PROFILE = {
  displayName: "RMT Trader",
  handle: "runner_one",
  bio: "Watching liquidity and holder concentration.",
  traderMode: "scout",
  density: "focused"
};

let testEnvironment: RulesTestEnvironment;

function emulatorAddress() {
  const configured = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  const separator = configured.lastIndexOf(":");
  return {
    host: configured.slice(0, separator),
    port: Number(configured.slice(separator + 1))
  };
}

function authenticatedDb(userId = OWNER_ID, verified = true) {
  return testEnvironment.authenticatedContext(userId, {
    email: `${userId}@example.com`,
    email_verified: verified
  }).firestore();
}

function adminDb() {
  return testEnvironment.authenticatedContext(ADMIN_ID, {
    email: "launchrmt@gmail.com",
    email_verified: true
  }).firestore();
}

function userDocument(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    profile: PROFILE,
    profileUpdatedAt: 100,
    watchlistCount: 0,
    watchlistUpdatedAt: 100,
    updatedAt: serverTimestamp(),
    ...overrides
  };
}

function watchlistDocument(overrides: Record<string, unknown> = {}) {
  return {
    address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    name: "Runner One",
    symbol: "RUN",
    image: "ipfs://bafy-runner",
    launchId: "42",
    addedAt: 1_000,
    listUpdatedAt: 200,
    ...overrides
  };
}

function creatorApplication(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    projectName: "Runner Studio",
    summary: "A community studio creating transparent art, music, and token experiences for Robinhood Chain.",
    projectType: "community",
    website: "https://runner.example/",
    xProfile: "https://x.com/runner",
    tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    requestedModules: ["token", "nft"],
    ownershipConfirmed: true,
    termsAccepted: true,
    contactEmail: `${OWNER_ID}@example.com`,
    status: "pending",
    submittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides
  };
}

function publicProject(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    slug: "runner-studio",
    name: "Runner Studio",
    summary: "A community studio creating transparent art, music, and token experiences for Robinhood Chain.",
    projectType: "community",
    website: "https://runner.example/",
    xProfile: "https://x.com/runner",
    tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    availableModules: ["token", "nft"],
    status: "live",
    publishedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides
  };
}

function projectAssignment(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    projectSlug: "runner-studio",
    ownerId: OWNER_ID,
    allowedModules: ["token", "nft"],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides
  };
}

function moduleActivationRequest(module = "nft", overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    module,
    status: "requested",
    requestedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides
  };
}

async function seedOwner(db = authenticatedDb()) {
  await assertSucceeds(setDoc(doc(db, "users", OWNER_ID), userDocument()));
}

before(async () => {
  const { host, port } = emulatorAddress();
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host,
      port,
      rules: readFileSync(resolve(process.cwd(), "../../firestore.rules"), "utf8")
    }
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
});

after(async () => {
  await testEnvironment.cleanup();
});

test("verified owners can create, read, update, and delete their profile", async () => {
  const db = authenticatedDb();
  const reference = doc(db, "users", OWNER_ID);
  await assertSucceeds(setDoc(reference, userDocument()));
  assert.equal((await assertSucceeds(getDoc(reference))).data()?.profile.displayName, "RMT Trader");
  await assertSucceeds(setDoc(reference, {
    profile: { ...PROFILE, displayName: "Momentum Desk" },
    profileUpdatedAt: 200,
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertSucceeds(deleteDoc(reference));
});

test("signed-out, unverified, and different users cannot access an owner profile", async () => {
  await seedOwner();
  const anonymous = testEnvironment.unauthenticatedContext().firestore();
  const other = authenticatedDb(OTHER_ID);
  const unverified = authenticatedDb(OWNER_ID, false);
  await assertFails(getDoc(doc(anonymous, "users", OWNER_ID)));
  await assertFails(getDoc(doc(other, "users", OWNER_ID)));
  await assertFails(getDoc(doc(unverified, "users", OWNER_ID)));
  await assertFails(setDoc(doc(other, "users", OWNER_ID), userDocument()));
  await assertFails(deleteDoc(doc(other, "users", OWNER_ID)));
});

test("profile documents reject extra fields, invalid handles, and client timestamps", async () => {
  const db = authenticatedDb();
  await assertFails(setDoc(doc(db, "users", OWNER_ID), userDocument({ email: "stored@example.com" })));
  await assertFails(setDoc(doc(db, "users", OWNER_ID), userDocument({
    profile: { ...PROFILE, handle: "not.allowed" }
  })));
  await assertFails(setDoc(doc(db, "users", OWNER_ID), userDocument({
    updatedAt: Timestamp.fromMillis(1_000)
  })));
});

test("changing profile content requires a monotonic profile timestamp", async () => {
  const db = authenticatedDb();
  await seedOwner(db);
  const reference = doc(db, "users", OWNER_ID);
  await assertFails(setDoc(reference, {
    profile: { ...PROFILE, displayName: "Changed without version" },
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(setDoc(reference, {
    profile: { ...PROFILE, displayName: "Older write" },
    profileUpdatedAt: 99,
    updatedAt: serverTimestamp()
  }, { merge: true }));
});

test("a valid watchlist batch is private and can be removed with a newer list version", async () => {
  const owner = authenticatedDb();
  await seedOwner(owner);
  const ownerReference = doc(owner, "users", OWNER_ID);
  const slotReference = doc(ownerReference, "watchlist", "00");
  const addBatch = writeBatch(owner);
  addBatch.set(ownerReference, {
    watchlistCount: 1,
    watchlistUpdatedAt: 200,
    updatedAt: serverTimestamp()
  }, { merge: true });
  addBatch.set(slotReference, watchlistDocument());
  await assertSucceeds(addBatch.commit());
  await assertSucceeds(getDoc(slotReference));
  await assertFails(getDoc(doc(authenticatedDb(OTHER_ID), "users", OWNER_ID, "watchlist", "00")));

  const idempotentReload = writeBatch(owner);
  idempotentReload.set(ownerReference, userDocument({
    watchlistCount: 1,
    watchlistUpdatedAt: 200
  }), { merge: true });
  idempotentReload.set(slotReference, watchlistDocument());
  await assertSucceeds(idempotentReload.commit());

  const removeBatch = writeBatch(owner);
  removeBatch.set(ownerReference, {
    watchlistCount: 0,
    watchlistUpdatedAt: 300,
    updatedAt: serverTimestamp()
  }, { merge: true });
  removeBatch.delete(slotReference);
  await assertSucceeds(removeBatch.commit());
});

test("the owner can migrate the prepared legacy document without retaining email or list blobs", async () => {
  const { listUpdatedAt: _legacyVersion, ...legacyEntry } = watchlistDocument();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", OWNER_ID), {
      profile: PROFILE,
      watchlist: [legacyEntry],
      email: "legacy@example.com",
      updatedAt: Timestamp.fromMillis(100)
    });
  });

  const db = authenticatedDb();
  const ownerReference = doc(db, "users", OWNER_ID);
  const migration = writeBatch(db);
  migration.set(ownerReference, {
    ...userDocument({
      profileUpdatedAt: 100,
      watchlistCount: 1,
      watchlistUpdatedAt: 100
    }),
    email: deleteField(),
    watchlist: deleteField()
  }, { merge: true });
  migration.set(doc(ownerReference, "watchlist", "00"), watchlistDocument({ listUpdatedAt: 100 }));
  await assertSucceeds(migration.commit());
  const migrated = (await getDoc(ownerReference)).data();
  assert.equal("email" in (migrated ?? {}), false);
  assert.equal("watchlist" in (migrated ?? {}), false);
});

test("watchlist slots enforce the 50-item boundary and validate every token record", async () => {
  const db = authenticatedDb();
  await seedOwner(db);
  const userReference = doc(db, "users", OWNER_ID);

  const invalidSlotBatch = writeBatch(db);
  invalidSlotBatch.set(userReference, {
    watchlistCount: 1,
    watchlistUpdatedAt: 200,
    updatedAt: serverTimestamp()
  }, { merge: true });
  invalidSlotBatch.set(doc(userReference, "watchlist", "50"), watchlistDocument());
  await assertFails(invalidSlotBatch.commit());

  const invalidEntryBatch = writeBatch(db);
  invalidEntryBatch.set(userReference, {
    watchlistCount: 1,
    watchlistUpdatedAt: 200,
    updatedAt: serverTimestamp()
  }, { merge: true });
  invalidEntryBatch.set(doc(userReference, "watchlist", "00"), watchlistDocument({
    address: "0xNOT_AN_ADDRESS",
    image: "javascript:alert(1)"
  }));
  await assertFails(invalidEntryBatch.commit());

  await assertFails(setDoc(userReference, {
    watchlistCount: 51,
    watchlistUpdatedAt: 200,
    updatedAt: serverTimestamp()
  }, { merge: true }));
});

test("watchlist records cannot change without advancing the parent list version", async () => {
  const db = authenticatedDb();
  await seedOwner(db);
  const userReference = doc(db, "users", OWNER_ID);
  const slotReference = doc(userReference, "watchlist", "00");
  const addBatch = writeBatch(db);
  addBatch.set(userReference, {
    watchlistCount: 1,
    watchlistUpdatedAt: 200,
    updatedAt: serverTimestamp()
  }, { merge: true });
  addBatch.set(slotReference, watchlistDocument());
  await assertSucceeds(addBatch.commit());
  await assertFails(setDoc(slotReference, watchlistDocument({ name: "Silent rewrite" })));
});

test("unrelated collections remain closed", async () => {
  const db = authenticatedDb();
  await assertFails(setDoc(doc(db, "publicProfiles", OWNER_ID), { displayName: "Public" }));
});

test("verified owners can submit one private creator application", async () => {
  const owner = authenticatedDb();
  await seedOwner(owner);
  const reference = doc(owner, "creatorApplications", OWNER_ID);
  await assertSucceeds(setDoc(reference, creatorApplication()));
  assert.equal((await assertSucceeds(getDoc(reference))).data()?.status, "pending");
  await assertFails(getDoc(doc(authenticatedDb(OTHER_ID), "creatorApplications", OWNER_ID)));
  await assertFails(getDoc(doc(testEnvironment.unauthenticatedContext().firestore(), "creatorApplications", OWNER_ID)));
  await assertFails(setDoc(reference, creatorApplication({ projectName: "Silent pending edit" })));
});

test("a creator application requires an initialized private profile", async () => {
  const owner = authenticatedDb();
  await assertFails(setDoc(doc(owner, "creatorApplications", OWNER_ID), creatorApplication()));
});

test("creator application identity and questionnaire fields are strictly validated", async () => {
  const owner = authenticatedDb();
  await seedOwner(owner);
  const reference = doc(owner, "creatorApplications", OWNER_ID);
  await assertFails(setDoc(reference, creatorApplication({ contactEmail: "someone-else@example.com" })));
  await assertFails(setDoc(reference, creatorApplication({ status: "approved", projectSlug: "self-approved" })));
  await assertFails(setDoc(reference, creatorApplication({ requestedModules: [] })));
  await assertFails(setDoc(reference, creatorApplication({ requestedModules: ["token"], tokenAddress: "" })));
  await assertFails(setDoc(reference, creatorApplication({ website: "javascript:alert(1)" })));
  await assertFails(setDoc(reference, creatorApplication({ internalAdminNote: "leak" })));
  await assertFails(setDoc(
    doc(authenticatedDb(OWNER_ID, false), "creatorApplications", OWNER_ID),
    creatorApplication()
  ));
});

test("only the verified RMT account can review and owners may resubmit only after changes are requested", async () => {
  const owner = authenticatedDb();
  await seedOwner(owner);
  const ownerReference = doc(owner, "creatorApplications", OWNER_ID);
  await assertSucceeds(setDoc(ownerReference, creatorApplication()));

  const admin = adminDb();
  const adminReference = doc(admin, "creatorApplications", OWNER_ID);
  await assertSucceeds(getDoc(adminReference));
  await assertSucceeds(getDocs(collection(admin, "creatorApplications")));
  await assertSucceeds(setDoc(adminReference, {
    status: "needs_changes",
    reviewNote: "Please clarify the rights attached to the proposed NFT collection.",
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(setDoc(adminReference, {
    status: "approved",
    reviewNote: "Attempted approval before the creator resubmitted requested changes.",
    projectSlug: "runner-studio",
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true }));

  const reviewed = (await getDoc(ownerReference)).data();
  await assertSucceeds(setDoc(ownerReference, creatorApplication({
    summary: "A community studio creating transparent art, music, and token experiences with clarified NFT rights.",
    submittedAt: reviewed?.submittedAt
  })));
  await assertFails(setDoc(ownerReference, creatorApplication({
    projectName: "Second silent edit",
    submittedAt: reviewed?.submittedAt
  })));
});

test("approval atomically publishes a public record without exposing the private application", async () => {
  const owner = authenticatedDb();
  await seedOwner(owner);
  await assertSucceeds(setDoc(doc(owner, "creatorApplications", OWNER_ID), creatorApplication()));

  const admin = adminDb();
  const batch = writeBatch(admin);
  batch.set(doc(admin, "projects", "runner-studio"), publicProject());
  batch.set(doc(admin, "projectAssignments", "runner-studio"), projectAssignment());
  batch.set(doc(admin, "creatorApplications", OWNER_ID), {
    status: "approved",
    reviewNote: "Project page approved after identity and public information review.",
    projectSlug: "runner-studio",
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  await assertSucceeds(batch.commit());

  const anonymous = testEnvironment.unauthenticatedContext().firestore();
  assert.equal((await assertSucceeds(getDoc(doc(anonymous, "projects", "runner-studio")))).data()?.name, "Runner Studio");
  assert.equal((await assertSucceeds(getDocs(query(
    collection(anonymous, "projects"),
    where("status", "==", "live")
  )))).size, 1);
  await assertFails(getDocs(collection(anonymous, "projects")));
  await assertFails(getDoc(doc(anonymous, "creatorApplications", OWNER_ID)));
  await assertFails(getDoc(doc(anonymous, "projectAssignments", "runner-studio")));
});

test("non-admin users cannot publish, alter, or remove public projects", async () => {
  const owner = authenticatedDb();
  await assertFails(setDoc(doc(owner, "projects", "runner-studio"), publicProject()));

  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "projects", "runner-studio"), {
      ...publicProject(),
      publishedAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
  });
  await assertFails(setDoc(doc(owner, "projects", "runner-studio"), publicProject({ name: "Hijacked" })));
  await assertFails(deleteDoc(doc(owner, "projects", "runner-studio")));
});

test("an assigned creator can update public identity but not project authority", async () => {
  const admin = adminDb();
  const seed = writeBatch(admin);
  seed.set(doc(admin, "projects", "runner-studio"), publicProject());
  seed.set(doc(admin, "projectAssignments", "runner-studio"), projectAssignment());
  await assertSucceeds(seed.commit());

  const owner = authenticatedDb();
  const project = doc(owner, "projects", "runner-studio");
  await assertSucceeds(setDoc(project, {
    name: "Runner Studio Labs",
    summary: "A creator-managed project home for transparent art, music, market tools, and community experiments.",
    website: "https://runner.example/studio",
    xProfile: "https://x.com/runnerstudio",
    logoUri: "ipfs://bafybeigdyrzt/logo.png",
    bannerUri: "https://cdn.example/runner-banner.webp",
    updatedAt: serverTimestamp()
  }, { merge: true }));
  const saved = (await assertSucceeds(getDoc(project))).data();
  assert.equal(saved?.name, "Runner Studio Labs");
  assert.equal(saved?.logoUri, "ipfs://bafybeigdyrzt/logo.png");

  await assertFails(setDoc(project, {
    logoUri: "javascript:alert(1)",
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(setDoc(project, {
    tokenAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(setDoc(project, {
    availableModules: ["token", "nft", "music"],
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(setDoc(project, {
    status: "paused",
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(setDoc(
    doc(authenticatedDb(OTHER_ID), "projects", "runner-studio"),
    { name: "Impostor project", updatedAt: serverTimestamp() },
    { merge: true }
  ));
});

test("only the assigned creator and RMT admin can read a private project assignment", async () => {
  const admin = adminDb();
  await assertSucceeds(setDoc(doc(admin, "projectAssignments", "runner-studio"), projectAssignment()));

  const owner = authenticatedDb();
  assert.equal(
    (await assertSucceeds(getDoc(doc(owner, "projectAssignments", "runner-studio")))).data()?.ownerId,
    OWNER_ID
  );
  await assertFails(getDoc(doc(authenticatedDb(OTHER_ID), "projectAssignments", "runner-studio")));
  await assertFails(getDoc(doc(testEnvironment.unauthenticatedContext().firestore(), "projectAssignments", "runner-studio")));
  await assertFails(setDoc(
    doc(owner, "projectAssignments", "runner-studio"),
    projectAssignment({ allowedModules: ["token", "nft", "music"] })
  ));
});

test("an assigned creator can request only approved modules and cannot self-approve them", async () => {
  const admin = adminDb();
  await assertSucceeds(setDoc(doc(admin, "projectAssignments", "runner-studio"), projectAssignment()));

  const owner = authenticatedDb();
  const nftRequest = doc(owner, "projectAssignments", "runner-studio", "moduleRequests", "nft");
  await assertSucceeds(setDoc(nftRequest, moduleActivationRequest()));
  await assertFails(setDoc(
    doc(owner, "projectAssignments", "runner-studio", "moduleRequests", "music"),
    moduleActivationRequest("music")
  ));
  await assertFails(setDoc(
    doc(owner, "projectAssignments", "runner-studio", "moduleRequests", "token"),
    moduleActivationRequest("token", { status: "ready" })
  ));
  await assertFails(setDoc(nftRequest, moduleActivationRequest("nft", { status: "ready" })));
  await assertFails(setDoc(
    doc(authenticatedDb(OTHER_ID), "projectAssignments", "runner-studio", "moduleRequests", "nft"),
    moduleActivationRequest()
  ));
});

test("RMT admin must review a module request before marking it ready", async () => {
  const admin = adminDb();
  await assertSucceeds(setDoc(doc(admin, "projectAssignments", "runner-studio"), projectAssignment()));
  const owner = authenticatedDb();
  await assertSucceeds(setDoc(
    doc(owner, "projectAssignments", "runner-studio", "moduleRequests", "nft"),
    moduleActivationRequest()
  ));

  assert.equal((await assertSucceeds(getDocs(collectionGroup(admin, "moduleRequests")))).size, 1);
  const adminRequest = doc(admin, "projectAssignments", "runner-studio", "moduleRequests", "nft");
  await assertSucceeds(setDoc(adminRequest, {
    status: "reviewing",
    reviewNote: "",
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(setDoc(adminRequest, {
    status: "ready",
    reviewNote: "Too short",
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertSucceeds(setDoc(adminRequest, {
    status: "ready",
    reviewNote: "Rights and configuration review completed; explicit setup is still required.",
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true }));
  assert.match(
    (await assertSucceeds(getDoc(doc(owner, "projectAssignments", "runner-studio", "moduleRequests", "nft")))).data()?.reviewNote,
    /explicit setup/
  );
  await assertFails(setDoc(adminRequest, {
    status: "reviewing",
    reviewNote: "",
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true }));
});
