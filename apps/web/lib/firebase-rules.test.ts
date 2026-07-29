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
  increment,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch
} from "firebase/firestore";
import { hashCreatorAssetDraft, type CreatorAssetDraft } from "./creator-assets";

const PROJECT_ID = "rmt-rules-test";
const OWNER_ID = "owner-user";
const OTHER_ID = "other-user";
const THIRD_ID = "third-user";
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

function gameUpdate(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    type: "milestone",
    title: "Public alpha is ready",
    body: "The first public alpha adds cooperative matchmaking and a new tutorial.",
    version: "v0.3.0",
    link: "https://runner.example/alpha",
    imageUri: "https://media.runner.example/alpha.webp",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides
  };
}

function creatorAsset(overrides: Record<string, unknown> = {}) {
  const data = {
    schemaVersion: 1,
    assetId: "abcdefghijklmnopqrst",
    projectSlug: "runner-studio",
    assetType: "artwork",
    title: "Neon Robin",
    description: "An original AI-assisted artwork prepared for the RMT creator ecosystem.",
    primaryMediaUri: "ipfs://bafy-neon-robin",
    previewMediaUri: "https://media.runner.example/neon-robin.webp",
    creationMethod: "ai_assisted",
    aiTools: ["OpenAI"],
    aiDisclosure: "AI assisted with early composition studies; the creator selected and finished the final work.",
    rightsBasis: "original",
    rightsStatement: "The project creator produced the final work and controls the rights required for this draft.",
    rightsConfirmed: true,
    containsThirdPartyMaterial: false,
    thirdPartyRightsConfirmed: false,
    license: "all_rights_reserved",
    licenseUri: "",
    secondaryRoyaltyBps: 500,
    editionMode: "limited",
    editionSupply: 100,
    musicReleaseType: "single",
    explicitContent: false,
    masterRightsConfirmed: false,
    compositionRightsConfirmed: false,
    collaborators: [{
      name: "RMT Studio",
      role: "artist",
      walletAddress: "",
      consentStatus: "unverified"
    }],
    revenueSplits: [{
      label: "RMT Studio",
      walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      shareBps: 10000
    }],
    collaboratorConsentStatus: "unverified",
    status: "draft",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides
  };
  const revenueSplitTotalBps = "revenueSplitTotalBps" in overrides
    ? overrides.revenueSplitTotalBps
    : Array.isArray(data.revenueSplits)
      ? data.revenueSplits.reduce((total, split) => (
          total + (
            typeof split === "object"
            && split
            && "shareBps" in split
            && typeof split.shareBps === "number"
              ? split.shareBps
              : 0
          )
      ), 0)
      : 0;
  return {
    ...data,
    revenueSplitTotalBps,
    draftRevisionHash: "draftRevisionHash" in overrides
      ? overrides.draftRevisionHash
      : hashCreatorAssetDraft(data as unknown as CreatorAssetDraft)
  };
}

function creatorConsentInvitation(
  invitationId: string,
  draftRevisionHash: unknown,
  overrides: Record<string, unknown> = {}
) {
  return {
    schemaVersion: 1,
    invitationId,
    invitationDigest: `0x${invitationId}`,
    projectSlug: "runner-studio",
    assetId: "abcdefghijklmnopqrst",
    draftRevisionHash,
    collaboratorName: "RMT Studio",
    collaboratorRole: "artist",
    collaboratorWallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    shareBps: 10000,
    chainId: 4663,
    expiresAt: 2_000_000_000,
    termsHash: `0x${"1".repeat(64)}`,
    nonce: `0x${"2".repeat(64)}`,
    status: "pending",
    revokedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides
  };
}

function creatorConsentPublicStatus(
  invitationId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    schemaVersion: 1,
    invitationId,
    invitationDigest: `0x${invitationId}`,
    projectSlug: "runner-studio",
    assetId: "abcdefghijklmnopqrst",
    status: "pending",
    expiresAt: 2_000_000_000,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides
  };
}

function projectFollow(projectSlug = "runner-studio") {
  return {
    schemaVersion: 1,
    projectSlug,
    followedAt: serverTimestamp()
  };
}

function projectStats(projectSlug = "runner-studio", followerCount = 1) {
  return {
    schemaVersion: 1,
    projectSlug,
    followerCount,
    updatedAt: serverTimestamp()
  };
}

function referralCode(code = "RMT-ABCDEFGH", ownerId = OWNER_ID, verifiedActivations = 0) {
  return {
    schemaVersion: 1,
    code,
    ownerId,
    verifiedActivations,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

function referralProfile(code = "RMT-ABCDEFGH") {
  return {
    schemaVersion: 1,
    code,
    createdAt: serverTimestamp()
  };
}

function referralClaim(code = "RMT-ABCDEFGH") {
  return {
    schemaVersion: 1,
    code,
    claimedAt: serverTimestamp()
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
    identityUpdatedAt: serverTimestamp(),
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

test("identity edits allow setup and correction, then enforce the 24 hour protection period", async () => {
  const db = authenticatedDb();
  const reference = doc(db, "users", OWNER_ID);

  await assertSucceeds(setDoc(reference, userDocument({ identityUpdatedAt: 0 })));
  await assertSucceeds(setDoc(reference, {
    profile: { ...PROFILE, displayName: "First Identity" },
    profileUpdatedAt: 200,
    identityUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertSucceeds(setDoc(reference, {
    profile: { ...PROFILE, displayName: "Correction Window" },
    profileUpdatedAt: 300,
    identityUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true }));

  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", OWNER_ID), userDocument({
      identityUpdatedAt: Timestamp.fromMillis(Date.now() - 11 * 60 * 1_000)
    }));
  });
  await assertFails(setDoc(reference, {
    profile: { ...PROFILE, displayName: "Too Soon" },
    profileUpdatedAt: 400,
    identityUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertSucceeds(setDoc(reference, {
    profile: { ...PROFILE, traderMode: "momentum" },
    profileUpdatedAt: 400,
    updatedAt: serverTimestamp()
  }, { merge: true }));

  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", OWNER_ID), userDocument({
      identityUpdatedAt: Timestamp.fromMillis(Date.now() - 25 * 60 * 60 * 1_000)
    }));
  });
  await assertSucceeds(setDoc(reference, {
    profile: { ...PROFILE, displayName: "Unlocked Again" },
    profileUpdatedAt: 500,
    identityUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true }));
});

test("referral codes are permanent, private to their owner, and created atomically", async () => {
  const owner = authenticatedDb();
  await seedOwner(owner);
  const code = "RMT-ABCDEFGH";
  const codeReference = doc(owner, "referralCodes", code);
  const profileReference = doc(owner, "users", OWNER_ID, "referralProfile", "current");

  await assertFails(setDoc(codeReference, referralCode(code)));
  const batch = writeBatch(owner);
  batch.set(profileReference, referralProfile(code));
  batch.set(codeReference, referralCode(code));
  await assertSucceeds(batch.commit());
  assert.equal((await assertSucceeds(getDoc(codeReference))).data()?.verifiedActivations, 0);
  await assertFails(getDoc(doc(authenticatedDb(OTHER_ID), "referralCodes", code)));
  await assertFails(deleteDoc(profileReference));
  await assertFails(setDoc(profileReference, referralProfile("RMT-JKLMNPQR")));
});

test("a verified referred profile can activate one code exactly once", async () => {
  const owner = authenticatedDb();
  const referred = authenticatedDb(OTHER_ID);
  await seedOwner(owner);
  await assertSucceeds(setDoc(doc(referred, "users", OTHER_ID), userDocument({
    identityUpdatedAt: serverTimestamp()
  })));
  const code = "RMT-ABCDEFGH";
  const codeReference = doc(owner, "referralCodes", code);
  const ownerBatch = writeBatch(owner);
  ownerBatch.set(doc(owner, "users", OWNER_ID, "referralProfile", "current"), referralProfile(code));
  ownerBatch.set(codeReference, referralCode(code));
  await assertSucceeds(ownerBatch.commit());

  const directIncrement = writeBatch(referred);
  directIncrement.update(doc(referred, "referralCodes", code), {
    verifiedActivations: increment(1),
    updatedAt: serverTimestamp()
  });
  await assertFails(directIncrement.commit());

  const activation = writeBatch(referred);
  activation.set(doc(referred, "users", OTHER_ID, "referralClaim", "current"), referralClaim(code));
  activation.update(doc(referred, "referralCodes", code), {
    verifiedActivations: increment(1),
    updatedAt: serverTimestamp()
  });
  await assertSucceeds(activation.commit());
  assert.equal((await assertSucceeds(getDoc(codeReference))).data()?.verifiedActivations, 1);

  const duplicate = writeBatch(referred);
  duplicate.set(doc(referred, "users", OTHER_ID, "referralClaim", "current"), referralClaim(code));
  duplicate.update(doc(referred, "referralCodes", code), {
    verifiedActivations: increment(1),
    updatedAt: serverTimestamp()
  });
  await assertFails(duplicate.commit());

  const selfClaim = writeBatch(owner);
  selfClaim.set(doc(owner, "users", OWNER_ID, "referralClaim", "current"), referralClaim(code));
  selfClaim.update(codeReference, {
    verifiedActivations: increment(1),
    updatedAt: serverTimestamp()
  });
  await assertFails(selfClaim.commit());

  const unprotected = authenticatedDb(THIRD_ID);
  await assertSucceeds(setDoc(doc(unprotected, "users", THIRD_ID), userDocument()));
  const unprotectedClaim = writeBatch(unprotected);
  unprotectedClaim.set(doc(unprotected, "users", THIRD_ID, "referralClaim", "current"), referralClaim(code));
  unprotectedClaim.update(doc(unprotected, "referralCodes", code), {
    verifiedActivations: increment(1),
    updatedAt: serverTimestamp()
  });
  await assertFails(unprotectedClaim.commit());

  const unverified = authenticatedDb(THIRD_ID, false);
  await assertFails(setDoc(doc(unverified, "users", THIRD_ID, "referralClaim", "current"), referralClaim(code)));
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

test("gaming creators can publish a bounded game showcase", async () => {
  const admin = adminDb();
  const seed = writeBatch(admin);
  seed.set(doc(admin, "projects", "runner-game"), publicProject({
    slug: "runner-game",
    projectType: "gaming",
    tokenAddress: "",
    availableModules: ["game"],
    gameUrl: "",
    trailerUrl: "",
    gameStatus: "development",
    gamePlatforms: []
  }));
  seed.set(doc(admin, "projectAssignments", "runner-game"), projectAssignment({
    projectSlug: "runner-game",
    allowedModules: ["game"]
  }));
  await assertSucceeds(seed.commit());

  const owner = authenticatedDb();
  const project = doc(owner, "projects", "runner-game");
  await assertSucceeds(setDoc(project, {
    gameUrl: "https://play.runner.example/",
    trailerUrl: "https://video.runner.example/trailer",
    gameStatus: "playable",
    gamePlatforms: ["web", "windows", "macos"],
    gameGenre: "adventure",
    gameModes: ["single-player", "co-op"],
    gameReleaseDate: "2026-11-14",
    gameMediaUris: [
      "https://media.runner.example/gameplay-one.webp",
      "ipfs://bafybeigameplaytwo/screenshot.png"
    ],
    updatedAt: serverTimestamp()
  }, { merge: true }));
  assert.equal((await assertSucceeds(getDoc(project))).data()?.gameStatus, "playable");
  assert.equal((await assertSucceeds(getDoc(project))).data()?.gameGenre, "adventure");
  await assertFails(setDoc(project, {
    gamePlatforms: ["web", "unknown-device"],
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(setDoc(project, {
    gameUrl: "javascript:alert(1)",
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(setDoc(project, {
    gameGenre: "casino-extraction",
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(setDoc(project, {
    gameModes: ["single-player", "unauthorized-mode"],
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(setDoc(project, {
    gameReleaseDate: "2026-13-45",
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(setDoc(project, {
    gameMediaUris: ["javascript:alert(1)"],
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(setDoc(project, {
    gameMediaUris: Array.from({ length: 7 }, (_, index) => `https://media.runner.example/${index}.webp`),
    updatedAt: serverTimestamp()
  }, { merge: true }));

  await assertSucceeds(setDoc(
    doc(owner, "projectAssignments", "runner-game", "moduleRequests", "game"),
    moduleActivationRequest("game")
  ));
});

test("assigned game creators can publish bounded public development updates", async () => {
  const admin = adminDb();
  const seed = writeBatch(admin);
  seed.set(doc(admin, "projects", "runner-game"), publicProject({
    slug: "runner-game",
    projectType: "gaming",
    tokenAddress: "",
    availableModules: ["game"],
    gameStatus: "development"
  }));
  seed.set(doc(admin, "projectAssignments", "runner-game"), projectAssignment({
    projectSlug: "runner-game",
    allowedModules: ["game"]
  }));
  await assertSucceeds(seed.commit());

  const owner = authenticatedDb();
  const update = doc(owner, "projects", "runner-game", "gameUpdates", "alpha-release");
  await assertSucceeds(setDoc(update, gameUpdate()));
  await assertSucceeds(getDoc(doc(
    testEnvironment.unauthenticatedContext().firestore(),
    "projects",
    "runner-game",
    "gameUpdates",
    "alpha-release"
  )));
  await assertFails(setDoc(
    doc(authenticatedDb(OTHER_ID), "projects", "runner-game", "gameUpdates", "impostor-update"),
    gameUpdate()
  ));
  await assertFails(setDoc(
    doc(owner, "projects", "runner-game", "gameUpdates", "unsafe-link"),
    gameUpdate({ link: "javascript:alert(1)" })
  ));
  await assertFails(setDoc(
    doc(owner, "projects", "runner-game", "gameUpdates", "short-body"),
    gameUpdate({ body: "Too short" })
  ));
  await assertFails(setDoc(
    doc(owner, "projects", "runner-game", "gameUpdates", "extra-field"),
    gameUpdate({ treasuryAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })
  ));
});

test("project follows stay private while atomic public audience counts resist tampering", async () => {
  const owner = authenticatedDb();
  await seedOwner(owner);
  await assertSucceeds(setDoc(
    doc(adminDb(), "projects", "runner-studio"),
    publicProject()
  ));
  const follow = doc(owner, "users", OWNER_ID, "projectFollows", "runner-studio");
  const stats = doc(owner, "projectStats", "runner-studio");
  const add = writeBatch(owner);
  add.set(follow, projectFollow());
  add.set(stats, projectStats());
  await assertSucceeds(add.commit());

  assert.equal((await assertSucceeds(getDoc(stats))).data()?.followerCount, 1);
  assert.equal((await assertSucceeds(getDoc(doc(
    testEnvironment.unauthenticatedContext().firestore(),
    "projectStats",
    "runner-studio"
  )))).data()?.followerCount, 1);
  assert.equal((await assertSucceeds(getDocs(collection(
    owner,
    "users",
    OWNER_ID,
    "projectFollows"
  )))).size, 1);
  await assertFails(getDoc(doc(
    authenticatedDb(OTHER_ID),
    "users",
    OWNER_ID,
    "projectFollows",
    "runner-studio"
  )));
  await assertFails(getDocs(collection(
    authenticatedDb(OTHER_ID),
    "users",
    OWNER_ID,
    "projectFollows"
  )));
  await assertFails(getDocs(collection(
    testEnvironment.unauthenticatedContext().firestore(),
    "users",
    OWNER_ID,
    "projectFollows"
  )));
  await assertFails(setDoc(stats, {
    followerCount: 2,
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(setDoc(
    doc(owner, "users", OWNER_ID, "projectFollows", "runner-studio-copy"),
    projectFollow("runner-studio-copy")
  ));

  const remove = writeBatch(owner);
  remove.delete(follow);
  remove.update(stats, {
    followerCount: 0,
    updatedAt: serverTimestamp()
  });
  await assertSucceeds(remove.commit());
  assert.equal((await assertSucceeds(getDoc(stats))).data()?.followerCount, 0);
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

test("assigned creators can privately manage valid asset and rights drafts", async () => {
  const admin = adminDb();
  await assertSucceeds(setDoc(doc(admin, "projectAssignments", "runner-studio"), projectAssignment()));
  const owner = authenticatedDb();
  const reference = doc(owner, "projectAssignments", "runner-studio", "assets", "abcdefghijklmnopqrst");
  await assertSucceeds(setDoc(reference, creatorAsset()));
  const stored = (await assertSucceeds(getDoc(reference))).data();
  assert.equal(stored?.status, "draft");
  assert.equal(stored?.revenueSplits[0].shareBps, 10000);

  await assertFails(getDoc(doc(
    authenticatedDb(OTHER_ID),
    "projectAssignments",
    "runner-studio",
    "assets",
    "abcdefghijklmnopqrst"
  )));
  await assertFails(getDoc(doc(
    testEnvironment.unauthenticatedContext().firestore(),
    "projectAssignments",
    "runner-studio",
    "assets",
    "abcdefghijklmnopqrst"
  )));
  await assertSucceeds(getDoc(doc(
    admin,
    "projectAssignments",
    "runner-studio",
    "assets",
    "abcdefghijklmnopqrst"
  )));
  await assertSucceeds(setDoc(
    doc(owner, "projectAssignments", "runner-studio", "assets", "maximumassetdraft123"),
    creatorAsset({
      assetId: "maximumassetdraft123",
      collaborators: [
        { name: "Artist One", role: "artist", walletAddress: "", consentStatus: "unverified" },
        { name: "Artist Two", role: "producer", walletAddress: "", consentStatus: "unverified" },
        { name: "Artist Three", role: "songwriter", walletAddress: "", consentStatus: "unverified" },
        { name: "Artist Four", role: "performer", walletAddress: "", consentStatus: "unverified" }
      ],
      revenueSplits: [
        { label: "Recipient One", walletAddress: "0x1111111111111111111111111111111111111111", shareBps: 2500 },
        { label: "Recipient Two", walletAddress: "0x2222222222222222222222222222222222222222", shareBps: 2500 },
        { label: "Recipient Three", walletAddress: "0x3333333333333333333333333333333333333333", shareBps: 2500 },
        { label: "Recipient Four", walletAddress: "0x4444444444444444444444444444444444444444", shareBps: 2500 }
      ]
    })
  ));

  await assertSucceeds(setDoc(reference, creatorAsset({
    description: "An updated private rights draft that remains unavailable to public marketplace discovery.",
    createdAt: stored?.createdAt,
    updatedAt: serverTimestamp()
  })));
  await assertFails(deleteDoc(doc(
    authenticatedDb(OTHER_ID),
    "projectAssignments",
    "runner-studio",
    "assets",
    "abcdefghijklmnopqrst"
  )));
  await assertSucceeds(deleteDoc(reference));
});

test("asset drafts fail closed on rights, consent, edition, and split violations", async () => {
  const admin = adminDb();
  await assertSucceeds(setDoc(doc(admin, "projectAssignments", "runner-studio"), projectAssignment()));
  const owner = authenticatedDb();
  const reference = (id: string) => doc(owner, "projectAssignments", "runner-studio", "assets", id);

  await assertFails(setDoc(reference("aaaaaaaaaaaaaaaaaaaa"), creatorAsset({
    assetId: "aaaaaaaaaaaaaaaaaaaa",
    rightsConfirmed: false
  })));
  await assertFails(setDoc(reference("bbbbbbbbbbbbbbbbbbbb"), creatorAsset({
    assetId: "bbbbbbbbbbbbbbbbbbbb",
    collaboratorConsentStatus: "accepted",
    collaborators: [{
      name: "Unverified Artist",
      role: "artist",
      walletAddress: "",
      consentStatus: "accepted"
    }]
  })));
  await assertFails(setDoc(reference("cccccccccccccccccccc"), creatorAsset({
    assetId: "cccccccccccccccccccc",
    editionMode: "one_of_one",
    editionSupply: 2
  })));
  await assertFails(setDoc(reference("dddddddddddddddddddd"), creatorAsset({
    assetId: "dddddddddddddddddddd",
    revenueSplits: [
      {
        label: "Artist",
        walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        shareBps: 6000
      },
      {
        label: "Producer",
        walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        shareBps: 3000
      }
    ]
  })));
  await assertFails(setDoc(reference("eeeeeeeeeeeeeeeeeeee"), creatorAsset({
    assetId: "eeeeeeeeeeeeeeeeeeee",
    draftRevisionHash: "not-a-revision-hash"
  })));
  await assertFails(setDoc(reference("ffffffffffffffffffff"), creatorAsset({
    assetId: "ffffffffffffffffffff",
    status: "published"
  })));
  await assertFails(setDoc(reference("royaltyabovemaximum1"), creatorAsset({
    assetId: "royaltyabovemaximum1",
    secondaryRoyaltyBps: 1001
  })));
  await assertFails(setDoc(reference("royaltybelowminimum1"), creatorAsset({
    assetId: "royaltybelowminimum1",
    secondaryRoyaltyBps: -1
  })));
});

test("music rights drafts require an approved music module and both music rights confirmations", async () => {
  const admin = adminDb();
  const assignmentReference = doc(admin, "projectAssignments", "runner-studio");
  await assertSucceeds(setDoc(assignmentReference, projectAssignment()));
  const assignmentCreatedAt = (await assertSucceeds(getDoc(assignmentReference))).data()?.createdAt;
  const owner = authenticatedDb();
  const reference = doc(owner, "projectAssignments", "runner-studio", "assets", "musicmusicmusicmusic");
  const music = creatorAsset({
    assetId: "musicmusicmusicmusic",
    assetType: "music_release",
    title: "Chain Signals",
    description: "An original music single prepared for a future creator-controlled release.",
    primaryMediaUri: "ipfs://bafy-chain-signals",
    creationMethod: "human",
    aiTools: [],
    aiDisclosure: "",
    masterRightsConfirmed: true,
    compositionRightsConfirmed: true
  });
  await assertFails(setDoc(reference, music));
  await assertSucceeds(setDoc(assignmentReference, projectAssignment({
    allowedModules: ["token", "nft", "music"],
    createdAt: assignmentCreatedAt,
    updatedAt: serverTimestamp()
  })));
  await assertSucceeds(setDoc(reference, music));
  await assertFails(setDoc(
    doc(owner, "projectAssignments", "runner-studio", "assets", "musicnomasterrights1"),
    creatorAsset({
      assetId: "musicnomasterrights1",
      assetType: "music_release",
      title: "Missing rights",
      primaryMediaUri: "ipfs://bafy-missing-rights",
      creationMethod: "human",
      aiTools: [],
      aiDisclosure: "",
      masterRightsConfirmed: false,
      compositionRightsConfirmed: true
    })
  ));
});

test("creator consent invitations remain private, revision-bound, and creator-revocable", async () => {
  const admin = adminDb();
  await assertSucceeds(setDoc(doc(admin, "projectAssignments", "runner-studio"), projectAssignment()));
  const owner = authenticatedDb();
  const assetReference = doc(owner, "projectAssignments", "runner-studio", "assets", "abcdefghijklmnopqrst");
  const asset = creatorAsset();
  await assertSucceeds(setDoc(assetReference, asset));
  const invitationId = "6".repeat(64);
  const invitationReference = doc(assetReference, "consentInvitations", invitationId);
  const statusReference = doc(owner, "creatorConsentStatuses", invitationId);
  const createBatch = writeBatch(owner);
  createBatch.set(invitationReference, creatorConsentInvitation(invitationId, asset.draftRevisionHash));
  createBatch.set(statusReference, creatorConsentPublicStatus(invitationId));
  await assertSucceeds(createBatch.commit());
  await assertSucceeds(getDoc(invitationReference));
  await assertSucceeds(getDoc(doc(
    testEnvironment.unauthenticatedContext().firestore(),
    "creatorConsentStatuses",
    invitationId
  )));
  await assertFails(getDoc(doc(
    authenticatedDb(OTHER_ID),
    "projectAssignments",
    "runner-studio",
    "assets",
    "abcdefghijklmnopqrst",
    "consentInvitations",
    invitationId
  )));
  const revokeBatch = writeBatch(owner);
  revokeBatch.set(invitationReference, {
    status: "revoked",
    revokedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  revokeBatch.set(statusReference, {
    status: "revoked",
    updatedAt: serverTimestamp()
  }, { merge: true });
  await assertSucceeds(revokeBatch.commit());
  await assertFails(setDoc(invitationReference, {
    status: "pending",
    revokedAt: null,
    updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertFails(deleteDoc(invitationReference));
});

test("creator consent invitation rules reject stale revisions, self-acceptance, and mutation", async () => {
  const admin = adminDb();
  await assertSucceeds(setDoc(doc(admin, "projectAssignments", "runner-studio"), projectAssignment()));
  const owner = authenticatedDb();
  const assetReference = doc(owner, "projectAssignments", "runner-studio", "assets", "abcdefghijklmnopqrst");
  const asset = creatorAsset();
  await assertSucceeds(setDoc(assetReference, asset));

  const staleId = "7".repeat(64);
  const staleBatch = writeBatch(owner);
  staleBatch.set(
    doc(assetReference, "consentInvitations", staleId),
    creatorConsentInvitation(staleId, `0x${"9".repeat(64)}`)
  );
  staleBatch.set(
    doc(owner, "creatorConsentStatuses", staleId),
    creatorConsentPublicStatus(staleId)
  );
  await assertFails(staleBatch.commit());
  const acceptedId = "8".repeat(64);
  const acceptedBatch = writeBatch(owner);
  acceptedBatch.set(
    doc(assetReference, "consentInvitations", acceptedId),
    creatorConsentInvitation(acceptedId, asset.draftRevisionHash, {
      status: "accepted",
      revokedAt: null
    })
  );
  acceptedBatch.set(
    doc(owner, "creatorConsentStatuses", acceptedId),
    creatorConsentPublicStatus(acceptedId)
  );
  await assertFails(acceptedBatch.commit());
  const validId = "a".repeat(64);
  const validReference = doc(assetReference, "consentInvitations", validId);
  const validBatch = writeBatch(owner);
  validBatch.set(validReference, creatorConsentInvitation(validId, asset.draftRevisionHash));
  validBatch.set(
    doc(owner, "creatorConsentStatuses", validId),
    creatorConsentPublicStatus(validId)
  );
  await assertSucceeds(validBatch.commit());
  const selfAcceptBatch = writeBatch(owner);
  selfAcceptBatch.set(validReference, {
    status: "accepted",
    responseAction: "accept",
    responseSignature: `0x${"c".repeat(130)}`,
    respondedAt: 1_999_999_000,
    signerWallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    receivedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  selfAcceptBatch.set(
    doc(owner, "creatorConsentStatuses", validId),
    { status: "accepted", updatedAt: serverTimestamp() },
    { merge: true }
  );
  await assertFails(selfAcceptBatch.commit());
  await assertFails(setDoc(validReference, {
    collaboratorName: "Changed collaborator",
    updatedAt: serverTimestamp()
  }, { merge: true }));
  const other = authenticatedDb(OTHER_ID);
  const unauthorizedId = "b".repeat(64);
  const unauthorizedBatch = writeBatch(other);
  unauthorizedBatch.set(
    doc(
      other,
      "projectAssignments",
      "runner-studio",
      "assets",
      "abcdefghijklmnopqrst",
      "consentInvitations",
      unauthorizedId
    ),
    creatorConsentInvitation(unauthorizedId, asset.draftRevisionHash)
  );
  unauthorizedBatch.set(
    doc(other, "creatorConsentStatuses", unauthorizedId),
    creatorConsentPublicStatus(unauthorizedId)
  );
  await assertFails(unauthorizedBatch.commit());
});

test("release-review snapshots are private and server-immutable", async () => {
  const admin = adminDb();
  await assertSucceeds(setDoc(doc(admin, "projectAssignments", "runner-studio"), projectAssignment()));
  const owner = authenticatedDb();
  const assetReference = doc(owner, "projectAssignments", "runner-studio", "assets", "abcdefghijklmnopqrst");
  await assertSucceeds(setDoc(assetReference, creatorAsset()));
  const reviewId = "d".repeat(64);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(
      context.firestore(),
      "projectAssignments",
      "runner-studio",
      "assets",
      "abcdefghijklmnopqrst",
      "releaseReviews",
      reviewId
    ), {
      reviewId,
      status: "prepared",
      createdAt: serverTimestamp()
    });
  });
  const ownerReviewReference = doc(
    owner,
    "projectAssignments",
    "runner-studio",
    "assets",
    "abcdefghijklmnopqrst",
    "releaseReviews",
    reviewId
  );
  await assertSucceeds(getDoc(ownerReviewReference));
  await assertFails(getDoc(doc(
    authenticatedDb(OTHER_ID),
    "projectAssignments",
    "runner-studio",
    "assets",
    "abcdefghijklmnopqrst",
    "releaseReviews",
    reviewId
  )));
  await assertFails(setDoc(ownerReviewReference, { status: "approved" }, { merge: true }));
  await assertFails(deleteDoc(ownerReviewReference));
});
