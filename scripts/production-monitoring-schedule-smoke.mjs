import assert from "node:assert/strict";
import fs from "node:fs";

const liveness = fs.readFileSync(new URL("../.github/workflows/production-health.yml", import.meta.url), "utf8");
const readiness = fs.readFileSync(new URL("../.github/workflows/production-readiness.yml", import.meta.url), "utf8");

assert.match(liveness, /cron: "\*\/5 \* \* \* \*"/);
assert.match(liveness, /workflow_dispatch:/);
assert.match(liveness, /\/api\/health/);
assert.doesNotMatch(liveness, /api\/vnext\/market-directory|api\/vnext\/market-search/);
assert.doesNotMatch(liveness, /verify-production-health\.mjs|verify-public-surface\.mjs/);
assert.match(liveness, /verify-production-liveness\.mjs/);

assert.match(readiness, /cron: "17 \* \* \* \*"/);
assert.match(readiness, /workflow_dispatch:/);
assert.match(readiness, /api\/vnext\/market-directory/);
assert.match(readiness, /node scripts\/collect-production-directory\.mjs health-artifacts/);
assert.match(readiness, /api\/vnext\/market-search/);
assert.match(readiness, /verify-production-health\.mjs/);
assert.match(readiness, /verify-public-surface\.mjs/);
assert.match(readiness, /launchpad_status="\$\(route_status launchpad-config "\$base\/api\/launchpad\/config"\)"/);
assert.match(readiness, /404\)[\s\S]*?api\/vnext\/market-directory[\s\S]*?200\)[\s\S]*?api\/launchpad\/launches/);
assert.match(readiness, /public_status" != 404 \|\| "\$mcp_status" != 404/);
assert.match(readiness, /route_status launchpad-mcp "\$base\/mcp"[\s\S]*?--data-binary '[^\r\n]+"method":"initialize"/);
assert.match(readiness, /verify-locked-launchpad-surface\.mjs/);

console.info("Production liveness and deep-readiness schedule checks passed.");
