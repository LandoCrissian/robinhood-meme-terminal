import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  inspectDeployedIndexes,
  inspectEnvironment,
  inspectRepository,
  REQUIRED_INDEXES,
  REQUIRED_RULE_MARKERS,
  REQUIRED_TTL_COLLECTION_GROUPS
} from "./community-readiness-policy.mjs";

const validEnvironment = {
  NEXT_PUBLIC_FIREBASE_API_KEY: "public-web-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "example.test",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "rmt-test",
  NEXT_PUBLIC_FIREBASE_APP_ID: "app-id",
  FIREBASE_ADMIN_PROJECT_ID: "rmt-test",
  FIREBASE_ADMIN_CLIENT_EMAIL: "server@example.iam.gserviceaccount.com",
  FIREBASE_ADMIN_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----",
  COMMUNITY_IDENTITY_SECRET: "a".repeat(32)
};
assert.deepEqual(inspectEnvironment(validEnvironment), {
  ok: true,
  missing: [],
  invalid: []
});
assert.equal(
  inspectEnvironment({ ...validEnvironment, COMMUNITY_IDENTITY_SECRET: "short" }).ok,
  false
);

const deployed = {
  indexes: REQUIRED_INDEXES.map((index) => ({
    collectionGroup: index.collectionGroup,
    queryScope: "COLLECTION",
    fields: index.fields.map((field) => {
      const [fieldPath, order] = field.split(":");
      return { fieldPath, order };
    })
  })),
  fieldOverrides: REQUIRED_TTL_COLLECTION_GROUPS.map((collectionGroup) => ({
    collectionGroup,
    fieldPath: "expiresAt",
    ttl: true
  }))
};
assert.equal(inspectDeployedIndexes(deployed).ok, true);
assert.equal(inspectDeployedIndexes({ indexes: [], fieldOverrides: [] }).ok, false);

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "rmt-community-readiness-"));
fs.writeFileSync(
  path.join(fixture, "firebase.json"),
  JSON.stringify({
    firestore: {
      rules: "firestore.rules",
      indexes: "firestore.indexes.json"
    }
  })
);
fs.writeFileSync(
  path.join(fixture, "firestore.rules"),
  REQUIRED_RULE_MARKERS.join("\n")
);
fs.writeFileSync(
  path.join(fixture, "firestore.indexes.json"),
  JSON.stringify({ indexes: deployed.indexes })
);
assert.equal(inspectRepository(fixture).ok, true);
fs.rmSync(fixture, { recursive: true, force: true });

console.info("RMT Live readiness policy smoke test passed");
