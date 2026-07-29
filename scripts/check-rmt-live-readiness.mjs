import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import {
  indexLabel,
  inspectDeployedIndexes,
  inspectEnvironment,
  inspectRepository
} from "./community-readiness-policy.mjs";

const argumentsList = process.argv.slice(2);
const repositoryOnly = argumentsList.includes("--repository-only");
const projectPosition = argumentsList.indexOf("--project");
const project = projectPosition >= 0 ? argumentsList[projectPosition + 1]?.trim() : "";
const rootDirectory = process.cwd();
let failed = false;

function section(label, result, details = []) {
  const state = result ? "READY" : "BLOCKED";
  console.info(`${state.padEnd(7)} ${label}`);
  for (const detail of details) console.info(`        - ${detail}`);
  if (!result) failed = true;
}

const repository = inspectRepository(rootDirectory);
section("reviewed repository controls", repository.ok, [
  ...repository.missingFiles.map((file) => `missing file: ${file}`),
  ...(repository.configValid === false ? ["firebase.json does not bind the reviewed rules and indexes"] : []),
  ...repository.missingRuleMarkers.map((marker) => `missing rules boundary: ${marker}`),
  ...repository.missingIndexes.map((index) => `missing index declaration: ${indexLabel(index)}`),
  ...(repository.messageRetentionIndexReady === false
    ? ["missing messages.expiresAt collection-group retention index"]
    : [])
]);

if (!repositoryOnly) {
  const environment = inspectEnvironment(process.env);
  section("current environment shape", environment.ok, [
    ...environment.missing.map((name) => `${name} is not present in this environment`),
    ...environment.invalid.map((name) => `${name} has an invalid shape`)
  ]);

  if (project) {
    if (!/^[a-z0-9-]{4,64}$/.test(project)) {
      section("deployed Firestore indexes and retention", false, [
        "the supplied Firebase project identifier is invalid"
      ]);
    } else {
      const command = spawnSync(
        "pnpm",
        [
          "exec",
          "firebase",
          "firestore:indexes",
          "--project",
          project,
          "--database",
          "(default)"
        ],
        {
          cwd: path.resolve(rootDirectory),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
      if (command.status !== 0) {
        section("deployed Firestore indexes and retention", false, [
          "the live read-only Firebase query failed; sign in and verify project access"
        ]);
      } else {
        try {
          const deployed = inspectDeployedIndexes(JSON.parse(command.stdout));
          section("deployed Firestore indexes", deployed.indexesReady, [
            ...deployed.missingIndexes.map(
              (index) => `not deployed: ${indexLabel(index)}`
            ),
            ...(deployed.messageRetentionIndexReady
              ? []
              : ["messages.expiresAt collection-group retention index is not deployed"])
          ]);
          if (!deployed.ttlReady) {
            console.info("INFO    managed Firestore TTL is disabled; use the bounded application retention sweep");
          }
        } catch {
          section("deployed Firestore indexes and retention", false, [
            "Firebase returned an unreadable index specification"
          ]);
        }
      }
    }
  } else {
    section("deployed Firestore indexes and retention", false, [
      "rerun with --project <firebase-project-id> to perform the read-only live check"
    ]);
  }

  section("Firebase Anonymous Authentication", false, [
    "operator verification is required in Firebase Authentication > Sign-in method"
  ]);
  section("deployed Firestore ruleset identity", false, [
    "operator verification is required; the CLI cannot prove the active ruleset matches this commit"
  ]);
  section("bounded application retention deployment", false, [
    "operator verification is required after deploying the server retention sweep"
  ]);
  section("controlled abuse and accessibility rehearsal", false, [
    "run the documented mobile, desktop, report, restriction, withdrawal, and load checks"
  ]);
}

if (failed) {
  console.error("\nRMT Live remains fail-closed. Resolve every BLOCKED item before activation.");
  process.exitCode = 1;
} else {
  console.info("\nRepository readiness checks passed. No production state was changed.");
}
