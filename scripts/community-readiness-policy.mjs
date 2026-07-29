import fs from "node:fs";
import path from "node:path";

export const REQUIRED_ENVIRONMENT = Object.freeze([
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
  "FIREBASE_ADMIN_PROJECT_ID",
  "FIREBASE_ADMIN_CLIENT_EMAIL",
  "FIREBASE_ADMIN_PRIVATE_KEY",
  "COMMUNITY_IDENTITY_SECRET"
]);

export const REQUIRED_RULE_MARKERS = Object.freeze([
  "match /communityRooms/{roomId}",
  "match /communityActors/{authorKey}",
  "match /communityPresence/{authorKey}",
  "match /communityReports/{reportId}",
  "match /communityModerationAudit/{auditId}",
  "match /communityFeedback/{feedbackId}",
  "match /communityFeedbackStatus/{feedbackId}",
  "match /communityFeedbackAudit/{auditId}",
  "match /communityRateLimits/{bucketId}"
]);

export const REQUIRED_INDEXES = Object.freeze([
  Object.freeze({
    collectionGroup: "communityReports",
    fields: Object.freeze(["status:ASCENDING", "createdAt:DESCENDING"])
  }),
  Object.freeze({
    collectionGroup: "communityPresence",
    fields: Object.freeze(["roomId:ASCENDING", "expiresAt:ASCENDING"])
  }),
  Object.freeze({
    collectionGroup: "messages",
    fields: Object.freeze(["status:ASCENDING", "createdAt:DESCENDING"])
  })
]);

export const REQUIRED_TTL_COLLECTION_GROUPS = Object.freeze([
  "messages",
  "communityReports",
  "communityFeedback",
  "communityFeedbackStatus",
  "communityModerationAudit",
  "communityFeedbackAudit",
  "communityActors",
  "communityPresence",
  "communityRateLimits"
]);

function normalizedIndex(index) {
  return {
    collectionGroup: index?.collectionGroup ?? "",
    fields: (index?.fields ?? []).map((field) => (
      `${field.fieldPath}:${field.order ?? field.arrayConfig ?? ""}`
    ))
  };
}

function indexMatches(actual, expected) {
  return actual.collectionGroup === expected.collectionGroup
    && actual.fields.length === expected.fields.length
    && expected.fields.every((field, position) => actual.fields[position] === field);
}

export function inspectRepository(rootDirectory) {
  const requiredFiles = [
    "firebase.json",
    "firestore.rules",
    "firestore.indexes.json"
  ];
  const missingFiles = requiredFiles.filter(
    (file) => !fs.existsSync(path.join(rootDirectory, file))
  );
  if (missingFiles.length > 0) {
    return {
      ok: false,
      missingFiles,
      missingRuleMarkers: [...REQUIRED_RULE_MARKERS],
      missingIndexes: [...REQUIRED_INDEXES]
    };
  }

  const firebase = JSON.parse(
    fs.readFileSync(path.join(rootDirectory, "firebase.json"), "utf8")
  );
  const rules = fs.readFileSync(path.join(rootDirectory, "firestore.rules"), "utf8");
  const indexes = JSON.parse(
    fs.readFileSync(path.join(rootDirectory, "firestore.indexes.json"), "utf8")
  );
  const actualIndexes = (indexes.indexes ?? []).map(normalizedIndex);
  const missingRuleMarkers = REQUIRED_RULE_MARKERS.filter(
    (marker) => !rules.includes(marker)
  );
  const missingIndexes = REQUIRED_INDEXES.filter(
    (expected) => !actualIndexes.some((actual) => indexMatches(actual, expected))
  );
  const configValid = firebase?.firestore?.rules === "firestore.rules"
    && firebase?.firestore?.indexes === "firestore.indexes.json";

  return {
    ok: configValid && missingRuleMarkers.length === 0 && missingIndexes.length === 0,
    missingFiles,
    configValid,
    missingRuleMarkers,
    missingIndexes
  };
}

export function inspectEnvironment(environment) {
  const missing = REQUIRED_ENVIRONMENT.filter(
    (name) => typeof environment[name] !== "string" || environment[name].trim() === ""
  );
  const secret = environment.COMMUNITY_IDENTITY_SECRET?.trim() ?? "";
  const privateKey = (environment.FIREBASE_ADMIN_PRIVATE_KEY ?? "")
    .replaceAll("\\n", "\n")
    .trim();
  const clientEmail = environment.FIREBASE_ADMIN_CLIENT_EMAIL?.trim() ?? "";
  const invalid = [];

  if (secret && secret.length < 32) invalid.push("COMMUNITY_IDENTITY_SECRET");
  if (clientEmail && !clientEmail.endsWith(".gserviceaccount.com")) {
    invalid.push("FIREBASE_ADMIN_CLIENT_EMAIL");
  }
  if (
    privateKey
    && (
      !privateKey.startsWith("-----BEGIN PRIVATE KEY-----")
      || !privateKey.endsWith("-----END PRIVATE KEY-----")
    )
  ) {
    invalid.push("FIREBASE_ADMIN_PRIVATE_KEY");
  }

  return {
    ok: missing.length === 0 && invalid.length === 0,
    missing,
    invalid
  };
}

export function inspectDeployedIndexes(indexSpecification) {
  const actualIndexes = (indexSpecification?.indexes ?? []).map(normalizedIndex);
  const missingIndexes = REQUIRED_INDEXES.filter(
    (expected) => !actualIndexes.some((actual) => indexMatches(actual, expected))
  );
  const ttlCollectionGroups = new Set(
    (indexSpecification?.fieldOverrides ?? [])
      .filter((field) => field?.ttl === true || field?.ttl?.enabled === true)
      .map((field) => field.collectionGroup)
  );
  const missingTtlPolicies = REQUIRED_TTL_COLLECTION_GROUPS.filter(
    (collectionGroup) => !ttlCollectionGroups.has(collectionGroup)
  );

  return {
    ok: missingIndexes.length === 0 && missingTtlPolicies.length === 0,
    missingIndexes,
    missingTtlPolicies
  };
}

export function indexLabel(index) {
  return `${index.collectionGroup} (${index.fields.join(", ")})`;
}
