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
assert.match(readiness, /check_endpoint directory-next/);
assert.match(readiness, /api\/vnext\/market-search/);
assert.match(readiness, /verify-production-health\.mjs/);
assert.match(readiness, /verify-public-surface\.mjs/);

console.info("Production liveness and deep-readiness schedule checks passed.");
