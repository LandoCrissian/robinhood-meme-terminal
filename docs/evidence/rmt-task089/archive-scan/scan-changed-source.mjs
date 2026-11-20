import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";
import {gunzipSync} from "node:zlib";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const base = "78a76feb592ac136dbf74d4823c21db64a6d0313";
const {values} = parseArgs({options: {gitleaks: {type: "string"}, output: {type: "string"}}});
assert.ok(values.gitleaks && values.output, "Supply the verified Windows Gitleaks executable and a fresh external output directory");
const executable = resolve(values.gitleaks), output = resolve(values.output);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const executableSha256 = "17157e2ee8b76fc8b1d8bee607a250e34b8a8023c8bc81822d4b5ee4d78fcb7c";
assert.equal(digest(readFileSync(executable)), executableSha256, "Windows Gitleaks executable identity changed");
assert.equal(existsSync(output), false, "Scan evidence must not overwrite an earlier run");
const outside = relative(repository, output);
assert.ok(outside.startsWith(".." + sep) || isAbsolute(outside), "Raw scan output must stay outside the repository");
mkdirSync(output, {mode: 0o700});
const snapshot = join(output, "snapshot"); mkdirSync(snapshot);
const git = args => {
  const result = spawnSync("git", args, {cwd: repository, encoding: null, windowsHide: true, maxBuffer: 8 * 1024 * 1024});
  assert.equal(result.status, 0, "Git source inventory failed"); return result.stdout;
};
const paths = args => git(args).toString("utf8").split("\0").filter(Boolean);
const selected = new Set([...paths(["diff", "--name-only", "-z", "--diff-filter=ACMR", base, "--"]),
  ...paths(["ls-files", "--others", "--exclude-standard", "-z"])]);
// Include every new Task089 artifact, including evidence files ignored by Git's
// generic log patterns. Never walk the user's home, other repos, or node_modules.
function evidenceFiles(directory) {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name); assert.equal(lstatSync(path).isSymbolicLink(), false, "Evidence symlinks are not admitted");
    if (entry.isDirectory()) evidenceFiles(path);
    else if (entry.isFile()) selected.add(relative(repository, path).split(sep).join("/"));
  }
}
evidenceFiles(join(repository, "docs/evidence/rmt-task089"));
// A snapshot inventory/report cannot attest its own final bytes. Exclude only
// these derived outputs; the producer, README and tool provenance stay in scope.
const excludedGeneratedOutputs = ["scan-manifest.json", "gitleaks-redacted.json", "gitleaks.txt"]
  .map(name => "docs/evidence/rmt-task089/archive-scan/" + name);
for (const path of excludedGeneratedOutputs) selected.delete(path);
const policy = {};
for (const name of [".gitleaks.toml", ".gitleaksignore"]) {
  const current = readFileSync(join(repository, name));
  assert.deepEqual(current, git(["show", base + ":" + name]), "Original scanner policy changed: " + name);
  policy[name] = digest(current);
}
const inventory = [];
for (const path of [...selected].sort()) {
  assert.ok(!isAbsolute(path) && !path.split(/[\\/]/).includes(".."), "Invalid source inventory path");
  const source = join(repository, path);
  assert.ok(lstatSync(source).isFile() && !lstatSync(source).isSymbolicLink(), "Only regular repository files may be scanned");
  const bytes = readFileSync(source), target = join(snapshot, "source", path);
  mkdirSync(dirname(target), {recursive: true}); writeFileSync(target, bytes, {flag: "wx"});
  const row = {path, bytes: bytes.length, sha256: digest(bytes), scanPath: "source/" + path};
  if (path.endsWith(".gz")) {
    const expanded = gunzipSync(bytes, {maxOutputLength: 32 * 1024 * 1024});
    const expandedPath = "expanded/" + path.slice(0, -3);
    const expandedTarget = join(snapshot, expandedPath);
    mkdirSync(dirname(expandedTarget), {recursive: true}); writeFileSync(expandedTarget, expanded, {flag: "wx"});
    row.gzip = {scanPath: expandedPath, bytes: expanded.length, sha256: digest(expanded)};
  }
  inventory.push(row);
}
const args = ["dir", snapshot, "--config", join(repository, ".gitleaks.toml"), "--no-banner", "--redact", "--report-format", "json", "--report-path", join(output, "gitleaks-redacted.json")];
const result = spawnSync(executable, args, {cwd: repository, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024});
writeFileSync(join(output, "gitleaks.txt"), (result.stdout ?? "") + (result.stderr ?? ""));
assert.ok(result.status === 0 || result.status === 1, "Scanner execution failed; inspect the retained local log");
const report = JSON.parse(readFileSync(join(output, "gitleaks-redacted.json"), "utf8"));
const manifest = {schemaVersion: 1, scope: "CHANGED_SOURCE_AND_ALL_NEW_TASK089_EVIDENCE_WITH_EXPANDED_GZIP", base,
  capturedAt: new Date().toISOString(), scanner: {version: "8.30.1", executableSha256,
    officialRelease: "https://api.github.com/repos/gitleaks/gitleaks/releases/tags/v8.30.1",
    asset: "gitleaks_8.30.1_windows_x64.zip", assetSha256: "d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e"},
  unchangedPolicyDigests: policy, rawExit: result.status, rawFindingCount: report.length,
  sourceFileCount: inventory.length, expandedGzipCount: inventory.filter(row => row.gzip).length,
  reportSha256: digest(readFileSync(join(output, "gitleaks-redacted.json"))), excludedGeneratedOutputs, inventory,
  limits: ["This is a scoped worktree snapshot scan, not a clean full-history claim or financial gate clearance.",
    "Files created or edited after capture require another scan or exact-head CI; derived scan reports cannot attest their own final bytes."]};
writeFileSync(join(output, "scan-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({output, rawExit: result.status, findings: report.length, sourceFiles: inventory.length, expandedGzip: manifest.expandedGzipCount}));
process.exitCode = result.status;
