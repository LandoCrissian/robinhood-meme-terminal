import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { cert, deleteApp, getApps } from "firebase-admin/app";
import { POST } from "../../app/api/auth/firebase-session/route";
import { getRmtAdminAuth, getRmtAdminFirestore } from "./firebase-admin";
import { firebaseUidForPrivyUser } from "./privy-identity";

const require = createRequire(import.meta.url);
const adminLib = resolve(dirname(require.resolve("firebase-admin/app")), "..");
const { HttpClient, AuthorizedHttpClient } = require(resolve(adminLib, "utils/api-request.js"));
const projectId = "rmt-sdk-compatibility-test";
const clientEmail = `test@${projectId}.iam.gserviceaccount.com`;
const privyAppId = "rmt-privy-compatibility-test";
const privyUserId = "did:privy:compatibility-test";
const email = "owner@example.test";
const bridgeUid = firebaseUidForPrivyUser(privyUserId);

// Ephemeral test keys never leave this process. No production configuration is loaded.
const serviceKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const identityKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const servicePem = serviceKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const identityPublicPem = identityKeys.publicKey.export({ type: "spki", format: "pem" }).toString();

function identityToken(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "privy.io", aud: privyAppId, sub: privyUserId,
    iat: now, exp: now + 300, cr: String(now), guest: "f",
    linked_accounts: JSON.stringify([{ type: "email", address: email, lv: now }]),
    ...overrides
  })).toString("base64url");
  const content = `${header}.${payload}`;
  return `${content}.${sign("sha256", Buffer.from(content), {
    key: identityKeys.privateKey, dsaEncoding: "ieee-p1363"
  }).toString("base64url")}`;
}

function request(token = identityToken()) {
  return new Request("https://rmt.example.test/api/auth/firebase-session", {
    method: "POST", headers: { "privy-id-token": token }
  });
}

function firebaseIdToken(uid: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    aud: projectId, iss: `https://securetoken.google.com/${projectId}`,
    sub: uid, iat: now, exp: now + 300, auth_time: now,
    firebase: { sign_in_provider: "custom" }
  })).toString("base64url");
  const content = `${header}.${payload}`;
  return `${content}.${sign("RSA-SHA256", Buffer.from(content), serviceKeys.privateKey).toString("base64url")}`;
}

type WireUser = {
  localId: string; email?: string; emailVerified?: boolean;
  disabled?: boolean; customAttributes?: string; validSince?: string;
};

test("production Firebase SDK no longer depends on node-forge", () => {
  const manifest = JSON.parse(readFileSync(resolve(adminLib, "../package.json"), "utf8"));
  assert.equal(manifest.dependencies["node-forge"], undefined,
    "Use the upstream Firebase Admin release with native private-key validation");
  assert.doesNotMatch(readFileSync(resolve(adminLib, "app/credential-internal.js"), "utf8"), /node-forge/);
});

test("real Privy identity, RMT session route and Firebase SDK remain compatible", async (t) => {
  const envKeys = ["FIREBASE_ADMIN_PROJECT_ID", "FIREBASE_ADMIN_CLIENT_EMAIL",
    "FIREBASE_ADMIN_PRIVATE_KEY", "NEXT_PUBLIC_PRIVY_APP_ID", "PRIVY_VERIFICATION_KEY"] as const;
  const original = new Map(envKeys.map((key) => [key, process.env[key]]));
  process.env.FIREBASE_ADMIN_PROJECT_ID = projectId;
  process.env.FIREBASE_ADMIN_CLIENT_EMAIL = clientEmail;
  process.env.FIREBASE_ADMIN_PRIVATE_KEY = servicePem;
  process.env.NEXT_PUBLIC_PRIVY_APP_ID = privyAppId;
  process.env.PRIVY_VERIFICATION_KEY = identityPublicPem;
  const calls: string[] = [];
  const users = new Map<string, WireUser>();
  let providerUnavailable = false;

  // Mock only Firebase HTTP boundaries. User lookup/binding, validation,
  // credential parsing, JWT signing and Privy verification are real implementations.
  t.mock.method(AuthorizedHttpClient.prototype, "send", async (config: {
    url: string; data: Record<string, unknown>;
  }) => {
    const url = new URL(config.url);
    assert.equal(url.hostname, "identitytoolkit.googleapis.com");
    assert.ok(url.pathname.includes(projectId));
    const operation = url.pathname.endsWith("/accounts") ? "signUp" : url.pathname.split(":").at(-1)!;
    calls.push(operation);
    if (providerUnavailable) throw new Error("Controlled external Firebase outage");
    const body = config.data;
    if (operation === "lookup") {
      const uid = (body.localId as string[] | undefined)?.[0];
      const wantedEmail = (body.email as string[] | undefined)?.[0];
      const user = uid ? users.get(uid) : [...users.values()].find((item) => item.email === wantedEmail);
      return { data: user ? { users: [user] } : {} };
    }
    if (operation === "signUp") {
      const user = { localId: body.localId as string, email: body.email as string, emailVerified: true };
      users.set(user.localId, user);
      return { data: { localId: user.localId } };
    }
    if (operation === "update") {
      const user = users.get(body.localId as string);
      assert.ok(user);
      Object.assign(user, body);
      return { data: user };
    }
    throw new Error("Unexpected Firebase HTTP operation");
  });
  t.mock.method(HttpClient.prototype, "send", async (config: { url: string }) => {
    assert.equal(new URL(config.url).hostname, "www.googleapis.com");
    return {
      data: { "test-key": serviceKeys.publicKey.export({ type: "spki", format: "pem" }).toString() },
      isJson: () => true,
      headers: { "cache-control": "public, max-age=300" }
    };
  });

  try {
    await t.test("valid credentials initialize Auth and Firestore; malformed private key is rejected", () => {
      assert.ok(getRmtAdminAuth());
      assert.ok(getRmtAdminFirestore());
      assert.throws(() => cert({ projectId, clientEmail, privateKey: "not-a-private-key" }),
        (error: unknown) => (error as { code?: string }).code === "app/invalid-credential");
    });

    async function assertCustomToken(response: Response, uid: string, expectedRole?: string) {
      assert.equal(response.status, 200);
      const { firebaseToken } = await response.json();
      assert.ok(typeof firebaseToken === "string");
      const [header, payload, signature] = firebaseToken.split(".");
      assert.ok(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), serviceKeys.publicKey,
        Buffer.from(signature, "base64url")), "Real Firebase custom-token signature verifies");
      const terms = JSON.parse(Buffer.from(payload, "base64url").toString());
      assert.equal(terms.uid, uid);
      assert.equal(terms.iss, clientEmail);
      assert.equal(terms.claims.rmt_privy_uid, privyUserId);
      assert.equal(terms.claims.privy_verified, true);
      if (expectedRole) assert.equal(terms.claims.role, expectedRole);
    }

    await t.test("new verified Privy user creates the correct Firebase account and signed custom token", async () => {
      users.clear(); calls.length = 0;
      await assertCustomToken(await POST(request()), bridgeUid);
      assert.deepEqual(calls.sort(), ["lookup", "lookup", "lookup", "signUp", "update"].sort());
      assert.equal(users.get(bridgeUid)?.email, email);
    });

    await t.test("returning email profile wins over orphan bridge UID and preserves claims", async () => {
      users.clear(); calls.length = 0;
      users.set(bridgeUid, { localId: bridgeUid });
      users.set("existing-profile", { localId: "existing-profile", email, emailVerified: true,
        customAttributes: JSON.stringify({ role: "existing-role", rmt_privy_uid: privyUserId }) });
      await assertCustomToken(await POST(request()), "existing-profile", "existing-role");
      assert.equal(calls.includes("signUp"), false);
    });

    await t.test("conflicting binding and disabled accounts cannot receive custom tokens", async () => {
      users.clear(); calls.length = 0;
      users.set("existing-profile", { localId: "existing-profile", email,
        customAttributes: JSON.stringify({ rmt_privy_uid: "did:privy:different-test-user" }) });
      assert.equal((await POST(request())).status, 409);
      users.set("existing-profile", { localId: "existing-profile", email, disabled: true });
      assert.equal((await POST(request())).status, 403);
      assert.equal(calls.includes("update"), false);
    });

    await t.test("missing, wrong-audience, expired and guest identities cannot mutate Firebase users", async () => {
      calls.length = 0;
      assert.equal((await POST(request(""))).status, 401);
      assert.equal((await POST(request(identityToken({ aud: "another-test-app" })))).status, 401);
      assert.equal((await POST(request(identityToken({ exp: 1 })))).status, 401);
      assert.equal((await POST(request(identityToken({ guest: "t" })))).status, 403);
      assert.equal(calls.length, 0);
    });

    await t.test("external Firebase failure remains a failed account exchange", async () => {
      providerUnavailable = true;
      assert.equal((await POST(request())).status, 401);
      providerUnavailable = false;
    });

    await t.test("Firebase ID-token verification and revocation checks use the real SDK", async () => {
      users.clear();
      users.set(bridgeUid, { localId: bridgeUid, validSince: "1" });
      const auth = getRmtAdminAuth()!;
      const token = firebaseIdToken(bridgeUid);
      assert.equal((await auth.verifyIdToken(token, true)).uid, bridgeUid);
      const parts = token.split(".");
      parts[2] = Buffer.alloc(256).toString("base64url");
      await assert.rejects(auth.verifyIdToken(parts.join(".")),
        (error: unknown) => (error as { code?: string }).code === "auth/argument-error");
      users.set(bridgeUid, { localId: bridgeUid, validSince: String(Math.floor(Date.now() / 1000) + 60) });
      await assert.rejects(auth.verifyIdToken(token, true),
        (error: unknown) => (error as { code?: string }).code === "auth/id-token-revoked");
    });
  } finally {
    await Promise.all(getApps().filter((app) => app.name === "rmt-live-server").map(deleteApp));
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
