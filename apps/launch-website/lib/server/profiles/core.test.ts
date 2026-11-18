import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { profileEdit, profileUsername } from "../../profiles";
import { isProfileApiRoute, profileConfig, requireProfileRequest } from "./config";
import { sanitizeAvatar } from "./avatar";

const local = { RMT_PROFILES_MODE: "local-firebase-emulators-v1", RMT_PROFILES_ORIGIN: "http://127.0.0.1:4319", GCLOUD_PROJECT: "demo-rmt-launch-profiles",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" };
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
