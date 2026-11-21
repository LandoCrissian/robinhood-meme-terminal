import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Resolve the SDK from the deployed app, including its traced dependencies.
const fromWebsite = createRequire(resolve(process.argv[2], "package.json"));
const { initializeApp, deleteApp } = fromWebsite("firebase-admin/app");
const { getAuth } = fromWebsite("firebase-admin/auth");
const { getFirestore } = fromWebsite("firebase-admin/firestore");
const app = initializeApp({ projectId: "demo-rmt-runtime" });
try {
  assert.ok(getAuth(app));
  assert.ok(getFirestore(app).collection("runtime").doc("offline"));
  const fromFirestore = createRequire(fromWebsite.resolve("firebase-admin/firestore"));
  const { FirestoreClient } = fromFirestore("@google-cloud/firestore").v1;
  const client = new FirestoreClient({ projectId: "demo-rmt-runtime" });
  await client.close();

  const fromAuth = createRequire(fromWebsite.resolve("firebase-admin/auth"));
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "runtime", alg: "RS256", use: "sig" };
  const jwks = fromAuth("jwks-rsa")({
    jwksUri: "https://offline.invalid",
    fetcher: async () => ({ keys: [jwk] }),
  });
  const result = await jwks.getSigningKey(jwk.kid);
  const format = { type: "spki", format: "der" };
  assert.deepEqual(createPublicKey(result.getPublicKey()).export(format), publicKey.export(format));
} finally {
  await deleteApp(app);
}
