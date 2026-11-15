import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { validateInputs as validateHistoricalInputs } from "../rmt-task041/deploy-inputs.mjs";
import { verifiedRelease } from "../rmt-task041-closeout/verify-release.mjs";
import { compileRotationProfile, governance, profile, verifyRotationManifest, webTools } from "./compile-rotation-profile.mjs";

const read = (path) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
const parse = (path) => JSON.parse(read(path));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hexBytes = (hex) => Buffer.from(hex.slice(2), "hex");
const baseline = parse(new URL("../rmt-task042/4663-treasury-review-manifest.json", import.meta.url));
const template = parse(new URL("./deploy-rotation-inputs.json", import.meta.url));
const { approved, ...draftTerms } = baseline.provisionalTerms;
assert.equal(approved, false);
const chainId = baseline.chainId;
const status = {
  profile, chainId, state: "BLOCKED_NO_BROADCAST", broadcastAuthorized: false,
  economicsApproval: "UNVERIFIED_OFFLINE", governance,
};

export function validateInputs(input, getAddress) {
  assert.equal(input.profile, profile, "Governance-rotation profile required");
  return validateHistoricalInputs({ ...input, profile: baseline.profile }, getAddress);
}

export function verifiedNonceObservation(preflight, release) {
  const { deploymentInput: input, observation } = preflight;
  assert.equal(preflight.state, "BLOCKED_NO_BROADCAST");
  assert.equal(preflight.broadcastAuthorized, false);
  assert.equal(preflight.chainId, chainId);
  assert.equal(preflight.profile, profile);
  assert.equal(preflight.planSha256Lf, null, "Use the input-only preflight");
  assert.equal(preflight.candidateCommit, release.candidateCommit);
  assert.equal(preflight.releaseManifestSha256Lf, release.releaseManifestSha256Lf);
  assert.deepEqual(preflight.releaseGate, release.releaseGate);
  assert.ok(input?.ownerApprovalReference, "Record explicit owner approval before deriving an input-specific plan");
  assert.equal(observation?.source, "https://rpc.mainnet.chain.robinhood.com");
  assert.ok(Number.isFinite(Date.parse(observation.observedAt)), "Missing observation time");
  assert.match(observation.block?.number, /^[1-9]\d*$/, "Missing canonical observation block");
  assert.match(observation.block?.hash, /^0x[0-9a-f]{64}$/i, "Missing canonical observation hash");
  assert.match(observation.block?.stateRoot, /^0x[0-9a-f]{64}$/i, "Missing canonical observation state root");
  assert.match(input.confirmedDeployerNonce, /^(0|[1-9]\d*)$/, "Recorded nonce is unassigned");
  for (const field of ["latest", "pending", "anchored", "recheckedLatest", "recheckedPending"]) {
    assert.equal(observation.nonce?.[field], input.confirmedDeployerNonce, "Nonce changed or pending use detected: " + field);
  }
  const roles = new Map(observation.roles.map((account) => [account.role, account]));
  const expected = [
    ["deployer", input.deployer], ["operatingTreasury", input.operatingTreasury], ["futureReserve", input.futureReserve],
    ...input.governanceSigners.map((address, i) => ["governanceSigner" + (i + 1), address]),
  ];
  assert.equal(observation.roles.length, expected.length);
  assert.equal(roles.size, expected.length);
  for (const [role, address] of expected) {
    const recorded = roles.get(role);
    assert.equal(recorded?.address?.toLowerCase(), address.toLowerCase(), "Preflight role mismatch: " + role);
    if (role === "deployer" || role.startsWith("governanceSigner")) {
      assert.equal(recorded.accountCode, "empty", "Expected code-empty EOA for " + role);
    }
  }
  return { input, observation };
}

export function governanceTypedData(input, viem) {
  assert.ok(input && typeof input === "object" && !Array.isArray(input), "Expected an unsigned governance input");
  assert.deepEqual(Object.keys(input).sort(), ["message", "schema", "verifyingContract"], "Exact governance input required");
  const { schema, verifyingContract, message } = input;
  const authority = schema === "migration" ? governance.registry : governance.directory;
  assert.ok(["action", "rotation", "acceptance", "cancellation", "migration"].includes(schema), "Unknown governance schema");
  assert.ok(viem.isAddress(verifyingContract) && verifyingContract !== viem.zeroAddress, "Invalid authority address");
  const [typeName, rawFields] = authority[schema].slice(0, -1).split("(");
  const fields = rawFields.split(",").map((field) => {
    const [type, name] = field.split(" ");
    return { name, type };
  });
  assert.ok(message && typeof message === "object" && !Array.isArray(message), "Expected a governance message");
  assert.deepEqual(Object.keys(message).sort(), fields.map(({ name }) => name).sort(), "Exact governance fields required");
  const normalizedMessage = Object.fromEntries(fields.map(({ name, type }) => {
    const value = message[name];
    if (type === "address") {
      assert.ok(viem.isAddress(value), "Valid Ethereum address required for " + name);
      return [name, viem.getAddress(value)];
    }
    if (type === "bytes32") {
      assert.match(value, /^0x[0-9a-fA-F]{64}$/, "Exact bytes32 required for " + name);
      return [name, value.toLowerCase()];
    }
    assert.ok(typeof value === "bigint" || Number.isSafeInteger(value) ||
      (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)), "Exact unsigned integer required for " + name);
    const number = BigInt(value);
    const maximum = (1n << BigInt(type.slice(4))) - 1n;
    assert.ok(number >= 0n && number <= maximum, type + " overflow for " + name);
    return [name, number.toString()];
  }));
  const domain = { ...authority.domain, chainId, verifyingContract: viem.getAddress(verifyingContract) };
  const request = {
    domain, types: { EIP712Domain: viem.getTypesForEIP712Domain({ domain }), [typeName]: fields },
    primaryType: typeName, message: normalizedMessage,
  };
  return { ...request, digest: viem.hashTypedData(request) };
}

function eip712Immutables({ name, version }, verifyingContract, viem) {
  const shortString = (value) => {
    const bytes = Buffer.from(value, "utf8");
    assert.ok(bytes.length <= 31);
    const word = Buffer.alloc(32);
    bytes.copy(word);
    word[31] = bytes.length;
    return "0x" + word.toString("hex");
  };
  const domain = { name, version, chainId, verifyingContract };
  return {
    _cachedDomainSeparator: viem.hashDomain({ domain, types: { EIP712Domain: viem.getTypesForEIP712Domain({ domain }) } }),
    _cachedChainId: viem.toHex(chainId),
    _cachedThis: verifyingContract,
    _hashedName: viem.keccak256(viem.stringToHex(name)),
    _hashedVersion: viem.keccak256(viem.stringToHex(version)),
    _name: shortString(name),
    _version: shortString(version),
  };
}

function encodeArtifact(compilation, viem, name, args, values) {
  const { abi, bytecode, runtime, immutableOffsets } = compilation.artifacts[name];
  const initcodeHex = viem.encodeDeployData({ abi, bytecode, args });
  const initcode = hexBytes(initcodeHex);
  const materialized = hexBytes(runtime);
  for (const [id, offsets] of Object.entries(immutableOffsets)) {
    const field = compilation.immutableNames.get(Number(id));
    assert.ok(field && Object.hasOwn(values, field), name + " is missing immutable " + field);
    const value = hexBytes(viem.padHex(values[field], { size: 32 }));
    for (const { start, length } of offsets) {
      assert.ok(length === 32 && start + length <= materialized.length &&
        materialized.subarray(start, start + length).every((byte) => byte === 0), name + " has an invalid immutable slot");
      value.copy(materialized, start);
    }
  }
  const { initcodeBytes: initcodeLimit, runtimeBytes: runtimeLimit } = compilation.manifest.limits;
  assert.ok(initcode.length <= initcodeLimit && materialized.length <= runtimeLimit, name + " exceeds EVM size limits");
  const calldataGas = initcode.reduce((sum, byte) => sum + (byte === 0 ? 4 : 16), 0);
  const eip3860Gas = 2 * Math.ceil(initcode.length / 32);
  return {
    initcodeHash: viem.keccak256(initcodeHex), initcodeSha256: sha256(initcode),
    constructorData: "0x" + initcodeHex.slice(bytecode.length),
    runtimeHash: viem.keccak256("0x" + materialized.toString("hex")),
    initcodeBytes: initcode.length, initcodeHeadroom: initcodeLimit - initcode.length,
    runtimeBytes: materialized.length, runtimeHeadroom: runtimeLimit - materialized.length,
    calldataGas, eip3860Gas, creationIntrinsicGas: 53_000 + calldataGas + eip3860Gas,
  };
}

export function deriveDeployment(input, compilation, viem) {
  const { deployer, operatingTreasury, futureReserve, governanceSigners, economics } = input;
  const firstNonce = BigInt(input.confirmedDeployerNonce);
  const create = (from, nonce) => viem.getContractAddress({ from, nonce });
  const at = (offset) => create(deployer, firstNonce + BigInt(offset));
  const directory = at(0), projectRegistry = at(1), v2Template = at(2), bootstrap = at(3), v3Template = at(6);
  const graduationEngine = create(bootstrap, 2n), factory = create(bootstrap, 3n);
  const {
    poolManager: { address: poolManager, runtimeHash: poolManagerHash },
    positionManager: { address: positionManager, runtimeHash: positionManagerHash },
    permit2: { address: permit2, runtimeHash: permit2Hash },
  } = compilation.manifest.externalRuntimePins;
  const dependencies = { poolManager, positionManager, permit2, poolManagerHash, positionManagerHash, permit2Hash };
  const encode = (name, args, immutable) => encodeArtifact(compilation, viem, name, args, immutable);
  const guard = encode("RMTV4CurveInitializationGuardV1", [poolManager, graduationEngine], { poolManager, graduationEngine });
  let guardSalt;
  let initializationGuard;
  for (let index = 0; index < 2_000_000; index++) {
    const salt = viem.toHex(index, { size: 32 });
    const address = viem.getCreate2Address({ from: bootstrap, salt, bytecodeHash: guard.initcodeHash });
    if ((BigInt(address) & 0x3fffn) === 0x2000n) {
      guardSalt = salt;
      initializationGuard = address;
      break;
    }
  }
  assert.ok(initializationGuard && guardSalt, "Guard permission salt search exhausted");
  const prediction = { directory, projectRegistry, v2Template, bootstrap, initializationGuard, graduationEngine, factory, v3Template };
  const proposed = Object.values(prediction).map((address) => address.toLowerCase());
  const protectedAddresses = [
    deployer, operatingTreasury, futureReserve, ...governanceSigners,
    ...Object.values(compilation.manifest.externalRuntimePins).map(({ address }) => address),
  ].map((address) => address.toLowerCase());
  assert.equal(new Set(proposed).size, proposed.length, "Deployment address collision");
  assert.ok(proposed.every((value) => !protectedAddresses.includes(value)), "Derived deployment and input address collision");

  const directoryData = encode(governance.directory.contract, governanceSigners,
    eip712Immutables(governance.directory.domain, directory, viem));
  const registryData = encode(governance.registry.contract, [directory],
    { ...eip712Immutables(governance.registry.domain, projectRegistry, viem), directory });
  const v2Data = encode("RMTLaunchCurveSuccessorDeployerV1", [], {});
  const v3Data = encode("RMTLaunchCurveSuccessorDeployerV2", [], {});
  const successorDeployerRuntimeHash = v2Data.runtimeHash;
  const creationFeeWei = BigInt(economics.creationFeeWei);
  const factoryArgs = [graduationEngine, operatingTreasury, futureReserve, projectRegistry, v2Template,
    successorDeployerRuntimeHash, creationFeeWei];
  const bootstrapData = encode("RMTLaunchCurveDeploymentV1", [
    dependencies, guardSalt, operatingTreasury, futureReserve, projectRegistry, v2Template,
    successorDeployerRuntimeHash, creationFeeWei,
  ], { factory, graduationEngine, initializationGuard });
  const engineData = encode("RMTV4CurveGraduationV1", [dependencies, factory, initializationGuard], {
    factory, poolManager, positionManager, permit2, initializationGuard, poolManagerRuntimeHash: poolManagerHash,
    positionManagerRuntimeHash: positionManagerHash, permit2RuntimeHash: permit2Hash,
    initializationGuardRuntimeHash: guard.runtimeHash,
  });
  const factoryData = encode("RMTLaunchCurveFactoryV1", factoryArgs, {
    graduationEngine, operatingRecipient: operatingTreasury, futureReserveRecipient: futureReserve,
    projectRegistry, successorDeployer: v2Template, successorDeployerRuntimeHash, creationFeeWei: viem.toHex(creationFeeWei),
  });

  function creation(nonceOffset, address, contract, data) {
    return { kind: "CREATE", nonce: (firstNonce + BigInt(nonceOffset)).toString(), address, contract, ...data };
  }
  function publication(nonceOffset, method, kind, nonce, version, target, runtimeHash) {
    const expectedEvents = method === "schedule"
      ? [{ name: "ActionScheduled", nonce, noticeSeconds: governance.noticeSeconds,
        maximumExecutionWindowSeconds: governance.maximumExecutionWindowSeconds }]
      : [{ name: kind === 0 ? "FactoryPublished" : "MigrationTemplatePublished", version, target, runtimeHash },
        { name: "ActionCleared", nonce }];
    return {
      kind: method, nonce: (firstNonce + BigInt(nonceOffset)).toString(), address: directory,
      action: { kind, nonce, version, factory: target, runtimeHash, signerSetEpoch: governance.initialSignerSetEpoch, deadline: null },
      expectedEvents,
    };
  }
  return {
    prediction, guardSalt, externalDependencies: dependencies,
    bootstrapCreates: [
      { kind: "CREATE2", internalNonce: 1, address: initializationGuard, ...guard },
      { kind: "CREATE", internalNonce: 2, address: graduationEngine, ...engineData },
      { kind: "CREATE", internalNonce: 3, address: factory, ...factoryData },
    ],
    sequence: [
      creation(0, directory, governance.directory.contract, directoryData),
      creation(1, projectRegistry, governance.registry.contract, registryData),
      creation(2, v2Template, "RMTLaunchCurveSuccessorDeployerV1", v2Data),
      creation(3, bootstrap, "RMTLaunchCurveDeploymentV1", bootstrapData),
      publication(4, "schedule", 0, 0, 1, factory, factoryData.runtimeHash),
      publication(5, "execute", 0, 0, 1, factory, factoryData.runtimeHash),
      creation(6, v3Template, "RMTLaunchCurveSuccessorDeployerV2", v3Data),
      publication(7, "schedule", 4, 1, 3, v3Template, v3Data.runtimeHash),
      publication(8, "execute", 4, 1, 3, v3Template, v3Data.runtimeHash),
    ],
  };
}

function verifyFixtureDeployment(fork, compilation, viem) {
  assert.equal(fork.profile, profile, "Unexpected fork candidate");
  assert.equal(fork.compiler.inputSha256, compilation.manifest.inputSha256, "Fork compiler input mismatch");
  assert.equal(fork.report.network.blockHash, baseline.freshFork.blockHash, "Fork anchor mismatch");
  assert.equal(fork.report.network.stateRoot, baseline.freshFork.stateRoot, "Fork state root mismatch");
  assert.equal(fork.report.execution.host, "127.0.0.1", "Expected isolated loopback execution");
  assert.equal(fork.report.execution.chainId, chainId, "Expected the 4663 fixture chain");
  assert.equal(fork.report.archiveBoundary.blockedWriteProbe, "HTTP 403", "Expected read-only archive boundary");
  const { deployment, constructors } = fork;
  const bootstrap = deployment.deployment;
  const governanceSigners = deployment.governanceSigners;
  assert.ok(Array.isArray(governanceSigners) && governanceSigners.length === 3,
    "Fork evidence must record the three initial public signers");
  const predicted = deriveDeployment({
    deployer: bootstrap.operator, operatingTreasury: bootstrap.operatingRecipient, futureReserve: bootstrap.futureReserveRecipient,
    governanceSigners, confirmedDeployerNonce: (BigInt(bootstrap.nonce) - 3n).toString(), economics: draftTerms,
  }, compilation, viem);
  const addresses = {
    directory: deployment.directory, projectRegistry: deployment.projectRegistry, v2Template: bootstrap.successorDeployer,
    bootstrap: bootstrap.address, initializationGuard: deployment.guard, graduationEngine: deployment.graduationEngine,
    factory: deployment.factory, v3Template: deployment.v3Template.deployer,
  };
  for (const [name, actual] of Object.entries(addresses)) {
    assert.equal(predicted.prediction[name].toLowerCase(), actual.toLowerCase(), name + " target address mismatch");
  }
  assert.equal(predicted.guardSalt, bootstrap.guardSalt);
  const creation = predicted.sequence.filter(({ kind }) => kind === "CREATE");
  assert.deepEqual(creation.map(({ runtimeHash }) => runtimeHash), [
    deployment.directoryRuntimeHash, deployment.registryRuntimeHash, bootstrap.successorDeployerRuntimeHash,
    bootstrap.deploymentRuntimeHash, deployment.v3Template.runtimeHash,
  ]);
  assert.deepEqual(predicted.bootstrapCreates.map(({ runtimeHash }) => runtimeHash), [
    deployment.guardRuntimeHash, deployment.graduationRuntimeHash, deployment.factoryRuntimeHash,
  ]);
  assert.equal(predicted.bootstrapCreates[0].initcodeHash, bootstrap.guardCodeHash);
  const bootstrapPlan = predicted.sequence[3];
  assert.equal(bootstrapPlan.initcodeSha256, bootstrap.initcode.sha256);
  assert.equal(bootstrapPlan.initcodeBytes, bootstrap.initcode.sizeBytes);
  assert.equal(bootstrapPlan.initcodeHeadroom, bootstrap.initcode.headroomBytes);
  assert.equal(hexBytes(bootstrapPlan.constructorData).length, bootstrap.initcode.constructorBytes);
  assert.equal(bootstrapPlan.calldataGas, bootstrap.initcode.calldataGas);
  assert.equal(bootstrapPlan.eip3860Gas, bootstrap.initcode.eip3860Gas);
  const receipts = {
    directory: constructors.directory, registry: constructors.registry, v2Template: constructors.v2Template,
    bootstrap: constructors.bootstrap, publishFactorySchedule: deployment.factoryPublication.scheduled,
    publishFactoryExecution: deployment.factoryPublication.executed, v3Template: constructors.v3Template,
    publishV3Schedule: deployment.v3Template.scheduled, publishV3Execution: deployment.v3Template.executed,
  };
  for (const [step, receipt] of Object.entries(constructors)) {
    const expectedAddress = step === "registry" ? addresses.projectRegistry : addresses[step];
    assert.equal(receipt.address.toLowerCase(), expectedAddress.toLowerCase(), step + " receipt target mismatch");
  }
  const blocks = Object.values(receipts).map(({ blockNumber }) => BigInt(blockNumber));
  assert.ok(blocks.every((block, i) => i === 0 || block > blocks[i - 1]), "Expected nine ordered fixture receipts");
  assert.equal(new Set(Object.values(receipts).map(({ transactionHash }) => transactionHash)).size, 9);
  const gasByStep = Object.fromEntries(Object.entries(receipts).map(([step, receipt]) => {
    const gas = Number(receipt.gasUsed);
    assert.ok(Number.isSafeInteger(gas) && gas > 0 && Number(receipt.blockNumber) > baseline.freshFork.block,
      "Invalid local fork gas receipt " + step);
    assert.match(receipt.transactionHash, /^0x[0-9a-f]{64}$/i);
    assert.match(receipt.blockHash, /^0x[0-9a-f]{64}$/i);
    return [step, gas];
  }));
  return {
    matchedAddresses: Object.keys(addresses).length,
    matchedRuntimeHashes: creation.length + predicted.bootstrapCreates.length,
    guardPermissionBits: "0x2000",
    forkBlock: baseline.freshFork.block,
    deploymentExecutionGas: Object.values(gasByStep).reduce((total, gas) => total + gas, 0),
    gasByStep, bootstrapIntrinsicGas: bootstrapPlan.creationIntrinsicGas,
    size: compilation.manifest.size,
  };
}

async function main() {
  const { values } = parseArgs({ options: {
    checkout: { type: "string" }, solc: { type: "string" }, lib: { type: "string" },
    input: { type: "string" }, preflight: { type: "string" }, output: { type: "string" },
    "typed-data": { type: "string" }, "check-fixture": { type: "string" },
  } });
  if (values["typed-data"]) {
    assert.ok(values.checkout && !values.input && !values.preflight && !values.output && !values.solc && !values.lib && !values["check-fixture"],
      "Use --typed-data only with --checkout");
    console.log(JSON.stringify(governanceTypedData(parse(values["typed-data"]), webTools(values.checkout)), null, 2));
    return;
  }
  if (values["check-fixture"]) {
    assert.ok(values.checkout && values.solc && !values.input && !values.preflight && !values.output,
      "Fixture verification cannot write a production plan");
    const compilation = await compileRotationProfile(values);
    verifyRotationManifest(compilation.manifest);
    const path = values["check-fixture"];
    const measured = verifyFixtureDeployment(parse(path), compilation, webTools(values.checkout));
    console.log(JSON.stringify({ profile, state: status.state, broadcastAuthorized: false,
      inputSha256: compilation.manifest.inputSha256, evidenceSha256Lf: sha256(read(path)), ...measured }, null, 2));
    return;
  }

  const release = verifiedRelease();
  const releaseStatus = { ...status, candidateCommit: release.candidateCommit,
    releaseManifestSha256Lf: release.releaseManifestSha256Lf, releaseGate: release.releaseGate };
  assert.ok(!values.preflight || !values.input, "Use either --preflight or --input");
  const direct = values.preflight && verifiedNonceObservation(parse(values.preflight), release);
  const input = direct ? direct.input : values.input ? parse(values.input) : template;
  const viem = values.checkout && webTools(values.checkout);
  const missingInputs = validateInputs(input, viem?.getAddress);
  if (missingInputs.length) {
    assert.ok(!values.output, "Deployment output is blocked by unassigned inputs");
    console.log(JSON.stringify({ ...releaseStatus, missingInputs, derivedDeployment: null }, null, 2));
    return;
  }
  assert.ok(direct && values.checkout && values.solc && values.output,
    "Require a direct --preflight report, --checkout, --solc and a new --output");
  const compilation = await compileRotationProfile(values);
  verifyRotationManifest(compilation.manifest);
  const result = {
    ...releaseStatus, missingInputs, suppliedInputs: input, manifest: compilation.manifest,
    nonceObservation: direct.observation,
    derivedDeployment: deriveDeployment(input, compilation, viem),
    releaseRequirements: [
      "Reconfirm exact approvals, signer EOA control, beneficiary custody, deployer nonce and derived address vacancy.",
      "Reserve exclusive use of the deployer until completion and re-read latest and pending nonce immediately before each later authorized step.",
      "Reproduce exact runtime and estimate total execution and posting gas with approved inputs on an isolated fork.",
      "Resolve the security and release gates before separate approvals for signing, broadcasting, funding or activation.",
    ],
  };
  writeFileSync(resolve(values.output), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ ...releaseStatus, derived: true, inputSha256: compilation.manifest.inputSha256, size: compilation.manifest.size }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
