import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";
import {join} from "node:path";
import {compileFixedSupplyProfile} from "../../../../packages/contracts/scripts/fixed-supply-profile.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const require = createRequire(join(root, "apps/launch-website/package.json"));
const {keccak256} = require("viem");
const {values} = parseArgs({options: {solc: {type: "string"}}});
assert.ok(values.solc, "Supply the unchanged pinned native solc 0.8.26 executable");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const read = path => JSON.parse(readFileSync(join(root, path), "utf8"));
const runtime = read("packages/contracts/test/fixtures/task090-canonical-v4-runtime.json");
const observedBytes = readFileSync(join(root, runtime.source));
assert.equal(sha(observedBytes), runtime.captureSha256, "Runtime observation archive changed");
const observed = JSON.parse(observedBytes), retained = read("docs/evidence/fixed-supply-security/4663-profile.json");
assert.equal(runtime.chainId, 4663);
assert.equal(observed.chainId, 4663);
assert.deepEqual(runtime.anchor, observed.anchor);
for (const name of ["poolManager", "positionManager", "permit2"]) {
  const fixture = runtime.contracts[name], official = observed.witnesses.official.contracts[name];
  assert.deepEqual(official, observed.witnesses.pocket.contracts[name], "Runtime witnesses disagree");
  assert.deepEqual(fixture, official, "Test fixture differs from observed runtime");
  assert.equal(keccak256(fixture.code), fixture.runtimeHash);
  assert.equal(fixture.runtimeHash.toLowerCase(), retained.externalRuntimePins[name].runtimeHash.toLowerCase());
  assert.equal(fixture.address.toLowerCase(), retained.externalRuntimePins[name].address.toLowerCase());
}
const fixture = read("packages/contracts/test/fixtures/task090-harvest-profile.json");
const compiled = compileFixedSupplyProfile({solc: values.solc, chainId: 31337});
assert.equal(compiled.manifest.inputSha256, "437fb783d7dce558a05317e8b15877f6d08b9571bc12aefec360382469d53648");
const portable = manifest => {
  const {executablePlatform, executableSha256, ...content} = manifest;
  return JSON.parse(JSON.stringify(content));
};
// Each current executable is independently admitted by the unchanged helper's
// native hash pin. Captured Windows identity is retained; it is not called Linux.
assert.deepEqual(portable(compiled.manifest), portable(fixture.manifest));
assert.deepEqual(Object.keys(fixture.artifacts).sort(), ["RMTLaunchCurveDeploymentV2", "RMTLaunchCurveSuccessorDeployerV1", "RMTV4CurveInitializationGuardV1"].sort());
for (const [name, artifact] of Object.entries(fixture.artifacts)) {
  assert.equal(artifact.bytecode, compiled.artifacts[name].bytecode, "Fixture differs from exact source compilation: " + name);
}
console.log(JSON.stringify({status: "PASS", scope: "EXACT_SOURCE_RECOMPILE_AND_DUAL_PROVIDER_RUNTIME_FIXTURE_IDENTITY",
  inputSha256: compiled.manifest.inputSha256, sourceCount: compiled.manifest.sourceSha256.length,
  compilerPlatform: compiled.manifest.executablePlatform, compilerSha256: compiled.manifest.executableSha256,
  runtimeWitnesses: 2, exactRuntimes: 3, bootstrapArtifacts: 3, sourceOrPolicyChanges: false,
  limitations: ["Pure local verification of archived reads and fresh compilation; no network, production storage, signatures or transactions.",
    "Fresh synthetic storage is not a mainnet-state/finality or whole-stage correctness proof."]}, null, 2));
