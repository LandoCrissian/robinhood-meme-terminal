import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(scriptDir, "../../..");
const inputs = JSON.parse(readFileSync(join(scriptDir, "launch-4663-review-inputs.json"), "utf8"));
const compilerVersion = "0.8.26+commit.8a97fa7a";
const compilerSha256 = {
  "darwin-x64": "0ff016aef2396b12d1fc65429d8ea6cf53c2ee4b041bb8925644615ee1c30ab9",
  "linux-x64": "d5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef",
  "win32-x64": "537fd8d8d4a0433a971bf456fc06f7b021cdcee27b252f74da49e0d8559aeb67",
};

const changes = {
  "src/RMTV4LaunchDeploymentV2.sol": [
    "if (block.chainid != 31_337) revert WrongChain();",
    "if (block.chainid != 4_663) revert WrongChain();",
  ],
  "src/RMTV4LongevityLedger.sol": [
    "uint256 internal constant FEE_RELEASE_CHAIN_ID = 31_337;",
    "uint256 internal constant FEE_RELEASE_CHAIN_ID = 4_663;",
  ],
};

const contracts = {
  RMTV4LaunchDeploymentV2: "RMTV4LaunchDeploymentV2",
  RMTV4LaunchFactoryV2: "RMTV4LaunchFactoryV2",
  RMTV4InitializationGuard: "RMTV4InitializationGuard",
  RMTV4LaunchFactoryV1: "RMTV4LaunchFactoryV1",
  RMTV4LaunchTokenV1: "RMTV4LaunchFactoryV1",
};

const artifactOutputs = ["abi", "evm.bytecode", "evm.deployedBytecode"];
const outputSelection = {};
for (const [name, file] of Object.entries(contracts)) {
  const source = "src/" + file + ".sol";
  outputSelection[source] ??= {};
  outputSelection[source][name] = artifactOutputs;
}

const settings = {
  evmVersion: "cancun",
  viaIR: true,
  optimizer: { enabled: true, runs: 200 },
  metadata: { bytecodeHash: "ipfs", appendCBOR: true, useLiteralContent: false },
  remappings: [
    "@openzeppelin/=lib/v4-core/lib/openzeppelin-contracts/",
    "@uniswap/v4-core/=lib/v4-core/",
    "@uniswap/v4-periphery/=lib/v4-periphery/",
  ],
  outputSelection,
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });

function verifyFrozenSource() {
  try {
    git("diff", "--quiet", "--no-ext-diff", inputs.frozenSource, "--",
      "*.sol", "packages/contracts/foundry.toml", "packages/contracts/remappings.txt");
  } catch (error) {
    if (error.status === 1) {
      throw new Error("Tracked Solidity or compiler settings differ from the frozen source.");
    }
    throw error;
  }
}

function readSources(lib) {
  const sources = {};
  for (const file of inputs.localSources) {
    sources[file] = { content: git("show", inputs.frozenSource + ":packages/contracts/" + file) };
  }
  for (const [file, expected] of Object.entries(inputs.dependencySourceSha256)) {
    const content = readFileSync(join(lib, file.slice("lib/".length)), "utf8").replace(/\r\n/g, "\n");
    if (sha256(content) !== expected) throw new Error("Pinned dependency content mismatch: " + file);
    sources[file] = { content };
  }
  return sources;
}

function targetSources(baseline) {
  const result = { ...baseline };
  for (const [file, [before, after]] of Object.entries(changes)) {
    const { content } = baseline[file];
    if (content.split(before).length !== 2) {
      throw new Error("Expected exactly one frozen chain gate in " + file);
    }
    result[file] = { content: content.replace(before, after) };
  }
  return result;
}

function describeBytecode(bytecode) {
  const { object, linkReferences } = bytecode;
  if (!/^(?:[a-f0-9]{2})+$/.test(object) || Object.keys(linkReferences).length > 0) {
    throw new Error("Expected nonempty, fully linked Solidity bytecode.");
  }
  const bytes = Buffer.from(object, "hex");
  const cborLength = bytes.readUInt16BE(bytes.length - 2);
  const codeLength = bytes.length - cborLength - 2;
  if (codeLength <= 0 || (bytes[codeLength] & 0xe0) !== 0xa0) {
    throw new Error("Expected the pinned Solidity compiler's CBOR metadata suffix.");
  }
  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    withoutTopLevelMetadataSha256: sha256(bytes.subarray(0, codeLength)),
  };
}

function compile(solc, sources, includeTemplates = false) {
  const input = JSON.stringify({ language: "Solidity", settings, sources });
  const output = JSON.parse(execFileSync(solc, ["--standard-json", "--no-import-callback"], {
    cwd: scriptDir,
    encoding: "utf8",
    env: process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
    input,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180_000,
  }));
  const errors = (output.errors ?? []).filter(({ severity }) => severity === "error");
  if (errors.length) {
    throw new Error(errors.map(({ formattedMessage }) => formattedMessage).join("\n"));
  }
  const artifacts = {};
  const templates = {};
  for (const [name, file] of Object.entries(contracts)) {
    const artifact = output.contracts["src/" + file + ".sol"][name];
    artifacts[name] = {
      abiSha256: sha256(JSON.stringify(artifact.abi)),
      creation: describeBytecode(artifact.evm.bytecode),
      runtimeTemplate: {
        ...describeBytecode(artifact.evm.deployedBytecode),
        immutableReferences: artifact.evm.deployedBytecode.immutableReferences ?? {},
      },
    };
    if (includeTemplates) {
      templates[name] = {
        abi: artifact.abi,
        creationBytecode: "0x" + artifact.evm.bytecode.object,
        runtimeTemplate: "0x" + artifact.evm.deployedBytecode.object,
        immutableReferences: artifacts[name].runtimeTemplate.immutableReferences,
      };
    }
  }
  return { summary: { inputSha256: sha256(input), artifacts }, templates };
}

function checkComparison(baseline, target) {
  for (const [name, before] of Object.entries(baseline.artifacts)) {
    const after = target.artifacts[name];
    if (before.abiSha256 !== after.abiSha256) throw new Error("ABI changed: " + name);
    const creationChanged = before.creation.sha256 !== after.creation.sha256;
    const runtimeChanged = before.runtimeTemplate.withoutTopLevelMetadataSha256
      !== after.runtimeTemplate.withoutTopLevelMetadataSha256;
    const usesChainGate = name === "RMTV4LaunchDeploymentV2" || name === "RMTV4LaunchFactoryV2";
    if (creationChanged !== usesChainGate || runtimeChanged !== (name === "RMTV4LaunchFactoryV2")) {
      throw new Error("Unexpected chain-specific bytecode comparison: " + name);
    }
    if (!usesChainGate && before.runtimeTemplate.sha256 !== after.runtimeTemplate.sha256) {
      throw new Error("Unchanged contract's runtime template changed: " + name);
    }
    if (after.runtimeTemplate.bytes > 24_576) throw new Error("EIP-170 size exceeded: " + name);
    // The top-level deployer's seven fixed-width constructor arguments append 224 bytes.
    if (name === "RMTV4LaunchDeploymentV2" && after.creation.bytes + 224 > 49_152) {
      throw new Error("EIP-3860 initcode size exceeded for the V2 deployer.");
    }
  }
}

export function buildLaunch4663Review({ solc: compiler, lib: dependencyDirectory }, includeTemplates = false) {
  verifyFrozenSource();
  const solc = resolve(compiler);
  const compilerTarget = process.platform + "-" + process.arch;
  const executableSha256 = sha256(readFileSync(solc));
  if (compilerSha256[compilerTarget] !== executableSha256) {
    throw new Error("Expected an official native solc " + compilerVersion + " binary for " + compilerTarget);
  }
  const lib = dependencyDirectory ? resolve(dependencyDirectory) : resolve(scriptDir, "../lib");
  const local = readSources(lib);
  const target = targetSources(local);
  const { summary: baseline } = compile(solc, local);
  const { summary: review, templates } = compile(solc, target, includeTemplates);
  checkComparison(baseline, review);
  const manifest = {
    schema: 1,
    purpose: "offline-independent-review",
    frozenSource: inputs.frozenSource,
    artifactScope: {
      core: ["RMTV4LaunchDeploymentV2", "RMTV4LaunchFactoryV2", "RMTV4InitializationGuard", "RMTV4LaunchTokenV1"],
      comparisonOnly: ["RMTV4LaunchFactoryV1"],
    },
    compiler: {
      version: compilerVersion,
      executableSha256,
      executablePlatform: compilerTarget,
      settings,
    },
    dependencies: inputs.dependencies,
    baseline: { chainId: 31337, ...baseline },
    review: {
      chainId: 4663,
      ...review,
      sourceChanges: Object.entries(changes).map(([file, [before, after]]) => ({
        file,
        before,
        after,
        frozenSha256: sha256(local[file].content),
        reviewSha256: sha256(target[file].content),
      })),
    },
  };
  return { manifest, templates };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({
      options: { solc: { type: "string" }, lib: { type: "string" } },
    });
    if (!values.solc) {
      throw new Error("Usage: node packages/contracts/scripts/build-launch-4663-review.mjs --solc <native-solc-path> [--lib <pinned-lib-directory>]");
    }
    const { manifest } = buildLaunch4663Review(values);
    console.log(JSON.stringify(manifest, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
