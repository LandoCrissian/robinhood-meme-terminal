import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, collection, getDoc, getDocs, setDoc, deleteDoc } from "firebase/firestore";
import { ref, uploadBytes, getBytes, deleteObject, listAll, updateMetadata } from "firebase/storage";
const projectId = "demo-rmt-launch-profiles";
const wallet = "0x" + "11".repeat(20), owner = "profile-test-owner", other = "profile-test-other";
let env;
before(async () => {
  assert.equal(process.env.GCLOUD_PROJECT, projectId, "Run only through the demo-project emulator harness");
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
  assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, "127.0.0.1:9199");
  env = await initializeTestEnvironment({ projectId,
    firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync(new URL("../../config/firebase/firestore.profiles.rules", import.meta.url), "utf8") },
    storage: { host: "127.0.0.1", port: 9199, rules: readFileSync(new URL("../../config/firebase/storage.profiles.rules", import.meta.url), "utf8") } });
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "rmtLaunchPublicProfilesV1", wallet), { wallet, displayName: "Synthetic Creator", username: "test_creator" });
    await setDoc(doc(db, "rmtLaunchProfilesV1", owner), { preferences: { reducedMotion: true } });
    for (const name of ["rmtLaunchAccountsV1", "rmtLaunchWalletBindingsV1", "rmtLaunchUsernamesV1", "rmtLaunchNoncesV1", "rmtLaunchSessionsV1", "rmtLaunchBrowsersV1", "rmtLaunchBudgetsV1", "rmtLaunchAvatarsV1", "users"])
      await setDoc(doc(db, name, owner), { privateFixture: true });
    await uploadBytes(ref(context.storage(), "rmtLaunchAvatarsV1/" + owner + "/" + "ab".repeat(16) + ".webp"), new Uint8Array([82, 73, 70, 70]), { contentType: "image/webp" });
  });
});
after(async () => { await env?.cleanup(); });

test("public profile projection permits bounded document reads but not enumeration or writes", async () => {
  const db = env.unauthenticatedContext().firestore(), path = doc(db, "rmtLaunchPublicProfilesV1", wallet);
  assert.equal((await assertSucceeds(getDoc(path))).data().displayName, "Synthetic Creator");
  await assertFails(getDocs(collection(db, "rmtLaunchPublicProfilesV1")));
  await assertFails(setDoc(path, { wallet, displayName: "Forged" }));
  await assertFails(deleteDoc(path));
});
test("only the matching Firebase UID can read its private preferences", async () => {
  const own = doc(env.authenticatedContext(owner).firestore(), "rmtLaunchProfilesV1", owner);
  assert.equal((await assertSucceeds(getDoc(own))).data().preferences.reducedMotion, true);
  await assertFails(getDoc(doc(env.authenticatedContext(other).firestore(), "rmtLaunchProfilesV1", owner)));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "rmtLaunchProfilesV1", owner)));
  await assertFails(getDocs(collection(env.authenticatedContext(owner).firestore(), "rmtLaunchProfilesV1")));
  await assertFails(setDoc(own, { preferences: { reducedMotion: false }, wallet }));
});
test("wallet bindings, username locks, nonce/session records and legacy accounts remain server-only", async () => {
  for (const ctx of [env.unauthenticatedContext(), env.authenticatedContext(owner)]) {
    for (const name of ["rmtLaunchAccountsV1", "rmtLaunchWalletBindingsV1", "rmtLaunchUsernamesV1", "rmtLaunchNoncesV1", "rmtLaunchSessionsV1", "rmtLaunchBrowsersV1", "rmtLaunchBudgetsV1", "rmtLaunchAvatarsV1", "users"]) {
      const path = doc(ctx.firestore(), name, owner);
      await assertFails(getDoc(path)); await assertFails(setDoc(path, { takeover: true })); await assertFails(deleteDoc(path));
    }
  }
});
test("browser Storage clients cannot bypass sanitized avatar API with reads or writes", async () => {
  for (const ctx of [env.unauthenticatedContext(), env.authenticatedContext(owner), env.authenticatedContext(other)]) {
    const storage = ctx.storage(), path = ref(storage, "rmtLaunchAvatarsV1/" + owner + "/" + "ab".repeat(16) + ".webp");
    await assertFails(getBytes(path)); await assertFails(listAll(ref(storage, "rmtLaunchAvatarsV1/" + owner)));
    await assertFails(uploadBytes(path, new Uint8Array([1, 2, 3]), { contentType: "image/webp" }));
    await assertFails(uploadBytes(ref(storage, "rmtLaunchAvatarsV1/" + owner + "/payload.svg"), new TextEncoder().encode("<svg/>"), { contentType: "image/svg+xml" }));
    await assertFails(uploadBytes(ref(storage, "rmtLaunchAvatarsV1/" + owner + "/large.webp"), new Uint8Array(1_048_577), { contentType: "image/webp" }));
    await assertFails(updateMetadata(path, { contentType: "image/svg+xml" })); await assertFails(deleteObject(path));
  }
});
