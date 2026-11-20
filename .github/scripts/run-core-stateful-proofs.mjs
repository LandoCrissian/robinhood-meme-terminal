import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {closeSync, copyFileSync, mkdirSync, openSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {parseArgs} from "node:util";
import {verifiedSolcExecution} from "../../packages/contracts/scripts/pinned-solc.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const suites = [
  {name: "Task090GraduationProofTest", count: 6, fuzzTests: 1, file: "graduation"},
  {name: "Task090MigrationProofTest", count: 9, fuzzTests: 1, file: "migration"},
  {name: "Task090HarvestProofTest", count: 5, fuzzTests: 0, file: "harvest"},
];

export function validateProofSuite(report, {name, count, fuzzTests}, fuzzRuns = 512) {
  const entries = Object.entries(report);
  assert.equal(entries.length, 1, "Exactly the requested focused suite must execute");
  const [identity, suite] = entries[0];
  assert.ok(identity.endsWith(":" + name), "Unexpected test contract");
  const tests = Object.entries(suite.test_results);
  assert.equal(tests.length, count, "Missing or additional focused proof case");
  for (const [test, result] of tests) assert.equal(result.status, "Success", "Failed or skipped proof: " + test);
  const fuzz = tests.filter(([name]) => name.startsWith("testFuzz"));
  assert.equal(fuzz.length, fuzzTests, "Missing focused fuzz proof");
  for (const [name, result] of fuzz) assert.equal(result.kind.Fuzz.runs, fuzzRuns, "Wrong fuzz run count: " + name);
  return {name, passed: tests.length, failed: 0, skipped: 0, fuzzTests: fuzz.length, fuzzRuns};
}

function main() {
  const {values} = parseArgs({options: {forge: {type: "string"}, solc: {type: "string"},
    output: {type: "string"}, profile: {type: "string"}}});
  assert.ok(values.forge && values.solc && values.output);
  assert.ok(["default31337", "canonical4663"].includes(values.profile));
  const canonical = values.profile === "canonical4663", output = resolve(values.output);
  mkdirSync(output, {recursive: true});
  const forge = resolve(values.forge), solc = resolve(values.solc);
  const compiler = verifiedSolcExecution({solc});
  const version = execFileSync(forge, ["--version"], {encoding: "utf8", windowsHide: true});
  assert.match(version, /forge Version: 1\.7\.1(?:\s|$)/);
  const environment = {...process.env, RMT_TASK090_GRADUATION_CANONICAL: String(canonical),
    RMT_TASK090_MIGRATION_CANONICAL: String(canonical), RMT_TASK090_MIGRATION_CHAIN_ID: canonical ? "4663" : "31337"};
  const rows = [];
  const summary = {profile: values.profile, compiler, forgeVersion: version,
    forgeSha256: createHash("sha256").update(readFileSync(forge)).digest("hex"),
    harvestScope: "BOTH_MATRIX_LEGS_USE_EXACT_LOCAL_CHAIN_31337_2_ETH_HARVEST_FIXTURE_NOT_CANONICAL_4663_STORAGE",
    liveRpc: false, productionExecution: false, financialAuthorization: false, rows};
  for (const suite of suites) {
    const args = ["test", "--root", join(root, "packages/contracts"), "--offline", "--use", solc,
      "--out", join(output, "build"), "--cache-path", join(output, "cache"), "--threads", "1",
      "--match-contract", "^" + suite.name + "$", "--fuzz-runs", "512", "--json", "-vvvv"];
    const stdout = openSync(join(output, suite.file + ".json"), "w"), stderr = openSync(join(output, suite.file + ".stderr.log"), "w");
    let child;
    try { child = spawnSync(forge, args, {cwd: root, env: environment, stdio: ["ignore", stdout, stderr],
      windowsHide: true, timeout: 600_000}); }
    finally { closeSync(stdout); closeSync(stderr); }
    writeFileSync(join(output, suite.file + ".exit.json"), JSON.stringify({command: forge, arguments: args,
      status: child.status, signal: child.signal, error: child.error?.message}, null, 2) + "\n");
    try {
      assert.equal(child.error, undefined, "Forge process failed");
      assert.equal(child.status, 0, "Forge returned failure");
      rows.push({...validateProofSuite(JSON.parse(readFileSync(join(output, suite.file + ".json"))), suite), status: "PASS"});
    } catch (error) { rows.push({name: suite.name, status: "FAIL", reason: error.message}); }
    console.log(JSON.stringify(rows.at(-1)));
    writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  }
  copyFileSync(join(output, "build/Task090HarvestProof.t.sol/Task090HarvestProofTest.json"), join(output, "harvest-test-artifact.json"));
  assert.equal(rows.filter(row => row.status === "PASS").length, 3, "All three focused suites must pass");
  assert.equal(rows.reduce((total, row) => total + row.passed, 0), 20);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
