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

const workflow = fs.readFileSync(path.join(repositoryRoot, ".github/workflows/production-health.yml"), "utf8");
assert.match(workflow, /api\/vnext\/market-directory/);
assert.match(workflow, /check_endpoint directory-next/);
assert.match(workflow, /encodeURIComponent/);
assert.match(workflow, /\/vnext/);

const status = fs.readFileSync(path.join(repositoryRoot, "apps/web/app/status/system-status.tsx"), "utf8");
assert.match(status, /Terminal systems healthy/);
assert.match(status, /Live Terminal checks/);
assert.doesNotMatch(status, /Protocol checks healthy|Live protocol checks/i);

console.info("Terminal-only health boundary static regression passed");
