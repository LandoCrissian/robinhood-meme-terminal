import assert from "node:assert/strict";
import {spawnSync, execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {resolve, join} from "node:path";
import {fileURLToPath} from "node:url";
import {gzipSync} from "node:zlib";
import {parseArgs} from "node:util";
import {verifiedSolcExecution} from "../../packages/contracts/scripts/pinned-solc.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const {values} = parseArgs({options: {forge: {type: "string"}, solc: {type: "string"}, output: {type: "string"}}});
assert.ok(values.forge && values.solc && values.output, "--forge, --solc, --output are required");
const forge = resolve(values.forge), output = resolve(values.output), solc = resolve(values.solc);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const compiler = verifiedSolcExecution({solc});
const forgeVersion = execFileSync(forge, ["--version"], {encoding: "utf8", windowsHide: true});
assert.match(forgeVersion, /forge Version: 1\.7\.1(?:\s|$)/);
mkdirSync(output, {recursive: true});
const names = [
  "testCanonicalInitializationCannotBeFrontRunAndUnrelatedPoolCannotRedirectGraduation()",
  "testValidEoaPermitDoesNotAuthorizeContractEngineOrSignatureTransfer()",
  "testUnadmittedCallerCannotFundOrAttachAnotherTokenToEngine()",
  "testOriginalNftSignatureAndSubscriptionPathsCannotAcquireEngineAuthority()",
];
const match = "^(" + names.map(name => name.slice(0, -2)).join("|") + ")";
const summary = {schemaVersion: 1, type: "ISOLATED_ADMISSION_SIGNATURE_BOUNDARY_ACCEPTANCE", compiler,
  forgeVersion, forgeSha256: sha(readFileSync(forge)), sourceBase: "27f19787ed0a2d904ba4508d2adfab1773e82e67",
  testSource: {path: "packages/contracts/test/Task091AdmissionAcceptance.t.sol",
    sha256: sha(readFileSync(join(root, "packages/contracts/test/Task091AdmissionAcceptance.t.sol")))},
  liveRpc: false, syntheticAccountsAndStorage: true, productionWrites: false, signatures: "KNOWN_TEST_KEY_9_ONLY_IN_LOCAL_VM",
  profiles: []};
for (const canonical of [false, true]) {
  const profile = canonical ? "canonical4663" : "default31337";
  const args = ["test", "--root", join(root, "packages/contracts"), "--offline", "--use", solc,
    "--out", join(output, "build"), "--cache-path", join(output, "cache"), "--threads", "1",
    "--match-contract", "^Task091AdmissionAcceptanceTest$", "--match-test", match, "--json", "-vvvv"];
  const result = spawnSync(forge, args, {cwd: root, windowsHide: true,
    env: {...process.env, RMT_TASK090_GRADUATION_CANONICAL: String(canonical)},
    encoding: "utf8", maxBuffer: 250_000_000, timeout: 600_000});
  const raw = Buffer.from(result.stdout || "");
  const packed = gzipSync(raw);
  writeFileSync(join(output, profile + ".json.gz"), packed);
  writeFileSync(join(output, profile + ".stderr.log"), result.stderr || "");
  writeFileSync(join(output, profile + ".process.json"), JSON.stringify({args, status: result.status,
    signal: result.signal, error: result.error?.message}, null, 2) + "\n");
  assert.equal(result.error, undefined, "Forge process error");
  assert.equal(result.status, 0, "Forge failed: " + profile + " (retained output)");
  const parsed = JSON.parse(raw), suites = Object.entries(parsed);
  assert.equal(suites.length, 1);
  assert.ok(suites[0][0].endsWith(":Task091AdmissionAcceptanceTest"));
  const tests = suites[0][1].test_results;
  assert.deepEqual(Object.keys(tests).sort(), [...names].sort(), "all four new cases must execute");
  for (const result of Object.values(tests)) assert.equal(result.status, "Success");
  summary.profiles.push({profile, chainId: canonical ? 4663 : 31337,
    economics: canonical ? "EXACT_4663_CREATION_BYTES_2_ETH_GRADUATION" : "UNTRANSFORMED_31337_1_ETH_UNIT_PROFILE",
    passed: names.length, failed: 0, skipped: 0, names, command: {program: forge, args},
    raw: {file: profile + ".json.gz", compressedSha256: sha(packed), expandedSha256: sha(raw),
      compressedBytes: packed.length, expandedBytes: raw.length}});
  writeFileSync(join(output, "proof-results.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({profile, passed: names.length, failed: 0, skipped: 0, compressedBytes: packed.length}));
}
summary.result = "PASS";
writeFileSync(join(output, "proof-results.json"), JSON.stringify(summary, null, 2) + "\n");
