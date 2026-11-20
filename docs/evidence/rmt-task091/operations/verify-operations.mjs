import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../../../..");
const read = p => readFileSync(resolve(root, p), "utf8");
const json = p => JSON.parse(read(p));
const deployed = json("docs/evidence/production-readiness/task066-backend-activation.json").binding;
const scope = [deployed.chainId, deployed.factory.toLowerCase(), deployed.deploymentBlockHash.toLowerCase()].join(":");
const sql = read("docs/evidence/rmt-task091/operations/observe-writer.sql").replace(/--[^\n]*/g, "");
const scopes = [...sql.matchAll(/WHERE scope = '([^']+)'/g)].map(x => x[1]);
assert.deepEqual(scopes, [scope, scope]);
assert.match(sql, /^\s*BEGIN TRANSACTION READ ONLY;/);
assert.match(sql, /ROLLBACK;\s*$/);
assert(!/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|pg_try_advisory_lock|pg_advisory_lock|pg_advisory_unlock)\b/i.test(sql));
assert.match(sql, /classid = 1380805961::oid/); assert.match(sql, /objid = 4663::oid/); assert.match(sql, /objsubid = 2/);
assert.match(sql, /database = \(SELECT oid FROM pg_database WHERE datname = current_database\(\)\)/);
const lock = read("apps/indexer/src/index-store.ts");
assert.match(lock, /writerNamespace = 1_380_805_961/);
assert.match(lock, /pg_try_advisory_lock\(\$1::int, \$2::int\)/);
assert.match(lock, /classid=\$1::oid AND objid=\$2::oid[\s\S]*objsubid=2 AND granted/);
const store = read("apps/indexer/src/curve-production-store.ts");
assert(store.includes('[binding.chainId, binding.factory.toLowerCase(), binding.deploymentBlockHash.toLowerCase()].join(":")'));
for (const table of ["rmt_curve_production_bindings", "rmt_curve_production_checkpoints"]) assert(store.includes(`CREATE TABLE IF NOT EXISTS ${table}`));
assert.match(store, /scope TEXT PRIMARY KEY, identity JSONB NOT NULL, next_block BIGINT/);
assert.match(store, /block_number BIGINT NOT NULL, block_hash TEXT NOT NULL,[\s\S]*observed_at TIMESTAMPTZ NOT NULL/);
const observation = json("docs/evidence/rmt-task091/operations/control-plane-observation.json");
assert.equal(observation.website.deploy.id, "6b0096332beb675b1d8e0f49");
assert.equal(observation.website.deploy.state, "ready");
assert.equal(observation.railway.worker.latestDeployment.id, "b48f0e6e-a34b-4a26-b95f-d4b978562282");
assert.equal(observation.railway.worker.latestDeployment.status, "SUCCESS");
assert.equal(observation.railway.worker.staged, null);
const keys = observation.website.bindings.map(x => x.key).sort();
assert.deepEqual(keys, ["RMT_CURVE_PRODUCTION_DISCOVERY", "RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN", "RMT_LAUNCH_HISTORY_INDEXER_URL"]);
for (const binding of observation.website.bindings) {
  assert.deepEqual(binding.contexts, ["production"]);
  assert(!Object.hasOwn(binding, "value"));
  if (binding.key.endsWith("READ_TOKEN")) {
    assert.equal(binding.isSecret, true);
    assert.deepEqual(binding.scopes, ["builds", "functions", "runtime"]);
  }
}
const backups = json("docs/evidence/rmt-task091/operations/railway-backups.json");
assert.equal(backups.volume.serviceId, "a1ef7853-e21a-401e-87c9-c99002228507");
assert.equal(backups.volume.volumeId, "bf6e7ddc-3be6-4ba7-ad53-8e7010e76c86");
assert.equal(backups.volume.id, "8f64e859-fc3c-445a-8569-1e4bfab021a6");
assert.deepEqual(backups.backups, []); assert.deepEqual(backups.schedules, []);
assert.equal(backups.pitr.enabled, false); assert.equal(backups.pitr.bucketWired, false);
assert.equal(backups.noRegisteredSshKeys, true);
assert.equal(backups.currentWriterLeaseDirectlyObserved, false);
assert.equal(backups.ownerControlledOffDeviceCopyAndKeyVerified, false);
const acceptance = json("docs/evidence/rmt-task091/operations/acceptance.json");
assert.equal(acceptance.currentProviderBackups, "VERIFIED_ABSENT");
assert.equal(acceptance.ownerDeviceAction.previewDeployedByTask091, false);
assert.equal(acceptance.ownerDeviceAction.previewUrl, null);
assert(Object.values(acceptance.changesPerformed).every(x => x === false));
assert(read("apps/launch-website/lib/server/earnings-claims.ts").includes("productionEarningsExecutionEnabled = false"));
assert(read("apps/launch-website/app/api/launchpad/config/route.ts").includes('trading: "disabled", claims: "disabled"'));
console.log(JSON.stringify({ status: "PASS_OPERATIONAL_EVIDENCE_AND_EXACT_READ_ONLY_SQL", sqlScope: scope,
  productionBackups: "ABSENT", productionWriter: "DIRECT_OBSERVATION_REQUIRED", physicalIphone: "PENDING",
  financialActivation: "BLOCKED", productionChanges: false }));
