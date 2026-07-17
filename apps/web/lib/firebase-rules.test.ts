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
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch
} from "firebase/firestore";

const PROJECT_ID = "rmt-rules-test";
const OWNER_ID = "owner-user";
const OTHER_ID = "other-user";
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
