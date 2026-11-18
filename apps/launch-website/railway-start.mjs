import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export const readOnlyProfile = "railway-read-only-v1";
const project = "19587a6e-6f02-4cfa-b7db-f308934f697b";
const environment = "539a42da-fb60-420f-b9fa-8c29af25ebbe";
const indexer = "http://robinhood-meme-terminal.railway.internal:3001/";
const previewOrigin = "https://rmt-launch-website-preview.up.railway.app";

export function validateRailwayRuntime(env) {
  assert.equal(env.RMT_WEB_HOSTING, readOnlyProfile, "Explicit read-only hosting profile required");
  assert.equal(env.RAILWAY_PROJECT_ID, project, "Different Railway project");
  assert.equal(env.RAILWAY_ENVIRONMENT_ID, environment, "Different Railway environment");
  assert.equal(env.RAILWAY_SERVICE_ID, "8e9c1c15-74b5-4262-8851-72603a3dfc98", "Different website service");
  assert.equal(env.RMT_INDEXER_SERVICE_ID, "27b1aa2c-77e5-4ed4-91a1-1951d68c488e", "Different indexer service");
  assert.equal(env.RMT_WEB_ORIGIN, previewOrigin, "Explicit verified preview origin required; production cutover is separately reviewed");
  assert.equal(env.RMT_LAUNCH_HISTORY_INDEXER_URL, indexer, "Only the pinned existing private indexer is admitted");
  assert.match(env.RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN ?? "", /^[\x21-\x7e]{20,512}$/, "Existing server-only read credential required");
  assert.match(env.PORT ?? "3000", /^[1-9][0-9]{0,4}$/, "Invalid service port");
  assert.ok(Number(env.PORT ?? 3000) <= 65535, "Invalid service port");
  for (const [key, value] of Object.entries(env)) {
    if (value && (/^RMT_(?:PROFILES|CURVE|FIREBASE|MOBILE_REVIEW|PRIVATE_PREVIEW)/.test(key)
      || /^(?:FIREBASE_|FIRESTORE_)/.test(key)
      || /^(?:STORAGE_EMULATOR_HOST|GCLOUD_PROJECT|GOOGLE_CLOUD_PROJECT|GOOGLE_APPLICATION_CREDENTIALS|DATABASE_URL|DATABASE_PRIVATE_URL)$/.test(key)
      || /(?:PRIVATE_KEY|SEED_PHRASE)$/.test(key))) {
      throw new Error("Read-only website rejects unrelated privileged or activation configuration: " + key);
    }
  }
  return { origin: previewOrigin, port: Number(env.PORT ?? 3000), profile: readOnlyProfile };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = validateRailwayRuntime(process.env);
    process.env.RMT_WEB_ORIGIN = config.origin;
    process.env.HOSTNAME = "0.0.0.0";
    process.env.PORT = String(config.port);
    await import("./server.js");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Read-only website startup rejected");
    process.exitCode = 1;
  }
}
