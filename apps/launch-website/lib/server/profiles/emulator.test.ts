import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { deleteApp, getApps } from "firebase-admin/app";
import sharp from "sharp";
import { profileEdit } from "../../profiles";
import { accountHandler, type AccountAction } from "./controller";
import { profileConfig } from "./config";
import { profileFirebase } from "./firebase";
import { authenticatedProfile, sessionCookieName } from "./auth";
import { digest, profileBudget, profileCollections as c, updateProfile, walletKey } from "./store";
import { sanitizeAvatar, saveAvatar } from "./avatar";
import { cleanupExpiredProfileState, profileRetentionPolicy } from "./retention";

process.env.RMT_PROFILES_MODE = "local-firebase-emulators-v1";
process.env.RMT_PROFILES_ORIGIN = "http://127.0.0.1:4319";
const config = profileConfig()!;
assert.equal(config.projectId, "demo-rmt-launch-profiles", "Real Firebase projects must never run these write tests");
assert.equal(config.mode, "emulator");
const firebase = profileFirebase(config);
const alice = privateKeyToAccount("0x" + "1".padStart(64, "0") as `0x${string}`);
const bob = privateKeyToAccount("0x" + "2".padStart(64, "0") as `0x${string}`);
type Jar = Map<string, string>;
const origin = config.origin;
const cookies = (jar: Jar) => [...jar].map(([key, value]) => key + "=" + value).join("; ");
function action(path: string): [AccountAction, string?] {
  const tail = path.split("?")[0].replace("/api/account/", "");
  if (tail.startsWith("creator/")) return ["public-wallet", tail.slice(8)];
  if (tail.startsWith("public/")) return ["public-username", tail.slice(7)];
  if (tail.startsWith("avatar/")) return ["public-avatar", tail.slice(7)];
  return [tail as AccountAction];
}
function request(jar: Jar, path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  const multipart = body instanceof FormData;
  return new Request(origin + path, { method, headers: { host: new URL(origin).host, ...(!["GET", "HEAD"].includes(method) && { origin }),
    ...(jar.size && { cookie: cookies(jar) }), ...(body !== undefined && !multipart && { "content-type": "application/json" }), ...headers },
    ...(body !== undefined && { body: multipart ? body : JSON.stringify(body) }) });
}
async function call(jar: Jar, path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  const result = await accountHandler(request(jar, path, method, body, headers), ...action(path));
  for (const cookie of result.headers.getSetCookie()) { const first = cookie.split(";")[0]; const index = first.indexOf("="); const key = first.slice(0, index); const value = first.slice(index + 1); if (value) jar.set(key, value); else jar.delete(key); }
  const data = result.headers.get("content-type")?.startsWith("application/json") ? await result.clone().json() : null;
  return { result, data };
}
async function signIn(jar: Jar, account = alice) {
  const challenge = await call(jar, "/api/account/nonce", "POST", { address: account.address, chainId: 4663 });
  assert.equal(challenge.result.status, 200, JSON.stringify(challenge.data));
  const signature = await account.signMessage({ message: challenge.data.message });
  const verified = await call(jar, "/api/account/verify", "POST", { message: challenge.data.message, signature });
  assert.equal(verified.result.status, 200, JSON.stringify(verified.data));
  assert.match(verified.result.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/);
  const session = await call(jar, "/api/account/session");
  assert.equal(session.data.authenticated, true, JSON.stringify(session.data));
  return { session: session.data, challenge: challenge.data, signature };
}
const edit = (username: string) => profileEdit({ username, displayName: "Synthetic creator", bio: "Test-only creator profile", links: [{ label: "Project", url: "https://example.test/" }], preferences: { theme: "dark", reducedMotion: true } });

test("real Firebase Auth sessions and durable Firestore profiles complete the isolated wallet lifecycle", async t => {
  t.after(async () => { await firebase.db.terminate(); await Promise.all(getApps().map(deleteApp)); });
  await fetch(`http://${config.authHost}/emulator/v1/projects/${config.projectId}/accounts`, { method: "DELETE" });
  await fetch(`http://${config.firestoreHost}/emulator/v1/projects/${config.projectId}/databases/(default)/documents`, { method: "DELETE" });
  const jar: Jar = new Map(); let signed: Awaited<ReturnType<typeof signIn>>;
  await t.test("Connect alone is unauthenticated; exact SIWE establishes a genuine HttpOnly Firebase session and is not replayable", async () => {
    assert.equal((await call(jar, "/api/account/session")).data.authenticated, false);
    signed = await signIn(jar);
    const cookie = jar.get(sessionCookieName)!;
    const decoded = await firebase.auth.verifySessionCookie(cookie, true);
    assert.equal(decoded.rmt_launch_address, alice.address); assert.equal(decoded.rmt_launch_chain_id, 4663);
    assert.equal(decoded.uid, "rmt_launch_4663_" + alice.address.slice(2).toLowerCase());
    const repeat = await call(jar, "/api/account/verify", "POST", { message: signed.challenge.message, signature: signed.signature });
    assert.equal(repeat.result.status, 401);
    const profile = (await firebase.db.collection(c.public).doc(alice.address.toLowerCase()).get()).data()!;
    assert.equal(profile.walletAddress, alice.address); assert.equal(profile.preferences, undefined);
  });
  await t.test("session/profile survives a separate application process using actual emulator persistence", async () => {
    const code = "import{readFileSync}from'node:fs';import{getApps,deleteApp}from'firebase-admin/app';import{accountHandler}from'./lib/server/profiles/controller.ts';(async()=>{const cookie=readFileSync(0,'utf8');const r=await accountHandler(new Request('"+origin+"/api/account/session',{headers:{host:'"+new URL(origin).host+"',cookie}}),'session');const body=await r.json();console.log(JSON.stringify({status:r.status,authenticated:body.authenticated,wallet:body.account?.walletAddress}));await Promise.all(getApps().map(deleteApp));})();";
    const cli = fileURLToPath(new URL("../../../node_modules/tsx/dist/cli.mjs", import.meta.url));
    const result = JSON.parse(execFileSync(process.execPath, [cli, "-e", code], { cwd: fileURLToPath(new URL("../../../", import.meta.url)), env: process.env,
      input: cookies(jar), encoding: "utf8", windowsHide: true, timeout: 30_000 }));
    assert.deepEqual(result, { status: 200, authenticated: true, wallet: alice.address });
  });
  await t.test("two simultaneous verifications consume one nonce exactly once", async () => {
    const challenge = await call(jar, "/api/account/nonce", "POST", { address: alice.address, chainId: 4663 });
    const body = { message: challenge.data.message, signature: await alice.signMessage({ message: challenge.data.message }) };
    const outcomes = await Promise.all([call(jar, "/api/account/verify", "POST", body), call(jar, "/api/account/verify", "POST", body)]);
    assert.deepEqual(outcomes.map(row => row.result.status).sort(), [200, 401]);
    signed.session = (await call(jar, "/api/account/session")).data;
  });
  await t.test("wrong browser, changed domain/chain and expired challenges fail without consuming the legitimate proof", async () => {
    const challenge = await call(jar, "/api/account/nonce", "POST", { address: alice.address, chainId: 4663 });
    const signature = await alice.signMessage({ message: challenge.data.message });
    assert.equal((await call(new Map(), "/api/account/verify", "POST", { message: challenge.data.message, signature })).result.status, 401);
    for (const message of [challenge.data.message.replace(new URL(origin).host, "evil.example"), challenge.data.message.replace("Chain ID: 4663", "Chain ID: 4664")]) {
      assert.equal((await call(jar, "/api/account/verify", "POST", { message, signature: await alice.signMessage({ message }) })).result.status, 401);
    }
    await firebase.db.collection(c.nonces).doc(digest(challenge.data.nonce)).update({ expiresAt: Date.now() - 1 });
    assert.equal((await call(jar, "/api/account/verify", "POST", { message: challenge.data.message, signature })).result.status, 401);
  });
  await t.test("CSRF, field escalation and concurrent unique-username claims are enforced; existing explicitly linked UID is preserved", async () => {
    assert.equal((await call(jar, "/api/account/profile", "PATCH", edit("creator_alpha"))).result.status, 403);
    assert.equal((await call(jar, "/api/account/profile", "PATCH", edit("creator_alpha"), { "x-csrf-token": signed.session.csrfToken })).result.status, 200);
    const oldUid = "rmt_privy_" + "a".repeat(64);
    await firebase.auth.createUser({ uid: oldUid });
    await firebase.auth.setCustomUserClaims(oldUid, { privy_verified: true, rmt_privy_uid: oldUid });
    await firebase.db.collection("users").doc(oldUid).set({ schemaVersion: 1, profile: { displayName: "Legacy local fixture" }, marker: "untouched" });
    await firebase.db.collection(c.wallets).doc(walletKey(bob.address)).set({ uid: oldUid, walletAddress: bob.address, chainId: 4663 });
    const bobJar: Jar = new Map(); const bobSigned = await signIn(bobJar, bob);
    const results = await Promise.all([call(jar, "/api/account/profile", "PATCH", edit("shared_creator"), { "x-csrf-token": signed.session.csrfToken }),
      call(bobJar, "/api/account/profile", "PATCH", edit("shared_creator"), { "x-csrf-token": bobSigned.session.csrfToken })]);
    assert.deepEqual(results.map(x => x.result.status).sort(), [200, 409]);
    assert.equal((await firebase.db.collection(c.wallets).doc(walletKey(bob.address)).get()).data()!.uid, oldUid);
    assert.deepEqual((await firebase.auth.getUser(oldUid)).customClaims, { privy_verified: true, rmt_privy_uid: oldUid });
    assert.equal((await firebase.db.collection("users").doc(oldUid).get()).data()!.marker, "untouched");
    const visible = await call(new Map(), "/api/account/creator/" + alice.address);
    assert.equal(visible.result.status, 200); assert.equal(visible.data.profile.preferences, undefined); assert.equal(visible.data.profile.uid, undefined);
  });
  await t.test("validated avatar persists separately as bounded metadata-free WebP and rejects spoofed content", async () => {
    const png = await sharp({ create: { width: 400, height: 400, channels: 3, background: "green" } }).png().withMetadata().toBuffer();
    const form = new FormData(); form.set("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "avatar.png");
    const uploaded = await call(jar, "/api/account/avatar", "POST", form, { "x-csrf-token": signed.session.csrfToken });
    assert.equal(uploaded.result.status, 200, JSON.stringify(uploaded.data));
    const image = await call(new Map(), uploaded.data.profile.avatarUrl);
    assert.equal(image.result.status, 200); assert.equal(image.result.headers.get("content-type"), "image/webp"); assert.equal(image.result.headers.get("x-content-type-options"), "nosniff");
    const metadata = await sharp(Buffer.from(await image.result.arrayBuffer())).metadata(); assert.ok(metadata.width! <= 256 && metadata.height! <= 256); assert.equal(metadata.exif, undefined);
    const spoof = new FormData(); spoof.set("file", new Blob(["<svg onload='alert(1)'/>"] , { type: "image/png" }), "avatar.png");
    assert.equal((await call(jar, "/api/account/avatar", "POST", spoof, { "x-csrf-token": signed.session.csrfToken })).result.status, 400);
    const oversized = new FormData(); oversized.set("file", new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: "image/png" }), "large.png");
    assert.equal((await call(jar, "/api/account/avatar", "POST", oversized, { "x-csrf-token": signed.session.csrfToken })).result.status, 413);
    const pixels = await sharp({ create: { width: 4097, height: 1024, channels: 3, background: "green" } }).png().toBuffer();
    await assert.rejects(sanitizeAvatar(pixels, "image/png"), /safely decoded/);
  });
  await t.test("logout invalidates outstanding proofs and in-flight profile/avatar writes, without global Firebase revocation", async () => {
    const auth = (await authenticatedProfile(request(jar, "/api/account/profile"), firebase))!;
    const challenge = await call(jar, "/api/account/nonce", "POST", { address: alice.address, chainId: 4663 });
    const staleJar = new Map(jar); const signature = await alice.signMessage({ message: challenge.data.message });
    const out = await call(jar, "/api/account/logout", "POST", undefined, { "x-csrf-token": signed.session.csrfToken }); assert.equal(out.result.status, 200);
    assert.equal((await call(staleJar, "/api/account/verify", "POST", { message: challenge.data.message, signature })).result.status, 401);
    const guard = { sessionId: auth.id, browserHash: auth.session.browserHash, browserEpoch: auth.session.browserEpoch };
    await assert.rejects(updateProfile(firebase.db, auth.account, edit("late_creator"), guard), /session changed/);
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "green" } }).png().toBuffer();
    await assert.rejects(saveAvatar(firebase.db, auth.account, await sanitizeAvatar(png, "image/png"), guard), /session changed/);
    assert.equal((await call(staleJar, "/api/account/session")).data.authenticated, false);
    signed = await signIn(jar);
  });
  await t.test("fresh explicit reauthentication deletes only app profile data, preserves Firebase/legacy records and prevents old-session replay", async () => {
    assert.equal((await call(jar, "/api/account/profile", "DELETE", undefined, { "x-csrf-token": signed.session.csrfToken })).result.status, 403);
    const challenge = await call(jar, "/api/account/nonce", "POST", { address: alice.address, chainId: 4663, purpose: "delete-profile" }, { "x-csrf-token": signed.session.csrfToken });
    assert.equal(challenge.result.status, 200, JSON.stringify(challenge.data));
    const verified = await call(jar, "/api/account/verify", "POST", { message: challenge.data.message, signature: await alice.signMessage({ message: challenge.data.message }) }, { "x-csrf-token": signed.session.csrfToken });
    assert.equal(verified.result.status, 200, JSON.stringify(verified.data)); assert.ok(verified.data.reauthExpiresAt);
    const old = new Map(jar);
    assert.equal((await call(jar, "/api/account/profile", "DELETE", undefined, { "x-csrf-token": signed.session.csrfToken })).result.status, 200);
    assert.equal((await call(new Map(), "/api/account/creator/" + alice.address)).result.status, 404);
    assert.equal((await call(old, "/api/account/session")).data.authenticated, false);
    const uid = "rmt_launch_4663_" + alice.address.slice(2).toLowerCase();
    assert.equal((await firebase.auth.getUser(uid)).uid, uid);
    assert.equal((await firebase.db.collection(c.private).doc(uid).get()).exists, false);
    assert.equal((await firebase.db.collection(c.avatars).where("uid", "==", uid).get()).size, 0);
    assert.equal((await firebase.db.collection("users").doc("rmt_privy_" + "a".repeat(64)).get()).data()!.marker, "untouched");
  });
  await t.test("durable rate counters and request-driven cleanup remain bounded and never touch legacy data", async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => profileBudget(firebase.db, "test", "shared-limit", 2)));
    assert.equal(attempts.filter(row => row.status === "fulfilled").length, 2);
    assert.equal(attempts.filter(row => row.status === "rejected" && row.reason.status === 429).length, 3);
    await firebase.db.collection(c.budgets).doc("_retention_v1").set({ nextAt: 0 });
    for (const collection of profileRetentionPolicy.collections) {
      const batch = firebase.db.batch();
      for (let i = 0; i < 10; i++) batch.set(firebase.db.collection(collection).doc("retention_" + i), { expiresAt: 0, synthetic: true });
      batch.set(firebase.db.collection(collection).doc("retention_future"), { expiresAt: Date.now() + 86_400_000, synthetic: true });
      await batch.commit();
    }
    const cleaned = await cleanupExpiredProfileState(firebase.db);
    assert.equal(cleaned.deleted, 12);
    assert.equal((await cleanupExpiredProfileState(firebase.db)).status, "interval-limited");
    for (const collection of profileRetentionPolicy.collections) assert.equal((await firebase.db.collection(collection).doc("retention_future").get()).exists, true);
    assert.equal((await firebase.db.collection("users").doc("rmt_privy_" + "a".repeat(64)).get()).data()!.marker, "untouched");
  });
});
