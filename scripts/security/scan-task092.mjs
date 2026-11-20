import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";
import {gunzipSync} from "node:zlib";

// Minimal Task092 adaptation of the retained Task089 scoped archive scan.
const repository = fileURLToPath(new URL("../../", import.meta.url));
const base = "86b7953ca2cdd74de87e2ceb89d93623c2194e89";
const {values} = parseArgs({options: {gitleaks: {type: "string"}, output: {type: "string"}}});
assert.ok(values.gitleaks && values.output, "Supply the verified Windows Gitleaks executable and a fresh external output directory");
const executable = resolve(values.gitleaks), output = resolve(values.output);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const executableSha256 = "17157e2ee8b76fc8b1d8bee607a250e34b8a8023c8bc81822d4b5ee4d78fcb7c";
const maxFileBytes = 32 * 1024 * 1024;
assert.equal(digest(readFileSync(executable)), executableSha256, "Windows Gitleaks executable identity changed");
const version = spawnSync(executable, ["version"], {encoding: "utf8", windowsHide: true});
assert.equal(version.status, 0, "Scanner version check failed");
assert.equal(version.stdout.trim(), "8.30.1", "Scanner version changed");
assert.equal(existsSync(output), false, "Scan evidence must not overwrite an earlier run");
const outside = relative(repository, output);
assert.ok(outside.startsWith(".." + sep) || isAbsolute(outside), "Raw scan output must stay outside the repository");
const git = args => {
  const result = spawnSync("git", args, {cwd: repository, encoding: null, windowsHide: true, maxBuffer: 8 * 1024 * 1024});
  assert.equal(result.status, 0, "Git source inventory failed"); return result.stdout;
};
const paths = args => git(args).toString("utf8").split("\0").filter(Boolean);
const selected = new Set([...paths(["diff", "--name-only", "-z", "--diff-filter=ACMR", base, "--"]),
  ...paths(["ls-files", "--others", "--exclude-standard", "-z"])]);
// Include ALL Task092 evidence, including ignored logs. Never walk another
// repository, private rollout directories, the user's home, or node_modules.
function evidenceFiles(directory, result = selected) {
  assert.equal(lstatSync(directory).isSymbolicLink(), false, "Evidence directory symlinks are not admitted");
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    assert.equal(lstatSync(path).isSymbolicLink(), false, "Evidence symlinks are not admitted");
    if (entry.isDirectory()) evidenceFiles(path, result);
    else if (entry.isFile()) result.add(relative(repository, path).split(sep).join("/"));
    else assert.fail("Non-regular Task092 evidence is not admitted");
  }
}
evidenceFiles(join(repository, "docs/evidence/rmt-task092"));
// A derived report cannot attest its own final bytes. These five exact outputs
// are the sole exclusions; a README, producer or other file here stays in scope.
const excludedGeneratedOutputs = ["scan-manifest.json", "gitleaks-redacted.json", "gitleaks.txt",
  "raw-exit-code.txt", "public-classification.json"].map(name => "docs/evidence/rmt-task092/validation/final-scan/" + name);
for (const path of excludedGeneratedOutputs) selected.delete(path);
const policy = {};
for (const name of [".gitleaks.toml", ".gitleaksignore"]) {
  const current = readFileSync(join(repository, name));
  assert.deepEqual(current, git(["show", base + ":" + name]), "Original scanner policy changed: " + name);
  policy[name] = digest(current);
}
mkdirSync(output, {mode: 0o700});
const snapshot = join(output, "snapshot"); mkdirSync(snapshot);
const inventory = [];
for (const path of [...selected].sort()) {
  assert.ok(!isAbsolute(path) && !path.split(/[\\/]/).includes(".."), "Invalid source inventory path");
  const source = join(repository, path);
  assert.ok(lstatSync(source).isFile() && !lstatSync(source).isSymbolicLink(), "Only regular repository files may be scanned");
  const bytes = readFileSync(source), target = join(snapshot, "source", path);
  assert.ok(bytes.length <= maxFileBytes, "Source exceeds the explicit scanner file bound: " + path);
  mkdirSync(dirname(target), {recursive: true}); writeFileSync(target, bytes, {flag: "wx"});
  const row = {path, bytes: bytes.length, contentDigest: {algorithm: "SHA-256", hex: digest(bytes)}, scanPath: "source/" + path};
  if (path.endsWith(".gz")) {
    const expanded = gunzipSync(bytes, {maxOutputLength: maxFileBytes});
    const expandedPath = "expanded/" + path.slice(0, -3);
    const expandedTarget = join(snapshot, expandedPath);
    mkdirSync(dirname(expandedTarget), {recursive: true}); writeFileSync(expandedTarget, expanded, {flag: "wx"});
    row.gzip = {scanPath: expandedPath, bytes: expanded.length, contentDigest: {algorithm: "SHA-256", hex: digest(expanded)}};
  }
  inventory.push(row);
}
const args = ["dir", snapshot, "--config", join(repository, ".gitleaks.toml"),
  "--gitleaks-ignore-path", join(repository, ".gitleaksignore"), "--max-target-megabytes", "32",
  "--no-banner", "--no-color", "--redact=100", "--report-format", "json", "--report-path", join(output, "gitleaks-redacted.json")];
const result = spawnSync(executable, args, {cwd: repository, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024});
writeFileSync(join(output, "gitleaks.txt"), (result.stdout ?? "") + (result.stderr ?? ""));
writeFileSync(join(output, "raw-exit-code.txt"), String(result.status) + "\n");
assert.ok(result.status === 0 || result.status === 1, "Scanner execution failed; inspect the retained local log");
const report = JSON.parse(readFileSync(join(output, "gitleaks-redacted.json"), "utf8"));
assert.ok(Array.isArray(report), "Scanner report is not a finding array");
// Refuse to attest a worktree that changed during the frozen capture/scan.
const after = new Set([...paths(["diff", "--name-only", "-z", "--diff-filter=ACMR", base, "--"]),
  ...paths(["ls-files", "--others", "--exclude-standard", "-z"])]);
evidenceFiles(join(repository, "docs/evidence/rmt-task092"), after);
for (const path of excludedGeneratedOutputs) after.delete(path);
assert.deepEqual([...after].sort(), inventory.map(row => row.path), "Source inventory changed during scan; use a new frozen snapshot");
for (const row of inventory) assert.equal(digest(readFileSync(join(repository, row.path))), row.contentDigest.hex,
  "Source changed during scan; use a new frozen snapshot: " + row.path);
for (const [name, expected] of Object.entries(policy)) assert.equal(digest(readFileSync(join(repository, name))), expected,
  "Scanner policy changed during scan: " + name);
const manifest = {schemaVersion: 1, scope: "CHANGED_SOURCE_AND_ALL_TASK092_EVIDENCE_WITH_LOSSLESS_EXPANDED_GZIP", base,
  capturedAt: new Date().toISOString(), scanner: {version: "8.30.1", executableSha256,
    officialRelease: "https://api.github.com/repos/gitleaks/gitleaks/releases/tags/v8.30.1",
    asset: "gitleaks_8.30.1_windows_x64.zip", assetSha256: "d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e",
    maxTargetMegabytes: 32, maxGzipOutputBytes: maxFileBytes},
  unchangedPolicyDigests: policy, rawExit: result.status, rawFindingCount: report.length,
  sourceFileCount: inventory.length, expandedGzipCount: inventory.filter(row => row.gzip).length,
  reportSha256: digest(readFileSync(join(output, "gitleaks-redacted.json"))), excludedGeneratedOutputs, inventory,
  limits: ["This is a scoped worktree snapshot scan, not a clean full-history claim or financial gate clearance.",
    "Files created or edited after capture require another scan or exact-head CI; derived scan reports cannot attest their own final bytes."]};
writeFileSync(join(output, "scan-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({output, rawExit: result.status, findings: report.length, sourceFiles: inventory.length,
  expandedGzip: manifest.expandedGzipCount}));
process.exitCode = result.status;
