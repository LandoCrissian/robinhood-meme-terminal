import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { createRequire } from "node:module";
import { profileEdit, profileUsername, profileXHandle, profileShareIntent } from "../../profiles";
import { rmtCreationOwner } from "../../owner-creation";
import { isProfileApiRoute, profileConfig, requireProfileRequest } from "./config";
import { sanitizeAvatar } from "./avatar";
import { photoMime } from "../../prepare-upload-image";

const local = { RMT_PROFILES_MODE: "local-firebase-emulators-v1", RMT_PROFILES_ORIGIN: "http://127.0.0.1:4319", GCLOUD_PROJECT: "demo-rmt-launch-profiles",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" };
test("X links accept a handle and share the canonical public member page", () => {
  assert.equal(profileXHandle("@RMT_Creator"), "rmt_creator");
  assert.equal(profileXHandle(""), null);
  for (const invalid of ["https://example.com", "user?arg", "user/other", "intent", "a".repeat(16)]) {
    assert.throws(() => profileXHandle(invalid));
  }
  const walletAddress = "0x1111111111111111111111111111111111111111";
  for (const username of ["creator_one", null]) {
    const intent = new URL(profileShareIntent({ username, walletAddress }));
    assert.equal(intent.searchParams.get("url"), "https://www.rmtlaunch.fun" + (username ? "/u/" + username : "/creator/" + walletAddress));
  }
});
test("disabled account handlers do not load the Firebase Admin SDK or initialize profile services", async () => {
  const require = createRequire(import.meta.url);
  const loadedSdk = () => Object.keys(require.cache).filter(path => /[\\/]firebase-admin[\\/]/.test(path));
  assert.deepEqual(loadedSdk(), []);
  const originalMode = process.env.RMT_PROFILES_MODE;
  process.env.RMT_PROFILES_MODE = "";
  try {
    const { accountHandler } = await import("./controller");
    const session = await accountHandler(new Request("https://www.rmtlaunch.fun/api/account/session", { headers: { host: "www.rmtlaunch.fun" } }), "session");
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), { authenticated: false, availability: "disabled" });
    const blocked = await accountHandler(new Request("https://www.rmtlaunch.fun/api/account/nonce", { method: "POST", headers: { host: "www.rmtlaunch.fun", origin: "https://www.rmtlaunch.fun" } }), "nonce");
    assert.equal(blocked.status, 404);
    const avatarRemoval = await accountHandler(new Request("https://www.rmtlaunch.fun/api/account/avatar", { method: "DELETE", headers: { host: "www.rmtlaunch.fun", origin: "https://www.rmtlaunch.fun" } }), "avatar");
    assert.equal(avatarRemoval.status, 404);
    assert.deepEqual(loadedSdk(), []);
  } finally { if (originalMode === undefined) delete process.env.RMT_PROFILES_MODE; else process.env.RMT_PROFILES_MODE = originalMode; }
});
test("profile configuration is disabled by default and local-only unless exact cloud approval exists", () => {
  assert.equal(profileConfig({}), null);
  assert.equal(profileConfig(local)?.mode, "emulator");
  for (const change of [{ NETLIFY: "true" }, { GCLOUD_PROJECT: "robinhood-meme-terminal" }, { FIRESTORE_EMULATOR_HOST: "remote.test:8080" }, { RMT_PROFILES_ORIGIN: "https://www.rmtlaunch.fun" }]) assert.throws(() => profileConfig({ ...local, ...change }));
  const cloud = { RMT_PROFILES_MODE: "approved-existing-firebase-v1", RMT_PROFILES_ACTIVATION_APPROVAL: "owner-approved-existing-firebase-profiles-v1",
    RMT_PROFILES_ORIGIN: "https://www.rmtlaunch.fun", GCLOUD_PROJECT: "robinhood-meme-terminal", RMT_FIREBASE_WEB_APP_ID: "1:737255919447:web:8674f28ee2486a0b983812",
    RMT_FIREBASE_WEB_API_KEY: "AIza" + "a".repeat(35), FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: "robinhood-meme-terminal", client_email: "synthetic@example.test", private_key: "SYNTHETIC_CONFIG_ONLY_NEVER_USED" }) };
  assert.equal(profileConfig(cloud)?.secureCookies, true);
  assert.throws(() => profileConfig({ ...cloud, RMT_PROFILES_ACTIVATION_APPROVAL: "" }));
  assert.throws(() => profileConfig({ ...cloud, FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }));
  assert.throws(() => profileConfig({ ...cloud, RMT_PROFILES_ORIGIN: "https://preview.example.test" }));
});
test("routing is bounded and origin checks reject cross-site or forwarded local requests", () => {
  assert.equal(isProfileApiRoute("/api/account/session", "GET"), true);
  assert.equal(isProfileApiRoute("/api/account/admin", "POST"), false);
  assert.equal(isProfileApiRoute("/api/account/nonce", "GET"), false);
  assert.equal(isProfileApiRoute("/api/account/avatar", "DELETE"), true);
  assert.equal(isProfileApiRoute("/api/account/avatar/0x" + "1".repeat(40), "DELETE"), false);
  assert.equal(isProfileApiRoute("/api/account/avatar", "PATCH"), false);
  const config = profileConfig(local)!;
  requireProfileRequest(new Request(config.origin + "/api/account/nonce", { method: "POST", headers: { host: "127.0.0.1:4319", origin: config.origin } }), config, true);
  requireProfileRequest(new Request(config.origin + "/api/account/nonce", { method: "POST", headers: { host: "127.0.0.1:4319", origin: config.origin,
    "x-forwarded-host": "127.0.0.1:4319", "x-forwarded-proto": "http", "x-forwarded-port": "4319" } }), config, true);
  const rejectedHeaders: Record<string, string>[] = [{ host: "evil.example", origin: config.origin }, { host: "127.0.0.1:4319", origin: "https://evil.example" }, { host: "127.0.0.1:4319", origin: config.origin, "x-forwarded-host": "evil.example" }];
  for (const headers of rejectedHeaders) {
    assert.throws(() => requireProfileRequest(new Request(config.origin + "/api/account/nonce", { method: "POST", headers }), config, true));
  }
});
test("real NextRequest loopback normalization preserves exact external host, port and origin binding", () => {
  const config = profileConfig(local)!;
  const headers = { host: "127.0.0.1:4319", origin: config.origin, "x-forwarded-host": "127.0.0.1:4319", "x-forwarded-proto": "http", "x-forwarded-port": "4319" };
  const request = new NextRequest(config.origin + "/api/account/nonce", { method: "POST", headers });
  assert.equal(new URL(request.url).origin, "http://localhost:4319");
  requireProfileRequest(request, config, true);
  for (const change of [{ host: "localhost:4319" }, { "x-forwarded-host": "localhost:4319" }, { "x-forwarded-port": "4320" }, { origin: "http://localhost:4319" }]) {
    assert.throws(() => requireProfileRequest(new NextRequest(config.origin + "/api/account/nonce", { method: "POST", headers: { ...headers, ...change } }), config, true));
  }
  assert.throws(() => requireProfileRequest(new Request("http://localhost:4320/api/account/nonce", { method: "POST", headers }), config, true));
});
test("username, plain text, HTTPS links and private preferences reject untrusted field escalation", () => {
  assert.equal(profileUsername("Creator_One"), "creator_one");
  for (const name of ["rmt", "admin", "support", "official_root", "a", "../other"]) assert.throws(() => profileUsername(name));
  const valid = { username: "creator_one", displayName: "Creator", bio: "Public project information", links: [{ label: "Project", url: "https://example.test/" }], preferences: { theme: "system", reducedMotion: false } };
  assert.equal(profileEdit(valid).username, "creator_one");
  const official = { ...valid, username: "RMTLaunch" };
  assert.equal(profileEdit(official, rmtCreationOwner.toLowerCase()).username, "rmtlaunch");
  assert.equal(profileShareIntent({ username: "rmtlaunch", walletAddress: rmtCreationOwner }).includes("%2Fu%2Frmtlaunch"), true);
  assert.throws(() => profileEdit(official), /reserved/);
  assert.throws(() => profileEdit(official, "0x1111111111111111111111111111111111111111"), /reserved/);
  assert.throws(() => profileEdit({ ...official, walletAddress: rmtCreationOwner }), /Unexpected profile field/);
  assert.throws(() => profileEdit({ ...valid, username: "admin" }, rmtCreationOwner), /reserved/);
  assert.throws(() => profileEdit({ ...valid, links: [{ label: "Website", url: "example.com" }] }), /Project link 1 needs a full HTTPS URL/);
  assert.equal(profileEdit({ ...valid, bio: "First line\r\nSecond line" }).bio, "First line\nSecond line");
  assert.throws(() => profileEdit({ ...valid, bio: "First\u202eline" }), /plain text/);
  for (const change of [{ bio: "<script>" }, { links: [{ label: "Bad", url: "javascript:alert(1)" }] }, { links: [{ label: "Bad", url: "https://user:pass@example.test/" }] }, { uid: "other" }, { preferences: { theme: "system", admin: true } }]) assert.throws(() => profileEdit({ ...valid, ...change }));
});
test("avatar decoding strips metadata, bounds pixels/storage and rejects SVG or mismatched bytes", async () => {
  const png = await sharp({ create: { width: 512, height: 128, channels: 3, background: "green" } }).png().withMetadata().toBuffer();
  const result = await sanitizeAvatar(png, "image/png");
  assert.equal(result.mime, "image/webp"); assert.ok(result.width <= 256 && result.height <= 256 && result.bytes.length <= 65_536);
  assert.equal((await sharp(result.bytes).metadata()).exif, undefined);
  await assert.rejects(sanitizeAvatar(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/png"));
  await assert.rejects(sanitizeAvatar(png, "image/jpeg"));
  await assert.rejects(sanitizeAvatar(new Uint8Array(2 * 1024 * 1024 + 1), "image/png"));
});

test("photo intake rejects moving images, corrupt files, MIME mismatches and excessive pixel dimensions before decoding", async () => {
  const animated = await sharp(Buffer.from([0,255,0,255,0,0]), {
    raw:{width:1,height:2,channels:3,pageHeight:1},
  }).webp({delay:[200,200],loop:0}).toBuffer();
  assert.equal((await sharp(animated).metadata()).pages,2);
  assert.throws(() => photoMime(animated,"image/webp"), /still/);
  await assert.rejects(sanitizeAvatar(animated,"image/webp"), /safely decoded/);
  const png = await sharp({create:{width:8,height:8,channels:4,background:"#567"}}).png().toBuffer();
  assert.equal(photoMime(png,""),"image/png");
  assert.throws(() => photoMime(png,"image/jpeg"), /does not match/);
  assert.throws(() => photoMime(png.subarray(0,33),"image/png"), /Incomplete/);
  const large = Buffer.from(png); large.writeUInt32BE(10001,16); large.writeUInt32BE(10001,20);
  assert.throws(() => photoMime(large,"image/png"), /50 megapixels/);
  assert.throws(() => photoMime(Buffer.from("<svg/>"),""), /still/);
});
