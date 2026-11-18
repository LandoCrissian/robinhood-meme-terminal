import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { values } = parseArgs({ options: { command: { type: "string", default: "node --test scripts/profiles/emulator-rules.test.mjs" } } });
const configuration = JSON.parse(readFileSync(resolve(root, "firebase.profiles.json"), "utf8"));
for (const [name, settings] of Object.entries(configuration.emulators)) {
  if (typeof settings === "object" && settings.host) assert.equal(settings.host, "127.0.0.1", name + " must bind to loopback only");
}
assert.equal(configuration.emulators.singleProjectMode, true);
assert.equal(configuration.emulators.ui.enabled, false);
const env = { ...process.env, GCLOUD_PROJECT: "demo-rmt-launch-profiles", GOOGLE_CLOUD_PROJECT: "demo-rmt-launch-profiles",
  CI: "true", FIREBASE_CLI_DISABLE_UPDATE_CHECK: "true" };
// Neither application credentials nor a real project may leak into test startup.
for (const key of Object.keys(env)) if (/^(GOOGLE_APPLICATION_CREDENTIALS|FIREBASE_CONFIG|FIREBASE_TOKEN|FIREBASE_SERVICE_ACCOUNT_JSON|FIREBASE_ADMIN_.*|RMT_FIREBASE_.*|RMT_PROFILES_(?:MODE|ORIGIN|ACTIVATION_APPROVAL)|NEXT_PUBLIC_FIREBASE_.*)$/.test(key)) delete env[key];
for (const key of ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST", "FIREBASE_EMULATOR_HUB"]) delete env[key];
const javaHome = process.env.RMT_PROFILE_JAVA_HOME;
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path"), inheritedPath = pathKey ? env[pathKey] : "";
for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
env.PATH = [...(javaHome ? [resolve(javaHome, "bin")] : []), dirname(process.execPath), inheritedPath].join(process.platform === "win32" ? ";" : ":");
const java = spawnSync(javaHome ? resolve(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java") : "java", ["-version"], { env, encoding: "utf8", windowsHide: true });
assert.equal(java.status, 0, "Java 21+ is required; set RMT_PROFILE_JAVA_HOME to a local JRE directory");
const version = (java.stderr + java.stdout).match(/version "(\d+)/);
assert.ok(version && Number(version[1]) >= 21, "Firebase Emulator Suite requires Java 21+");
const cli = require.resolve("firebase-tools/lib/bin/firebase.js");
console.log("Starting Auth/Firestore/Storage emulators on loopback with demo-rmt-launch-profiles. No cloud service is provisioned.");
const child = spawn(process.execPath, [cli, "emulators:exec", "--project", "demo-rmt-launch-profiles", "--config", "firebase.profiles.json",
  "--only", "auth,firestore,storage", values.command], { cwd: root, env, stdio: "inherit", windowsHide: true });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
child.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.once("exit", (code) => { process.exitCode = code ?? 1; });
