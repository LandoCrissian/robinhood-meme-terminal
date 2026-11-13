import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { robinhood4663ReviewNetwork } from "./robinhood-4663-fork-environment.mjs";
import { buildCurveReviewCompilerInput } from "./validate-curve-graduation-4663.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const deploymentRoots = [
  "src/RMTLaunchCurveDeploymentV1.sol",
  "src/RMTLaunchCurveDirectoryV1.sol",
  "src/RMTLaunchProjectRegistryV1.sol",
  "src/RMTLaunchBondingCurveV2.sol",
  "src/RMTLaunchBondingCurveV3.sol",
];
const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const { values } = parseArgs({ options: {
  solc: { type: "string" }, output: { type: "string" }, python: { type: "string", default: "python" },
  "fork-evidence": { type: "string" },
} });
assert.ok(values.solc && values.output && values["fork-evidence"],
  "Provide --solc <verified binary> --output <new directory> --fork-evidence <2 ETH 4663 JSON> [--python <executable>]");
const compiler = resolve(values.solc);
const output = resolve(values.output);
const forkBytes = readFileSync(resolve(values["fork-evidence"]));
const fork = JSON.parse(forkBytes);
const backing = 2_000_000_000_000_000_000n;
const review = buildCurveReviewCompilerInput({ solc: compiler }, 4663, backing);
const inputHash = sha256(review.input);
assert.equal(fork.manifest.chainId, 4663);
assert.equal(fork.manifest.inputSha256, inputHash, "Fork and production analysis compiler inputs differ");
assert.equal(fork.terms.backingWei, backing.toString());
const network = fork.report.network;
for (const [field, expected] of Object.entries(robinhood4663ReviewNetwork)) {
  assert.deepEqual(network[field], expected, "Fork dependency evidence differs from approved pin: " + field);
}
assert.deepEqual(fork.report.execution, { chainId: 4663, anvil: "1.7.1", hardfork: "cancun", host: "127.0.0.1", fixtureKeys: 0 });
assert.equal(fork.report.archiveBoundary.blockedWriteProbe, "HTTP 403");

const slitherArgs = ["-m", "slither"];
const { slither, cryticCompile } = JSON.parse(execFileSync(values.python, ["-c",
  "import json; from importlib.metadata import version; print(json.dumps(dict(slither=version('slither-analyzer'), cryticCompile=version('crytic-compile'))))"],
{ encoding: "utf8" }));
assert.equal(slither, "0.11.5", "Expected the same Slither version as the full-tree gate");
assert.equal(cryticCompile, "0.3.11", "Expected the reviewed Slither compiler adapter");

const standardInput = JSON.parse(review.input);
const graphInput = { ...standardInput, settings: { ...standardInput.settings, outputSelection: { "*": { "": ["ast"] } } } };
const astOutput = JSON.parse(execFileSync(compiler, ["--standard-json", "--no-import-callback"], {
  cwd: root, input: JSON.stringify(graphInput), encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 180_000,
}));
const graphErrors = (astOutput.errors ?? []).filter(({ severity }) => severity === "error");
assert.equal(graphErrors.length, 0, graphErrors.map(({ formattedMessage }) => formattedMessage).join("\n"));
const importGraph = new Map(Object.entries(astOutput.sources).map(([file, { ast }]) => [
  file, ast.nodes.filter(({ nodeType }) => nodeType === "ImportDirective").map(({ absolutePath }) => absolutePath).sort(),
]));
const closure = new Set();
const pending = [...deploymentRoots];
while (pending.length) {
  const file = pending.pop();
  if (closure.has(file)) continue;
  assert.ok(importGraph.has(file), "Unresolved production import: " + file);
  closure.add(file);
  pending.push(...importGraph.get(file));
}
const sources = [...closure].sort();
assert.deepEqual(sources.filter((file) => file.startsWith("src/")),
  Object.keys(standardInput.sources).filter((file) => file.startsWith("src/")).sort(),
  "The reviewed list differs from the first-party source closure");

// Give Slither the exact normalized source bytes it maps its results to. Staging
// also keeps repository triage files and local Slither configuration out of this run.
mkdirSync(output);
const stage = join(output, "analysis-inputs");
for (const file of sources) {
  const path = join(stage, file);
  assert.ok(path.startsWith(stage + sep), "Unexpected source path");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, standardInput.sources[file].content, { flag: "wx" });
}
const compilerName = process.platform === "win32" ? "solc.exe" : "solc";
const localCompiler = join(output, compilerName);
// Solc-json asks for the configured binary's version and invokes "solc" on PATH.
copyFileSync(compiler, localCompiler);
assert.equal(sha256(readFileSync(localCompiler)), review.executableSha256);
const inputPath = join(output, "slither-input.json");
const reportPath = join(output, "slither-results.json");
writeFileSync(inputPath, JSON.stringify({ ...standardInput,
  sources: Object.fromEntries(sources.map((file) => [file, standardInput.sources[file]])),
  settings: { ...standardInput.settings, outputSelection: {
    "*": { "": ["ast"], "*": ["abi", "devdoc", "userdoc", "evm.bytecode", "evm.deployedBytecode"] },
  } },
}));
const run = spawnSync(values.python, [...slitherArgs, inputPath, "--compile-force-framework", "solc-json",
  "--solc", localCompiler, "--solc-working-dir", stage, "--show-ignored-findings", "--fail-high", "--json", reportPath],
{ cwd: stage, env: { ...process.env, PATH: output + delimiter + process.env.PATH },
  encoding: "utf8", timeout: 240_000, maxBuffer: 32 * 1024 * 1024 });
if (run.error) throw run.error;
writeFileSync(join(output, "slither.log"), run.stdout + run.stderr);
const report = JSON.parse(readFileSync(reportPath, "utf8"));
assert.equal(report.success, true, report.error ?? "Slither analysis failed");
const analysis = /analyzed \((\d+) contracts with (\d+) detectors\), (\d+) result/.exec(run.stderr);
assert.ok(analysis, "Slither did not report analysis counts");
const [, analyzedContracts, detectorCount, reportedFindings] = analysis.map(Number);
assert.equal(detectorCount, 101, "Expected the full built-in detector set");
const findings = report.results.detectors;
assert.equal(findings.length, reportedFindings);
const count = { firstParty: {}, dependencyOnly: {}, other: {} };
const highByDetector = { firstParty: {}, dependencyOnly: {}, other: {} };
for (const finding of findings) {
  const files = finding.elements.map(({ source_mapping }) => source_mapping.filename_short.replaceAll("\\", "/"));
  const scope = files.some((file) => file.startsWith("src/")) ? "firstParty"
    : files.length && files.every((file) => file.startsWith("lib/")) ? "dependencyOnly" : "other";
  const group = count[scope];
  group[finding.impact] = (group[finding.impact] ?? 0) + 1;
  if (finding.impact === "High") {
    const byDetector = highByDetector[scope];
    byDetector[finding.check] = (byDetector[finding.check] ?? 0) + 1;
  }
}
const highCount = Object.values(count).reduce((total, group) => total + (group.High ?? 0), 0);
assert.notEqual(run.status, null, "Slither terminated without an exit code");
const exitCode = run.status === -1 || run.status === 0xffffffff ? 255 : run.status;
assert.equal(exitCode, highCount ? 255 : 0, "Unexpected Slither gate exit code");
const parserDiagnostics = run.stderr.match(/^.*(?:ContractSolcParsing|FunctionSolc|SolcParsing|SSA_Conversion|ERROR:).*$/gm) ?? [];
const externalRuntime = network.contracts;
const manifest = {
  reviewCompilerInputSha256: inputHash,
  slitherCompilerInputSha256: sha256(readFileSync(inputPath)),
  executableSha256: review.executableSha256,
  forkEvidenceSha256: sha256(forkBytes),
  chainId: 4663,
  backingWei: backing.toString(),
  roots: deploymentRoots,
  sourceGraph: Object.fromEntries(sources.map((file) => [file, {
    sha256: sha256(standardInput.sources[file].content), imports: importGraph.get(file),
  }])),
  externalRuntime: {
    blockNumber: network.blockNumber,
    blockHash: network.blockHash,
    directSettlement: {
      poolManager: externalRuntime.poolManager, positionManager: externalRuntime.positionManager, permit2: externalRuntime.permit2,
    },
    indirectSettlement: "PositionManager also invokes the pinned PoolManager and Permit2 during mint and collection.",
    externalTradingAndEvidence: {
      universalRouter: externalRuntime.universalRouter, quoter: externalRuntime.quoter, stateView: externalRuntime.stateView,
    },
    dynamicCalls: [
      "Caller and immutable fee-recipient callbacks execute arbitrary external code. Foundry and the fork exercise safe boundary behavior.",
      "Future migration templates require directory publication and exact code pins. This report covers the reviewed V2 and V3 implementations.",
    ],
    otherBoundaries: [
      "PoolManager state reads, including fee-growth observations, target the same pinned runtime as settlement.",
      "The lifecycle does not call the PositionManager NFT descriptor or use a wrapped-native token.",
    ],
    evidence: "Runtime identities are from the loopback fork artifact. Slither analyzes the compiler source closure, not those already-deployed external bytecodes.",
  },
  analysis: { slither, cryticCompile, detectorCount, analyzedContracts, findings: reportedFindings, highCount,
    count, highByDetector, parserDiagnostics, rawExitCode: run.status, exitCode },
};
writeFileSync(join(output, "scope-report.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest.analysis, null, 2));
process.exitCode = exitCode;
