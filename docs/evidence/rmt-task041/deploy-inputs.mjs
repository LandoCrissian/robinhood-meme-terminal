import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fromHex = (hex) => Buffer.from(hex.slice(2), "hex");
const reviewFile = read("../rmt-task042/4663-treasury-review-manifest.json");
const review = JSON.parse(reviewFile);
const anchor = read("../rmt-task042/fork/4663-lifecycle.json");
const historyFile = read("../rmt-task039/historical-4663-fork-2eth.json");
const matrixFile = read("4663-treasury-matrix.json");
const matrixHash = "7f06cb4051f1c2d2b2eab2c65e22c270aef55562555568c5ebe17706986e8b2a";
assert.equal(review.status, "BLOCKED_NO_BROADCAST");
assert.equal(review.broadcastAuthorized, false);
assert.equal(sha256(anchor), review.freshFork.receiptEvidenceSha256Lf);
assert.equal(sha256(historyFile), review.replayInputsSha256Lf["historical-4663-fork-2eth.json"]);
assert.equal(sha256(matrixFile), matrixHash);
const fresh = JSON.parse(anchor);
const historical = JSON.parse(historyFile);
const matrix = JSON.parse(matrixFile);
assert.equal(matrix.profile, review.profile);
assert.equal(matrix.compiler.inputSha256, review.compiler.inputSha256);
assert.equal(matrix.report.network.blockHash, review.freshFork.blockHash);
assert.equal(matrix.report.execution.chainId, review.chainId);
assert.equal(matrix.report.archiveBoundary.blockedWriteProbe, "HTTP 403");
const template = JSON.parse(read("deploy-inputs.json"));
const { approved, ...draftTerms } = review.provisionalTerms;
assert.equal(approved, false);

const solidityPath = "packages/contracts/src";
const harness = "packages/contracts/scripts/validate-curve-graduation-4663.mjs";
const fixtureSigners = [
  "0xDFfA2677FB1f2A566a2F3d9B3606925ba6cF2f40",
  "0xAb2948F95BB7e52D1712F7dE1443baCE57cFB825",
  "0x14672fd74C1013b5f1A9e662dC5864eBb9b9264d",
];
const freshDeployment = fresh.deployment;
const fixture = freshDeployment.deployment;
const reviewedConstructors = matrix.constructors;
assert.equal(reviewedConstructors.directory.address.toLowerCase(), freshDeployment.directory.toLowerCase());
assert.equal(reviewedConstructors.registry.address.toLowerCase(), freshDeployment.projectRegistry.toLowerCase());
assert.equal(reviewedConstructors.bootstrap.gasUsed, String(fixture.gasUsed));
const reviewedAddresses = Object.values(review.externalRuntimePins).map(({ address }) => address);
const knownFixtureAddresses = [
  ...fixtureSigners,
  ...[freshDeployment, historical.deployment].flatMap((deployed) => [
    deployed.deployment.operator, deployed.deployment.operatingRecipient, deployed.deployment.futureReserveRecipient,
    deployed.directory, deployed.projectRegistry, deployed.factory, deployed.guard, deployed.graduationEngine,
    deployed.deployment.address, deployed.deployment.successorDeployer, deployed.v3Template.deployer,
  ]),
];
const blockedAddresses = new Set([...reviewedAddresses, ...knownFixtureAddresses].map((address) => address.toLowerCase()));

export function addressTools(checkout) {
  const priorWorkspace = resolve(checkout, "apps/web/package.json");
  const workspace = existsSync(priorWorkspace) ? priorWorkspace : resolve(checkout, "apps/launch-website/package.json");
  return createRequire(workspace)("viem");
}

function exactKeys(value, expected, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), label);
  assert.deepEqual(Object.keys(value).sort(), Object.keys(expected).sort(), label);
}

export function validateInputs(input, getAddress) {
  exactKeys(input, template, "Unknown or missing input fields");
  exactKeys(input.economics, draftTerms, "Unknown or missing economic fields");
  assert.equal(input.profile, review.profile, "Compiler profile mismatch");
  assert.equal(input.chainId, 4663, "Chain mismatch");
  assert.equal(input.broadcastAuthorized, false, "Unsigned package only");
  assert.ok(Array.isArray(input.governanceSigners) && input.governanceSigners.length === 3, "Three signer slots required");

  const missing = [];
  function assigned(label, value, validate) {
    if (value === null) missing.push(label);
    else validate(value);
  }
  function address(label, value) {
    assigned(label, value, (candidate) => {
      assert.ok(/^0x[0-9a-fA-F]{40}$/.test(candidate) && typeof candidate === "string"
        && getAddress?.(candidate) === candidate, label + " must be a checksummed address");
      assert.ok(BigInt(candidate) > 0xffffn && !blockedAddresses.has(candidate.toLowerCase()),
        label + " is a known fixture, reserved or dependency address");
    });
  }
  address("operatingTreasury", input.operatingTreasury);
  address("futureReserve", input.futureReserve);
  address("deployer", input.deployer);
  input.governanceSigners.forEach((signer, i) => address("governanceSigners[" + i + "]", signer));
  const signers = input.governanceSigners.filter((signer) => signer !== null);
  assert.equal(new Set(signers).size, signers.length, "Governance signers must be independent addresses");
  assert.ok(input.operatingTreasury === null || input.operatingTreasury !== input.futureReserve,
    "Operating treasury and future reserve must differ");

  assigned("confirmedDeployerNonce", input.confirmedDeployerNonce, (nonce) => {
    assert.ok(typeof nonce === "string" && /^(0|[1-9]\d{0,19})$/.test(nonce)
      && BigInt(nonce) <= (1n << 64n) - 10n, "Nonce must be canonical and leave nine consecutive slots");
  });
  assigned("governanceQuorum", input.governanceQuorum,
    (quorum) => assert.equal(quorum, review.signerPolicy.quorum, "Directory quorum is fixed at two"));
  const approval = input.ownerApprovalReference;
  assert.ok(approval === null || (typeof approval === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:/#-]{7,199}$/.test(approval)),
    "If supplied, use a public approval reference for the exact inputs");
  for (const [key, expected] of Object.entries(draftTerms)) {
    assigned("economics." + key, input.economics[key],
      (value) => assert.deepEqual(value, expected, "Different economics require a new reviewed compiler profile for " + key));
  }
  return missing;
}

function verifyCheckout(checkout) {
  const git = (...args) => execFileSync("git", args, { cwd: checkout, encoding: "utf8" }).trim();
  assert.equal(git("rev-parse", "HEAD"), review.source.harnessCommit, "Requires exact #594 checkout");
  assert.equal(git("rev-parse", "HEAD:" + solidityPath), review.source.solidityTree);
  assert.equal(git("rev-parse", review.source.solidityCommit + ":" + solidityPath), review.source.solidityTree);
  assert.equal(git("rev-parse", "HEAD:" + harness), review.source.harnessBlob);
  assert.equal(git("status", "--porcelain", "--", solidityPath, "packages/contracts/scripts"), "", "Local build input changes");
}

async function compilerProfile(checkout, compiler, viem) {
  const { buildCurveReviewCompilerInput } = await import(pathToFileURL(resolve(checkout, harness)));
  const build = buildCurveReviewCompilerInput({ solc: compiler }, review.chainId, BigInt(draftTerms.graduationBackingWei));
  assert.equal(sha256(build.input), review.compiler.inputSha256);
  assert.deepEqual(build.sourceChanges, review.compiler.exactInputTransformation);
  assert.deepEqual(build.sourceSha256, Object.fromEntries(historical.manifest.sourceSha256));

  // Ask additionally for the AST to resolve immutable IDs. Every bytecode template still has to match the exact profile.
  const input = JSON.parse(build.input);
  assert.equal(Object.keys(input.sources).length, review.compiler.sourceClosureFiles);
  input.settings.outputSelection["*"] = { "": ["ast"] };
  const output = JSON.parse(execFileSync(compiler, ["--standard-json", "--no-import-callback"], {
    cwd: resolve(checkout, "packages/contracts"), input: JSON.stringify(input), encoding: "utf8",
    maxBuffer: 48 * 1024 * 1024, timeout: 180_000, env: process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
  }));
  assert.deepEqual((output.errors ?? []).filter((error) => error.severity === "error"), []);
  const immutableNames = new Map();
  for (const { ast } of Object.values(output.sources)) {
    for (const contract of ast.nodes.filter((node) => node.nodeType === "ContractDefinition")) {
      for (const node of contract.nodes.filter((entry) => entry.mutability === "immutable")) {
        immutableNames.set(node.id, node.name);
      }
    }
  }
  const artifacts = Object.assign({}, ...Object.values(output.contracts));
  assert.deepEqual(Object.keys(artifacts).sort(), Object.keys(historical.manifest.templates).sort());
  for (const [name, { evm }] of Object.entries(artifacts)) {
    const creation = Buffer.from(evm.bytecode.object, "hex");
    const runtime = Buffer.from(evm.deployedBytecode.object, "hex");
    assert.deepEqual({ creationBytes: creation.length, runtimeBytes: runtime.length,
      creationSha256: sha256(creation), runtimeSha256: sha256(runtime) }, historical.manifest.templates[name], name);
    assert.ok(runtime.length <= review.limits.runtimeBytes, name + " runtime exceeds EIP-170");
  }

  function artifact(name, args, values) {
    const { abi, evm } = artifacts[name];
    const bytecode = "0x" + evm.bytecode.object;
    const initcodeHex = viem.encodeDeployData({ abi, bytecode, args });
    const constructorData = "0x" + initcodeHex.slice(bytecode.length);
    const initcode = fromHex(initcodeHex);
    const runtime = Buffer.from(evm.deployedBytecode.object, "hex");
    const references = evm.deployedBytecode.immutableReferences ?? {};
    for (const [id, offsets] of Object.entries(references)) {
      const identifier = immutableNames.get(Number(id));
      assert.ok(identifier && Object.hasOwn(values, identifier), name + " has an unresolved immutable " + identifier);
      const value = fromHex(viem.padHex(values[identifier], { size: 32 }));
      for (const { start, length } of offsets) {
        assert.ok(length === 32 && start + length <= runtime.length && runtime.subarray(start, start + length)
          .every((byte) => byte === 0), name + " has an invalid immutable slot");
        value.copy(runtime, start);
      }
    }
    const calldataGas = initcode.reduce((cost, byte) => cost + (byte === 0 ? 4 : 16), 0);
    const eip3860Gas = 2 * Math.ceil(initcode.length / 32);
    assert.ok(initcode.length <= review.limits.initcodeBytes, name + " exceeds EIP-3860 initcode size");
    return { initcodeHash: viem.keccak256(initcodeHex), initcodeSha256: sha256(initcode),
      runtimeHash: viem.keccak256("0x" + runtime.toString("hex")), constructorData,
      initcodeBytes: initcode.length, initcodeHeadroomBytes: review.limits.initcodeBytes - initcode.length,
      runtimeBytes: runtime.length, runtimeHeadroomBytes: review.limits.runtimeBytes - runtime.length,
      calldataGas, eip3860Gas, creationIntrinsicGas: 53_000 + calldataGas + eip3860Gas };
  }

  return { artifact, compilerSha256: build.executableSha256 };
}

function derive(inputs, artifact, viem) {
  const { deployer, operatingTreasury, futureReserve, governanceSigners, economics } = inputs;
  const firstNonce = BigInt(inputs.confirmedDeployerNonce);
  const create = (from, nonce) => viem.getContractAddress({ from, nonce });
  const addressAt = (offset) => create(deployer, firstNonce + BigInt(offset));
  const directory = addressAt(0);
  const projectRegistry = addressAt(1);
  const successorDeployer = addressAt(2);
  const bootstrap = addressAt(3);
  const successorV3Template = addressAt(6);
  const graduationEngine = create(bootstrap, 2n);
  const factory = create(bootstrap, 3n);
  const {
    poolManager: { address: poolManager, runtimeHash: poolManagerHash },
    positionManager: { address: positionManager, runtimeHash: positionManagerHash },
    permit2: { address: permit2, runtimeHash: permit2Hash },
  } = review.externalRuntimePins;
  const dependencies = { poolManager, positionManager, permit2, poolManagerHash, positionManagerHash, permit2Hash };
  const guardArtifact = artifact("RMTV4CurveInitializationGuardV1", [poolManager, graduationEngine], { poolManager, graduationEngine });
  let guardSalt;
  let initializationGuard;
  for (let i = 0; i < 2_000_000; i++) {
    const salt = viem.toHex(i, { size: 32 });
    const address = viem.getCreate2Address({ from: bootstrap, salt, bytecodeHash: guardArtifact.initcodeHash });
    if ((BigInt(address) & 0x3fffn) === 0x2000n) {
      guardSalt = salt;
      initializationGuard = address;
      break;
    }
  }
  assert.ok(guardSalt && initializationGuard, "Guard permission salt search exhausted");
  const prediction = {
    directory, projectRegistry, successorDeployer, bootstrap, initializationGuard, graduationEngine, factory, successorV3Template,
  };
  const protectedAddresses = [deployer, operatingTreasury, futureReserve, ...governanceSigners, ...reviewedAddresses];
  const protectedSet = new Set(protectedAddresses.map((value) => value.toLowerCase()));
  const proposed = Object.values(prediction).map((value) => value.toLowerCase());
  assert.equal(new Set(proposed).size, proposed.length, "Deployment address collision");
  assert.ok(proposed.every((value) => !protectedSet.has(value)), "Derived deployment and input address collision");

  const [signerA, signerB, signerC] = governanceSigners;
  function eip712(name, version, verifyingContract) {
    const shortString = (str) => {
      const encoded = Buffer.from(str, "utf8");
      assert.ok(encoded.length <= 31);
      const word = Buffer.alloc(32);
      encoded.copy(word);
      word[31] = encoded.length;
      return "0x" + word.toString("hex");
    };
    const chainId = review.chainId;
    return {
      _cachedDomainSeparator: viem.hashDomain({
        domain: { name, version, chainId, verifyingContract },
        types: { EIP712Domain: viem.getTypesForEIP712Domain({ domain: { name, version, chainId, verifyingContract } }) },
      }),
      _cachedChainId: viem.toHex(chainId), _cachedThis: verifyingContract,
      _hashedName: viem.keccak256(viem.stringToHex(name)), _hashedVersion: viem.keccak256(viem.stringToHex(version)),
      _name: shortString(name), _version: shortString(version),
    };
  }
  const creationFeeWei = BigInt(economics.creationFeeWei);
  const directoryArtifact = artifact("RMTLaunchCurveDirectoryV1", governanceSigners, {
    ...eip712("RMT Launch Curve Directory", "1", directory), signerA, signerB, signerC,
  });
  const registryArtifact = artifact("RMTLaunchProjectRegistryV1", [directory],
    { ...eip712("RMT Launch Project Registry", "2", projectRegistry), directory });
  const successorArtifact = artifact("RMTLaunchCurveSuccessorDeployerV1", [], {});
  const successorDeployerRuntimeHash = successorArtifact.runtimeHash;
  const bootstrapArtifact = artifact("RMTLaunchCurveDeploymentV1", [
    dependencies, guardSalt, operatingTreasury, futureReserve, projectRegistry,
    successorDeployer, successorDeployerRuntimeHash, creationFeeWei,
  ], { factory, graduationEngine, initializationGuard });
  const engineArtifact = artifact("RMTV4CurveGraduationV1", [dependencies, factory, initializationGuard], {
    factory, poolManager, positionManager, permit2, initializationGuard, poolManagerRuntimeHash: poolManagerHash,
    positionManagerRuntimeHash: positionManagerHash, permit2RuntimeHash: permit2Hash,
    initializationGuardRuntimeHash: guardArtifact.runtimeHash,
  });
  const factoryArtifact = artifact("RMTLaunchCurveFactoryV1", [
    graduationEngine, operatingTreasury, futureReserve, projectRegistry, successorDeployer, successorDeployerRuntimeHash, creationFeeWei,
  ], { graduationEngine, operatingRecipient: operatingTreasury, futureReserveRecipient: futureReserve, projectRegistry,
    successorDeployer, successorDeployerRuntimeHash, creationFeeWei: viem.toHex(creationFeeWei) });
  const v3Artifact = artifact("RMTLaunchCurveSuccessorDeployerV2", [], {});

  const observed = {
    directory: reviewedConstructors.directory.gasUsed,
    projectRegistry: reviewedConstructors.registry.gasUsed,
    successorDeployer: reviewedConstructors.v2Template.gasUsed,
    bootstrap: reviewedConstructors.bootstrap.gasUsed,
    factorySchedule: matrix.deployment.factoryPublication.scheduled.gasUsed,
    factoryExecute: matrix.deployment.factoryPublication.executed.gasUsed,
    successorV3Template: reviewedConstructors.v3Template.gasUsed,
    migrationSchedule: matrix.deployment.v3Template.scheduled.gasUsed,
    migrationExecute: matrix.deployment.v3Template.executed.gasUsed,
  };
  function createStep(nonceOffset, address, contract, data, measuredGas = null) {
    return { kind: "CREATE", nonce: (firstNonce + BigInt(nonceOffset)).toString(), address, contract,
      ...data, fixtureGasUsed: measuredGas };
  }
  function directoryStep(nonceOffset, kind, actionKind, directoryNonce, version, target, runtimeHash, measuredGas) {
    return { kind, nonce: (firstNonce + BigInt(nonceOffset)).toString(), address: directory, fixtureGasUsed: measuredGas,
      action: { kind: actionKind, nonce: directoryNonce, version, factory: target, runtimeHash, deadline: null } };
  }

  function bootstrapStep(kind, internalNonce, address, data) {
    const { initcodeHash, initcodeSha256, runtimeHash, constructorData, initcodeBytes, initcodeHeadroomBytes,
      runtimeBytes, runtimeHeadroomBytes, eip3860Gas } = data;
    return { kind, internalNonce, address, initcodeHash, initcodeSha256, runtimeHash, constructorData, initcodeBytes,
      initcodeHeadroomBytes, runtimeBytes, runtimeHeadroomBytes, eip3860Gas };
  }

  return {
    prediction, guardSalt, externalDependencies: dependencies,
    bootstrapCreates: [
      bootstrapStep("CREATE2", 1, initializationGuard, guardArtifact),
      bootstrapStep("CREATE", 2, graduationEngine, engineArtifact),
      bootstrapStep("CREATE", 3, factory, factoryArtifact),
    ],
    sequence: [
      createStep(0, directory, "RMTLaunchCurveDirectoryV1", directoryArtifact, observed.directory),
      createStep(1, projectRegistry, "RMTLaunchProjectRegistryV1", registryArtifact, observed.projectRegistry),
      createStep(2, successorDeployer, "RMTLaunchCurveSuccessorDeployerV1", successorArtifact, observed.successorDeployer),
      createStep(3, bootstrap, "RMTLaunchCurveDeploymentV1", bootstrapArtifact, observed.bootstrap),
      directoryStep(4, "schedule", 0, 0, 1, factory, factoryArtifact.runtimeHash, observed.factorySchedule),
      directoryStep(5, "execute", 0, 0, 1, factory, factoryArtifact.runtimeHash, observed.factoryExecute),
      createStep(6, successorV3Template, "RMTLaunchCurveSuccessorDeployerV2", v3Artifact, observed.successorV3Template),
      directoryStep(7, "schedule", 4, 1, 3, successorV3Template, v3Artifact.runtimeHash, observed.migrationSchedule),
      directoryStep(8, "execute", 4, 1, 3, successorV3Template, v3Artifact.runtimeHash, observed.migrationExecute),
    ],
  };
}

function verifyFixture(artifact, viem) {
  const replay = derive({ deployer: fixture.operator, operatingTreasury: fixture.operatingRecipient,
    futureReserve: fixture.futureReserveRecipient, governanceSigners: fixtureSigners,
    confirmedDeployerNonce: String(fixture.nonce - 3), economics: draftTerms }, artifact, viem);
  const p = replay.prediction;
  for (const [actual, expected] of [
    [p.directory, freshDeployment.directory], [p.projectRegistry, freshDeployment.projectRegistry],
    [p.successorDeployer, fixture.successorDeployer], [p.bootstrap, fixture.address], [p.initializationGuard, freshDeployment.guard],
    [p.graduationEngine, freshDeployment.graduationEngine], [p.factory, freshDeployment.factory],
    [p.successorV3Template, freshDeployment.v3Template.deployer], [replay.guardSalt, fixture.guardSalt],
  ]) assert.equal(actual.toLowerCase(), expected.toLowerCase());

  assert.deepEqual(replay.sequence.filter(({ kind }) => kind === "CREATE").map(({ runtimeHash }) => runtimeHash), [
    freshDeployment.directoryRuntimeHash, freshDeployment.registryRuntimeHash, fixture.successorDeployerRuntimeHash,
    fixture.deploymentRuntimeHash, freshDeployment.v3Template.runtimeHash,
  ]);
  assert.deepEqual(replay.bootstrapCreates.map(({ runtimeHash }) => runtimeHash), [
    freshDeployment.guardRuntimeHash, freshDeployment.graduationRuntimeHash, freshDeployment.factoryRuntimeHash,
  ]);
  assert.equal(replay.bootstrapCreates[0].initcodeHash, fixture.guardCodeHash);
  const bootstrap = replay.sequence[3];
  assert.equal(bootstrap.initcodeSha256, fixture.initcode.sha256);
  assert.equal(bootstrap.initcodeBytes, fixture.initcode.sizeBytes);
  assert.equal(fromHex(bootstrap.constructorData).length, fixture.initcode.constructorBytes);
  assert.equal(bootstrap.calldataGas, fixture.initcode.calldataGas);
  assert.equal(bootstrap.eip3860Gas, fixture.initcode.eip3860Gas);
  const measured = replay.sequence.filter(({ fixtureGasUsed }) => fixtureGasUsed !== null);
  assert.equal(measured.length, 9);
  return { addresses: 8, runtimeHashes: 8, guardPermissionBits: "0x2000", fixtureBlock: review.freshFork.block,
    gas: { unit: "local fork gas units", measuredSteps: measured.length,
      measuredSubtotal: measured.reduce((total, entry) => total + Number(entry.fixtureGasUsed), 0), evidenceSha256Lf: matrixHash,
      bootstrapExecution: Number(fixture.gasUsed), bootstrapIntrinsic: bootstrap.creationIntrinsicGas,
      unmeasuredContracts: [] } };
}

async function main() {
  const { values } = parseArgs({ options: { input: { type: "string" }, checkout: { type: "string" }, solc: { type: "string" },
    output: { type: "string" }, "check-fixture": { type: "boolean" } } });
  assert.ok(!values["check-fixture"] || (!values.input && !values.output), "Fixture verification cannot write a production plan");
  const input = values.input ? JSON.parse(readFileSync(values.input, "utf8")) : template;
  const checkout = values.checkout && resolve(values.checkout);
  const compiler = values.solc && resolve(values.solc);
  if (checkout) verifyCheckout(checkout);
  const viem = checkout && addressTools(checkout);
  const missingInputs = validateInputs(input, viem?.getAddress);
  const status = { profile: review.profile, chainId: review.chainId, state: "BLOCKED_NO_BROADCAST", broadcastAuthorized: false,
    profileSha256Lf: sha256(reviewFile), compilerInputSha256: review.compiler.inputSha256, source: review.source,
    transforms: review.compiler.exactInputTransformation, dependencyRuntimePins: review.externalRuntimePins,
    missingInputs, economicsApproval: "UNVERIFIED_OFFLINE", derivedDeployment: null };
  if (!values["check-fixture"] && missingInputs.length) {
    assert.ok(!values.output, "Deployment output is blocked by unassigned inputs");
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  assert.ok(checkout && compiler && (values["check-fixture"] || (values.input && values.output)),
    "Supply --checkout <exact-594> --solc <pinned-solc> and either --check-fixture or --input <owner-inputs> --output <new-file>");
  const { artifact, compilerSha256 } = await compilerProfile(checkout, compiler, viem);
  const fixtureMatch = verifyFixture(artifact, viem);
  if (values["check-fixture"]) {
    console.log(JSON.stringify({ ...status, compilerSha256, fixtureMatch }, null, 2));
    return;
  }

  const { operatingTreasury, futureReserve, governanceSigners, governanceQuorum, economics, deployer, confirmedDeployerNonce,
    ownerApprovalReference } = input;
  const output = { ...status, compilerSha256, fixtureMatch,
    // A reference is recorded as supplied. This offline derivation does not authenticate it or any key holder.
    suppliedInputs: { operatingTreasury, futureReserve, governanceSigners, governanceQuorum, economics, deployer,
      confirmedDeployerNonce, ownerApprovalReference },
    signerPolicy: review.signerPolicy, derivedDeployment: derive(input, artifact, viem),
    checksBeforeAnyAuthorizedBroadcast: [
      "Reconfirm the approval reference, distinct signers' EOA control, exact treasury custody and ability to claim, and deployment authority.",
      "Verify the current canonical chain and all pinned dependencies. Recheck deployer pending nonce and unused derived addresses.",
      "Rehearse final input-specific runtime and gas on an isolated fork. Fixture gas and creation intrinsic gas are reference measurements.",
      "Resolve the unchanged security gate and obtain explicit separate authorization before signing, broadcasting, funding or activation.",
    ],
  };
  writeFileSync(resolve(values.output), JSON.stringify(output, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ profile: review.profile, state: status.state, broadcastAuthorized: false, derived: true, fixtureMatch }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
