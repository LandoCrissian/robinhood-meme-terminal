import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {executePinnedSolc, verifiedSolcExecution} from "./pinned-solc.mjs";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const root = join(repo, "packages/contracts");
const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { encodeDeployData, zeroAddress, zeroHash } = require("viem");
const read = (file) => readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hexBytes = (hex) => Buffer.from(hex.slice(2), "hex");

export const profile = "rmt-curve-fixed-supply-security-v2";
export const supply = 1_000_000_000n * 10n ** 18n;
export const backing = 2n * 10n ** 18n;
export const creationFee = 400_000_000_000_000n;
export const termEvidence = Object.freeze({
  fixedSupplyWei: supply.toString(), decimals: 18,
  curveInventoryWei: (supply * 3n / 5n).toString(), initialLiquidityInventoryWei: (supply * 2n / 5n).toString(),
  creationFeeWei: creationFee.toString(), graduationBackingWei: backing.toString(),
  tradingFeeBps: 100, projectBps: 9000, operationsBps: 500, reserveBps: 500,
});
const firstProject = JSON.parse(read(new URL("../../../docs/evidence/fixed-supply-security/first-project.json", import.meta.url)));
assert.equal(firstProject.profile, profile);
assert.equal(firstProject.status, "BLOCKED_NO_BROADCAST");
assert.equal(firstProject.broadcastAuthorized, false);
assert.ok(Object.values(firstProject.production).every((value) => value === null));
assert.equal(firstProject.fixtureOnly.name, "RMT");
assert.equal(firstProject.fixtureOnly.symbol, "RMT");
assert.equal(new URL(firstProject.fixtureOnly.projectURI).hostname, "example.test");
export const rmtFixture = Object.freeze(firstProject.fixtureOnly);

const historical = JSON.parse(read(new URL("../../../docs/evidence/rmt-task043/4663-rotation-profile.json", import.meta.url)));
const pins = Object.fromEntries(historical.sourceSha256.filter(([name]) => name.startsWith("lib/")));

export function buildFixedSupplyInput({ solc, solcEmulator, lib = join(root, "lib"), chainId }) {
  assert.ok(chainId === 31337 || chainId === 4663, "Only explicit local and 4663 review profiles are defined");
  const execution = verifiedSolcExecution({solc, solcEmulator});
  const platform = execution.executablePlatform;
  const executableSha256 = execution.executableSha256;
  const files = readdirSync(join(root, "src"), { recursive: true })
    .filter((name) => name.endsWith(".sol") && !/^RMTLaunchProjectRegistryV[12]\.sol$/.test(name)).map((name) => "src/" + name.replaceAll("\\", "/")).sort();
  const sources = Object.fromEntries(files.map((file) => [file, { content: read(join(root, file)) }]));
  const originalSourceSha256 = files.map((file) => [file, sha256(sources[file].content)]);
  for (const [file, digest] of Object.entries(pins).sort()) {
    const content = read(join(lib, file.slice(4)));
    assert.equal(sha256(content), digest, "Dependency source mismatch " + file);
    sources[file] = { content };
  }
  const transformations = [];
  function replace(file, from, to, expectedOccurrences) {
    const { content } = sources[file];
    assert.equal(content.split(from).length - 1, expectedOccurrences, "Unexpected source literal in " + file);
    sources[file].content = content.replaceAll(from, to);
    transformations.push({ file, from, to, occurrences: expectedOccurrences });
  }
  if (chainId === 4663) {
    replace("src/RMTLaunchCurveFactoryV2.sol", "block.chainid != 31_337", "block.chainid != 4_663", 2);
    replace("src/RMTV4CurveGraduationV1.sol", "CHAIN_ID = 31_337", "CHAIN_ID = 4_663", 1);
  }
  const math = "src/RMTLaunchCurveMathV1.sol";
  replace(math, "2ether-virtual-eth;60%-sold;1ether-backing", "4ether-virtual-eth;60%-sold;2ether-backing", 1);
  replace(math, "VIRTUAL_ETH = 2 ether", "VIRTUAL_ETH = 4 ether", 1);
  replace(math, "GRADUATION_BACKING = 1 ether", "GRADUATION_BACKING = 2 ether", 1);
  const manifest = {
    profile, chainId, status: "BLOCKED_NO_BROADCAST", broadcastAuthorized: false, terms: termEvidence,
    compilerVersion: historical.compilerVersion, executablePlatform: platform, executableSha256,
    ...(execution.emulation ? {compilerExecution: execution.emulation} : {}),
    originalSourceSha256, transformations,
    sourceSha256: Object.entries(sources).map(([file, { content }]) => [file, sha256(content)]),
    compilerSettings: historical.compilerSettings,
    externalRuntimePins: chainId === 4663 ? historical.externalRuntimePins : undefined,
  };
  const outputSelection = Object.fromEntries(files.map((file) => [file, { "*": [
    "abi", "evm.bytecode.object", "evm.deployedBytecode",
  ] }]));
  const input = JSON.stringify({ language: "Solidity", sources, settings: {
    ...manifest.compilerSettings, outputSelection,
  } });
  return { input, manifest: { ...manifest, inputSha256: sha256(input) } };
}

export function compileFixedSupplyProfile(options) {
  const { input, manifest } = buildFixedSupplyInput(options);
  // The release input is fixed. Bundle verification requests AST output in
  // addition to the canonical bytecode output without changing codegen settings.
  let compilerInput = input;
  if (options.includeImmutableNames) {
    const extended = JSON.parse(input);
    extended.settings.outputSelection["*"] = { "": ["ast"] };
    compilerInput = JSON.stringify(extended);
  }
  const compiled = JSON.parse(executePinnedSolc({...options, cwd: root}, compilerInput));
  const errors = (compiled.errors ?? []).filter(({ severity }) => severity === "error");
  assert.equal(errors.length, 0, errors.map(({ formattedMessage }) => formattedMessage).join("\n"));
  const artifacts = {};
  const templates = {};
  for (const [file, contracts] of Object.entries(compiled.contracts)) {
    for (const [name, { abi, evm }] of Object.entries(contracts)) {
      if (!evm.bytecode.object) continue; // Interfaces have an ABI but no runtime.
      const bytecode = "0x" + evm.bytecode.object;
      const runtime = "0x" + evm.deployedBytecode.object;
      assert.match(bytecode, /^0x(?:[a-f0-9]{2})+$/, "Unlinked creation code for " + name);
      assert.match(runtime, /^0x(?:[a-f0-9]{2})+$/, "Unlinked runtime for " + name);
      const immutableOffsets = evm.deployedBytecode.immutableReferences ?? {};
      const immutableReferences = Object.values(immutableOffsets).flat();
      const runtimeBytes = hexBytes(runtime).length;
      const creationBytes = hexBytes(bytecode).length;
      assert.ok(runtimeBytes <= 24_576, "EIP-170 runtime too large: " + name);
      assert.ok(creationBytes <= 49_152, "EIP-3860 initcode too large: " + name);
      artifacts[name] = { abi, bytecode, runtime, immutableReferences, immutableOffsets };
      templates[name] = { file, creationBytes, runtimeBytes,
        creationSha256: sha256(hexBytes(bytecode)), runtimeSha256: sha256(hexBytes(runtime)) };
    }
  }
  const factory = artifacts.RMTLaunchCurveFactoryV2;
  const token = artifacts.RMTLaunchCurveTokenV2;
  assert.deepEqual(factory.abi.filter((entry) => entry.type === "function" && entry.name === "create")
    .map(({ inputs }) => inputs.map(({ type }) => type)), [["string", "string", "string", "address", "uint16", "bytes32", "uint256"]]);
  assert.deepEqual(token.abi.find(({ type }) => type === "constructor").inputs.map(({ type }) => type), ["string", "string"]);
  assert.deepEqual(token.abi.filter(({ type, stateMutability }) =>
    type === "function" && stateMutability === "nonpayable").map(({ name }) => name).sort(), ["approve", "transfer", "transferFrom"]);
  const deploy = artifacts.RMTLaunchCurveDeploymentV2;
  const initcode = encodeDeployData({ abi: deploy.abi, bytecode: deploy.bytecode, args: [{
    poolManager: zeroAddress, positionManager: zeroAddress, permit2: zeroAddress,
    poolManagerHash: zeroHash, positionManagerHash: zeroHash, permit2Hash: zeroHash,
  }, zeroHash, zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroHash, creationFee] });
  const bootstrapInitcodeBytes = hexBytes(initcode).length;
  assert.ok(bootstrapInitcodeBytes <= 49_152, "Encoded bootstrap exceeds EIP-3860");
  const immutableNames = new Map();
  if (options.includeImmutableNames) {
    for (const { ast } of Object.values(compiled.sources)) {
      for (const definition of ast.nodes.filter(({ nodeType }) => nodeType === "ContractDefinition")) {
        for (const field of definition.nodes.filter(({ mutability }) => mutability === "immutable")) {
          immutableNames.set(String(field.id), field.name);
        }
      }
    }
  }
  return { artifacts, immutableNames, auxiliaryCompilerInputSha256: options.includeImmutableNames ? sha256(compilerInput) : undefined,
    manifest: { ...manifest, templates, size: {
    bootstrapInitcodeBytes, bootstrapInitcodeHeadroom: 49_152 - bootstrapInitcodeBytes,
    factoryRuntimeBytes: templates.RMTLaunchCurveFactoryV2.runtimeBytes,
  } } };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: {
    solc: { type: "string" }, lib: { type: "string" }, chain: { type: "string" },
    "standard-json": { type: "string" }, verify: { type: "string" },
  } });
  assert.ok(values.solc && values.chain, "Supply --solc and --chain 31337 or 4663");
  const options = { solc: values.solc, lib: values.lib, chainId: Number(values.chain) };
  if (values["standard-json"]) {
    assert.equal(values.verify, undefined, "Manifest comparison requires compilation");
    writeFileSync(values["standard-json"], buildFixedSupplyInput(options).input, { flag: "wx" });
  } else {
    const { manifest } = compileFixedSupplyProfile(options);
    if (values.verify) {
      const portable = ({ executablePlatform, executableSha256, ...fields }) => fields;
      assert.deepEqual(portable(manifest), portable(JSON.parse(read(values.verify))));
    }
    console.log(JSON.stringify(manifest, null, 2));
  }
}
