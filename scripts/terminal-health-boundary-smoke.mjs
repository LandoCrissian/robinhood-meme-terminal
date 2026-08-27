import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const activeHealthFiles = [
  "apps/web/app/api/health/route.ts",
  "apps/web/app/status/system-status.tsx",
  "apps/web/lib/server/system-health.ts",
  "apps/web/lib/system-health.ts",
  ".github/workflows/production-health.yml",
  ".github/workflows/production-readiness.yml",
  "scripts/verify-production-liveness.mjs",
  "scripts/verify-production-health.mjs"
];
const retiredDependencies = [
  "/api/launches",
  "launches.json",
  "launches.headers",
  "robinhood-meme-terminal-production.up.railway.app",
  "v6 launch feed",
  "creator safeguards",
  "launch checkpoint drift",
  "latest v6 market",
  "launch economics",
  "graduation route"
];

for (const relativePath of activeHealthFiles) {
  const source = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8").toLowerCase();
  for (const retired of retiredDependencies) {
    assert.equal(
      source.includes(retired),
      false,
      `${relativePath} still contains retired health dependency: ${retired}`
    );
  }
}

const livenessWorkflow = fs.readFileSync(path.join(repositoryRoot, ".github/workflows/production-health.yml"), "utf8");
const readinessWorkflow = fs.readFileSync(path.join(repositoryRoot, ".github/workflows/production-readiness.yml"), "utf8");
assert.match(livenessWorkflow, /api\/health/);
assert.doesNotMatch(livenessWorkflow, /api\/vnext\/market-directory/);
assert.match(readinessWorkflow, /api\/vnext\/market-directory/);
assert.doesNotMatch(readinessWorkflow, /check_endpoint directory-next/);
assert.match(readinessWorkflow, /search-\$name-text/);
assert.match(readinessWorkflow, /MARKET_CONTROLS/);
assert.match(readinessWorkflow, /\/vnext/);

const status = fs.readFileSync(path.join(repositoryRoot, "apps/web/app/status/system-status.tsx"), "utf8");
assert.match(status, /Terminal systems healthy/);
assert.match(status, /Live Terminal checks/);
assert.doesNotMatch(status, /Protocol checks healthy|Live protocol checks/i);

console.info("Terminal-only health boundary static regression passed");
