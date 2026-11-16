import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const profile = "rmt-curve-v1-4663-governance-rotation-v2";
export const governance = {
  directory: {
    contract: "RMTLaunchCurveDirectoryV2",
    domain: { name: "RMT Launch Curve Directory", version: "2" },
    action: "Action(uint8 kind,uint64 nonce,uint32 version,address factory,bytes32 runtimeHash,uint64 signerSetEpoch,uint48 deadline)",
    rotation: "SignerRotation(address departingSigner,address incomingSigner,uint64 signerSetEpoch,uint64 nonce,uint48 deadline)",
    acceptance: "RotationAcceptance(bytes32 rotationDigest)",
    cancellation: "RotationCancellation(bytes32 rotationDigest,uint64 signerSetEpoch,uint64 nonce,uint48 deadline)",
  },
  registry: {
    contract: "RMTLaunchProjectRegistryV2",
    domain: { name: "RMT Launch Project Registry", version: "3" },
    migration: "CurveAssetMigration(address token,address sourceCurve,uint64 nonce,uint32 fromVersion,address nextCurve,bytes32 runtimeHash,uint64 signerSetEpoch,uint48 deadline)",
  },
  initialSignerSetEpoch: 1,
  distinctSigners: 3,
  quorum: 2,
  noticeSeconds: 172800,
  maximumExecutionWindowSeconds: 604800,
};

const read = (path) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hexBytes = (hex) => Buffer.from(hex.slice(2), "hex");
const baseline = JSON.parse(read(new URL("../rmt-task042/4663-treasury-review-manifest.json", import.meta.url)));
const historicalText = read(new URL("../rmt-task039/historical-4663-fork-2eth.json", import.meta.url));
assert.equal(sha256(historicalText), baseline.replayInputsSha256Lf["historical-4663-fork-2eth.json"]);
const { manifest: historical } = JSON.parse(historicalText);
const harness = "packages/contracts/scripts/validate-curve-graduation-4663.mjs";
const sourceRoot = "packages/contracts/src";
const replacements = [
  ["RMTLaunchCurveDirectoryV1", governance.directory],
  ["RMTLaunchProjectRegistryV1", governance.registry],
];

export function webTools(checkout) {
  const priorWorkspace = resolve(checkout, "apps/web/package.json");
  const workspace = existsSync(priorWorkspace) ? priorWorkspace : resolve(checkout, "apps/launch-website/package.json");
  return createRequire(workspace)("viem");
}

export function verifyRotationManifest(manifest) {
  const expected = JSON.parse(read(new URL("./4663-rotation-profile.json", import.meta.url)));
  const portable = ({ executablePlatform, executableSha256, ...fields }) => fields;
  assert.deepEqual(portable(manifest), portable(expected), "Governance-rotation profile differs from the pinned manifest");
}

export async function buildRotationProfileInput({ checkout, solc, lib }) {
  assert.ok(checkout && solc, "Supply the pristine #594 checkout and pinned native Solc");
  const cwd = resolve(checkout);
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  assert.equal(git("rev-parse", "HEAD"), baseline.source.harnessCommit, "Requires exact #594 checkout");
  assert.equal(git("rev-parse", "HEAD:" + sourceRoot), baseline.source.solidityTree);
  assert.equal(git("rev-parse", "HEAD:" + harness), baseline.source.harnessBlob);
  assert.equal(git("status", "--porcelain", "--", sourceRoot, "packages/contracts/scripts"), "", "Local baseline build input changes");
  const { buildCurveReviewCompilerInput } = await import(pathToFileURL(resolve(cwd, harness)));
  const frozen = buildCurveReviewCompilerInput({ solc, lib }, baseline.chainId, BigInt(baseline.provisionalTerms.graduationBackingWei));
  assert.equal(sha256(frozen.input), baseline.compiler.inputSha256, "Historical compiler input mismatch");
  assert.deepEqual(frozen.sourceChanges, baseline.compiler.exactInputTransformation);
  assert.deepEqual(frozen.sourceSha256, Object.fromEntries(historical.sourceSha256));

  const standard = JSON.parse(frozen.input);
  const replacementSources = [];
  for (const [oldName, authority] of replacements) {
    const { contract: newName, domain, ...schemas } = authority;
    const oldFile = "src/" + oldName + ".sol";
    const newFile = "src/" + newName + ".sol";
    const repoFile = "packages/contracts/" + newFile;
    const content = read(new URL("../../../" + repoFile, import.meta.url));
    assert.ok(content.includes('EIP712("' + domain.name + '", "' + domain.version + '")'), "EIP-712 domain drift: " + newName);
    for (const schema of Object.values(schemas)) {
      assert.ok(content.includes('"' + schema + '"'), "EIP-712 message drift: " + newName);
    }
    // The frozen factory and V3 import a type from DirectoryV1. Keep the exact
    // dependency source so the factory and bootstrap metadata also stay fixed.
    const retainedAsDependency = oldName === "RMTLaunchCurveDirectoryV1";
    if (!retainedAsDependency) delete standard.sources[oldFile];
    delete standard.settings.outputSelection[oldFile];
    standard.sources[newFile] = { content };
    standard.settings.outputSelection[newFile] = { [newName]: ["abi", "evm.bytecode.object", "evm.deployedBytecode"] };
    replacementSources.push({ excludedDeploymentArtifact: oldName, retainedAsDependency, replacement: newFile,
      sha256: sha256(content) });
  }
  // AST IDs are required to independently materialize immutable runtime slots.
  standard.settings.outputSelection["*"] = { "": ["ast"] };
  const input = JSON.stringify(standard);
  return {
    input,
    manifest: {
      profile,
      chainId: baseline.chainId,
      status: "BLOCKED_NO_BROADCAST",
      broadcastAuthorized: false,
      compilerVersion: baseline.compiler.version,
      executablePlatform: process.platform + "-" + process.arch,
      executableSha256: frozen.executableSha256,
      inputSha256: sha256(input),
      historicalInputSha256: baseline.compiler.inputSha256,
      historicalSource: baseline.source,
      sourceChanges: frozen.sourceChanges,
      replacementSources,
      sourceSha256: Object.entries(standard.sources).map(([path, { content }]) => [path, sha256(content)]),
      compilerSettings: {
        evmVersion: standard.settings.evmVersion,
        viaIR: standard.settings.viaIR,
        optimizer: standard.settings.optimizer,
        metadata: standard.settings.metadata,
        remappings: standard.settings.remappings,
      },
      governance,
      limits: baseline.limits,
      externalRuntimePins: baseline.externalRuntimePins,
      provisionalTerms: baseline.provisionalTerms,
    },
  };
}

export async function compileRotationProfile(options) {
  const { input, manifest } = await buildRotationProfileInput(options);
  const output = JSON.parse(execFileSync(resolve(options.solc), ["--standard-json", "--no-import-callback"], {
    cwd: resolve(options.checkout, "packages/contracts"), input, encoding: "utf8",
    maxBuffer: 48 * 1024 * 1024, timeout: 180_000, windowsHide: true,
    env: process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
  }));
  const errors = (output.errors ?? []).filter(({ severity }) => severity === "error");
  assert.equal(errors.length, 0, errors.map(({ formattedMessage }) => formattedMessage).join("\n"));
  const immutableNames = new Map();
  for (const { ast } of Object.values(output.sources)) {
    for (const contract of ast.nodes.filter((node) => node.nodeType === "ContractDefinition")) {
      for (const node of contract.nodes.filter((entry) => entry.mutability === "immutable")) {
        immutableNames.set(node.id, node.name);
      }
    }
  }

  const expected = Object.keys(historical.templates).map((name) =>
    replacements.find(([prior]) => prior === name)?.[1].contract ?? name);
  const results = Object.assign({}, ...Object.values(output.contracts));
  assert.deepEqual(Object.keys(results).sort(), expected.sort(), "Unexpected profile compilation output");
  const artifacts = {};
  const templates = {};
  for (const [name, { abi, evm }] of Object.entries(results)) {
    const bytecode = "0x" + evm.bytecode.object;
    const runtime = "0x" + evm.deployedBytecode.object;
    assert.ok(/^0x(?:[a-f0-9]{2})+$/.test(bytecode) && /^0x(?:[a-f0-9]{2})+$/.test(runtime), "Unlinked bytecode: " + name);
    const immutableOffsets = evm.deployedBytecode.immutableReferences ?? {};
    const immutableReferences = Object.values(immutableOffsets).flat();
    const runtimeBytes = hexBytes(runtime).length;
    const creationBytes = hexBytes(bytecode).length;
    assert.ok(runtimeBytes <= manifest.limits.runtimeBytes, "EIP-170 runtime too large: " + name);
    assert.ok(creationBytes <= manifest.limits.initcodeBytes, "EIP-3860 unencoded initcode too large: " + name);
    artifacts[name] = { abi, bytecode, runtime, immutableReferences, immutableOffsets };
    templates[name] = { creationBytes, runtimeBytes, creationSha256: sha256(hexBytes(bytecode)), runtimeSha256: sha256(hexBytes(runtime)) };
    if (historical.templates[name]) {
      assert.deepEqual(templates[name], historical.templates[name], "Frozen economic/deployment template changed: " + name);
    }
  }

  const { encodeDeployData, zeroAddress, zeroHash } = webTools(options.checkout);
  const bootstrap = artifacts.RMTLaunchCurveDeploymentV1;
  const bootstrapInitcode = encodeDeployData({ abi: bootstrap.abi, bytecode: bootstrap.bytecode, args: [{
    poolManager: zeroAddress, positionManager: zeroAddress, permit2: zeroAddress,
    poolManagerHash: zeroHash, positionManagerHash: zeroHash, permit2Hash: zeroHash,
  }, zeroHash, zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroHash, BigInt(manifest.provisionalTerms.creationFeeWei)] });
  const initcodeBytes = hexBytes(bootstrapInitcode).length;
  assert.ok(initcodeBytes <= manifest.limits.initcodeBytes, "Encoded bootstrap exceeds EIP-3860");
  const size = {
    bootstrapConstructorBytes: initcodeBytes - templates.RMTLaunchCurveDeploymentV1.creationBytes,
    bootstrapInitcodeBytes: initcodeBytes,
    bootstrapInitcodeHeadroom: manifest.limits.initcodeBytes - initcodeBytes,
    factoryRuntimeBytes: templates.RMTLaunchCurveFactoryV1.runtimeBytes,
    factoryRuntimeHeadroom: manifest.limits.runtimeBytes - templates.RMTLaunchCurveFactoryV1.runtimeBytes,
  };
  return { artifacts, immutableNames, manifest: { ...manifest, templates, size } };
}

async function main() {
  const { values } = parseArgs({ options: {
    checkout: { type: "string" }, solc: { type: "string" }, lib: { type: "string" },
    "standard-json": { type: "string" }, "verify-manifest": { type: "boolean" },
  } });
  if (values["standard-json"]) {
    assert.ok(!values["verify-manifest"], "Manifest verification requires compiled bytecode");
    const { input } = await buildRotationProfileInput(values);
    writeFileSync(values["standard-json"], input, { flag: "wx" });
  } else {
    const { manifest } = await compileRotationProfile(values);
    if (values["verify-manifest"]) verifyRotationManifest(manifest);
    console.log(JSON.stringify(manifest, null, 2));
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
