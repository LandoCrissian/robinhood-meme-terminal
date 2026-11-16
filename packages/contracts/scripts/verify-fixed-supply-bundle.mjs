import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { compileFixedSupplyProfile, creationFee, rmtFixture, supply } from "./fixed-supply-profile.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeDeployData, encodeFunctionData,
  getContractAddress, getCreate2Address, getTypesForEIP712Domain, hashDomain, isAddressEqual, keccak256,
  padHex, stringToHex, toHex, zeroAddress } = require("viem");
const evidence = new URL("../../../docs/evidence/fixed-supply-security/", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const bytes = (hex) => Buffer.from(hex.slice(2), "hex");
const chainId = 4663;

export function eip712(name, version, verifyingContract) {
  const domain = { name, version, chainId, verifyingContract };
  const shortString = (value) => {
    const encoded = Buffer.from(value, "utf8");
    assert.ok(encoded.length <= 31);
    const word = Buffer.alloc(32);
    encoded.copy(word);
    word[31] = encoded.length;
    return "0x" + word.toString("hex");
  };
  return {
    _cachedDomainSeparator: hashDomain({ domain, types: { EIP712Domain: getTypesForEIP712Domain({ domain }) } }),
    _cachedChainId: toHex(chainId), _cachedThis: verifyingContract,
    _hashedName: keccak256(stringToHex(name)), _hashedVersion: keccak256(stringToHex(version)),
    _name: shortString(name), _version: shortString(version),
  };
}

export function materializeArtifact(compilation, contract, address, args, immutables) {
  const { abi, bytecode, runtime, immutableOffsets } = compilation.artifacts[contract];
  const initcode = encodeDeployData({ abi, bytecode, args });
  const materialized = bytes(runtime);
  for (const [id, positions] of Object.entries(immutableOffsets)) {
    const field = compilation.immutableNames.get(id);
    assert.ok(field && Object.hasOwn(immutables, field), "Missing immutable " + contract + "." + field);
    const value = bytes(padHex(immutables[field], { size: 32 }));
    for (const { start, length } of positions) {
      assert.ok(length === 32 && start + length <= materialized.length);
      assert.ok(materialized.subarray(start, start + length).every((byte) => byte === 0));
      value.copy(materialized, start);
    }
  }
  const runtimeHash = keccak256("0x" + materialized.toString("hex"));
  const initcodeBytes = bytes(initcode).length;
  assert.ok(initcodeBytes <= 49_152 && materialized.length <= 24_576, "EVM size limit exceeded");
  return { contract, address, constructorData: "0x" + initcode.slice(bytecode.length), initcodeHash: keccak256(initcode),
    runtimeHash, initcodeBytes, initcodeHeadroom: 49_152 - initcodeBytes,
    runtimeBytes: materialized.length, runtimeHeadroom: 24_576 - materialized.length };
}

function artifactPlan(compilation, contract, address, args, immutables, observedRuntimeHash) {
  const artifact = materializeArtifact(compilation, contract, address, args, immutables);
  assert.equal(artifact.runtimeHash, observedRuntimeHash, "Materialized runtime mismatch " + contract);
  return artifact;
}

export function buildBundle(compilation, fork, forkSha256) {
  const { deployment, report, unsignedConstructors, projects } = fork;
  const { manifest, artifacts } = compilation;
  const { profile, inputSha256, templates, terms } = manifest;
  assert.equal(fork.manifest.inputSha256, inputSha256);
  assert.deepEqual(fork.manifest.templates, templates);
  assert.equal(deployment.profile, profile);
  assert.equal(deployment.chainId, chainId);
  assert.equal(report.network.chainId, chainId);
  const pins = manifest.externalRuntimePins;
  for (const [name, expected] of Object.entries(pins)) {
    const observed = report.network.contracts[name];
    assert.ok(isAddressEqual(observed.address, expected.address), name);
    assert.equal(observed.runtimeHash, expected.runtimeHash, name);
  }
  const [directory, registry, v2, v3, bootstrap] = unsignedConstructors;
  assert.deepEqual(unsignedConstructors.map(({ name }) => name), ["directory", "registry", "successor-v2", "successor-v3", "bootstrap"]);
  const { from: deployer, nonce: firstNonce } = directory;
  assert.ok(Number.isSafeInteger(firstNonce) && firstNonce >= 0);
  for (const [index, entry] of unsignedConstructors.entries()) {
    assert.ok(isAddressEqual(entry.from, deployer));
    assert.equal(entry.nonce, firstNonce + index);
    assert.equal(entry.chainId, chainId);
    assert.equal(entry.value, "0");
    assert.equal(entry.scope, "LOOPBACK_FIXTURE_ONLY");
    assert.equal(entry.broadcastAuthorized, false);
    assert.ok(isAddressEqual(entry.address, getContractAddress({ from: deployer, nonce: BigInt(entry.nonce) })));
  }
  const { operatingRecipient, futureReserveRecipient, guardSalt, guardCodeHash, constructors } = deployment.deployment;
  assert.ok(!isAddressEqual(operatingRecipient, futureReserveRecipient));
  const dependencies = {
    poolManager: pins.poolManager.address, positionManager: pins.positionManager.address, permit2: pins.permit2.address,
    poolManagerHash: pins.poolManager.runtimeHash, positionManagerHash: pins.positionManager.runtimeHash, permit2Hash: pins.permit2.runtimeHash,
  };
  const engine = getContractAddress({ from: bootstrap.address, nonce: 2n });
  const factory = getContractAddress({ from: bootstrap.address, nonce: 3n });
  const guard = getCreate2Address({ from: bootstrap.address, salt: guardSalt, bytecodeHash: guardCodeHash });
  assert.equal(BigInt(guard) & 0x3fffn, 0x2000n);
  for (const [derived, observed] of [[engine, deployment.graduationEngine], [factory, deployment.factory],
    [guard, deployment.guard], [bootstrap.address, deployment.deployment.address], [directory.address, deployment.directory],
    [registry.address, deployment.projectRegistry]]) {
    assert.ok(isAddressEqual(derived, observed));
  }
  const directoryArtifact = artifacts.RMTLaunchCurveDirectoryV2;
  assert.ok(directory.data.startsWith(directoryArtifact.bytecode));
  const signers = decodeAbiParameters(directoryArtifact.abi.find(({ type }) => type === "constructor").inputs,
    "0x" + directory.data.slice(directoryArtifact.bytecode.length));
  assert.equal(new Set(signers.map((address) => address.toLowerCase())).size, 3);
  assert.ok(signers.every((address) => !isAddressEqual(address, zeroAddress)));
  const constructorsToRebuild = [
    [directory, "RMTLaunchCurveDirectoryV2", signers, eip712("RMT Launch Curve Directory", "2", directory.address), constructors.directory.receipt],
    [registry, "RMTLaunchProjectRegistryV3", [directory.address],
      { ...eip712("RMT Launch Project Registry", "4", registry.address), directory: directory.address }, constructors.registry.receipt],
    [v2, "RMTLaunchCurveSuccessorDeployerV1", [], {}, constructors.v2.receipt],
    [v3, "RMTLaunchCurveSuccessorDeployerV2", [], {}, constructors.v3.receipt],
    [bootstrap, "RMTLaunchCurveDeploymentV2", [dependencies, guardSalt, operatingRecipient, futureReserveRecipient,
      registry.address, v2.address, v2.runtimeHash, creationFee],
    { factory, graduationEngine: engine, initializationGuard: guard }, deployment.deployment],
  ];
  const transactions = constructorsToRebuild.map(([entry, contract, args, immutables, receipt]) => {
    const artifact = artifacts[contract];
    assert.equal(encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args }), entry.data, "Unexpected calldata " + contract);
    assert.equal(receipt.status, "success");
    const plan = artifactPlan(compilation, contract, entry.address, args, immutables, entry.runtimeHash);
    return { name: entry.name, nonce: entry.nonce, valueWei: "0", ...plan,
      observedForkReceipt: receipt.transactionHash, observedForkGasUsed: receipt.gasUsed };
  });
  assert.equal(directory.runtimeHash, deployment.directoryRuntimeHash);
  assert.equal(registry.runtimeHash, deployment.registryRuntimeHash);
  assert.equal(bootstrap.runtimeHash, deployment.deployment.bootstrapRuntimeHash);
  const guardPlan = artifactPlan(compilation, "RMTV4CurveInitializationGuardV1", guard, [dependencies.poolManager, engine],
    { poolManager: dependencies.poolManager, graduationEngine: engine }, deployment.guardRuntimeHash);
  assert.equal(guardPlan.initcodeHash, guardCodeHash);
  const factoryArgs = [engine, operatingRecipient, futureReserveRecipient, registry.address, v2.address, v2.runtimeHash, creationFee];
  const bootstrapChildren = [
    { ...guardPlan, create2Salt: guardSalt, hookPermissionBits: "0x2000" },
    artifactPlan(compilation, "RMTV4CurveGraduationV1", engine, [dependencies, factory, guard],
      { factory, poolManager: dependencies.poolManager, positionManager: dependencies.positionManager, permit2: dependencies.permit2,
        initializationGuard: guard, poolManagerRuntimeHash: dependencies.poolManagerHash,
        positionManagerRuntimeHash: dependencies.positionManagerHash, permit2RuntimeHash: dependencies.permit2Hash,
        initializationGuardRuntimeHash: guardPlan.runtimeHash }, deployment.graduationRuntimeHash),
    artifactPlan(compilation, "RMTLaunchCurveFactoryV2", factory, factoryArgs,
      { graduationEngine: engine, operatingRecipient, futureReserveRecipient, projectRegistry: registry.address,
        successorDeployer: v2.address, successorDeployerRuntimeHash: v2.runtimeHash, creationFeeWei: toHex(creationFee) },
      deployment.factoryRuntimeHash),
  ];
  const first = projects[0];
  const { unsigned } = first;
  const factoryAbi = artifacts.RMTLaunchCurveFactoryV2.abi;
  const { functionName, args } = decodeFunctionData({ abi: factoryAbi, data: unsigned.data });
  assert.equal(functionName, "create");
  assert.equal(unsigned.data, encodeFunctionData({ abi: factoryAbi, functionName, args }));
  assert.equal(unsigned.chainId, chainId);
  assert.equal(unsigned.status, "BLOCKED_NO_BROADCAST");
  assert.ok(isAddressEqual(unsigned.from, first.creator) && isAddressEqual(unsigned.to, factory));
  assert.equal(unsigned.value, creationFee.toString());
  assert.equal(first.initialBackingWei, "0");
  assert.equal(first.supplyWei, supply.toString());
  assert.equal(first.creation.status, "success");
  assert.deepEqual(args.slice(0, 5), [rmtFixture.name, rmtFixture.symbol, rmtFixture.projectURI, first.treasury,
    rmtFixture.treasuryShareBpsOfEligibleFees]);
  const tokenArtifact = artifacts.RMTLaunchCurveTokenV2;
  const tokenSalt = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [first.creator, args[5]]));
  const tokenInitcode = encodeDeployData({ abi: tokenArtifact.abi, bytecode: tokenArtifact.bytecode, args: args.slice(0, 2) });
  const expectedToken = getCreate2Address({ from: factory, salt: tokenSalt, bytecodeHash: keccak256(tokenInitcode) });
  assert.ok(isAddressEqual(expectedToken, first.projectAsset));
  const token = artifactPlan(compilation, "RMTLaunchCurveTokenV2", expectedToken, args.slice(0, 2), {}, first.tokenRuntimeHash);
  const poolKey = { currency0: zeroAddress, currency1: expectedToken, fee: 3000, tickSpacing: 60, hooks: guard };
  assert.deepEqual(poolKey, first.graduation.poolKey);
  const poolFields = [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }];
  const poolId = keccak256(encodeAbiParameters(poolFields, Object.values(poolKey)));
  assert.equal(poolId, first.graduation.poolId);
  return {
    schemaVersion: 1, profile, status: "BLOCKED_NO_BROADCAST", broadcastAuthorized: false, chainId,
    compiler: { version: manifest.compilerVersion, inputSha256, auxiliaryOutputInputSha256: compilation.auxiliaryCompilerInputSha256 },
    provisionalTerms: terms,
    production: { deployer: null, confirmedNonce: null, pendingNonce: null, operationsSafe: null, reserveSafe: null,
      governanceSigners: null, firstProjectName: null, firstProjectURI: null, firstProjectCreator: null,
      firstProjectTreasury: null, firstProjectTreasuryBps: null, economicApproval: null, deploymentApproval: null, transactions: [] },
    fixtureOnly: { scope: "LOOPBACK_FIXTURE_ONLY", forkSha256, anchor: { number: report.network.blockNumber, hash: report.network.blockHash },
      deployer, signers, quorum: 2, operatingRecipient, futureReserveRecipient, transactions, bootstrapChildren,
      totalConstructorGasObservedOnFork: transactions.reduce((total, row) => total + BigInt(row.observedForkGasUsed), 0n).toString(),
      firstProject: { ...unsigned, token: { ...token, create2Salt: tokenSalt }, poolKey, poolId, observesCreation: first.creation.transactionHash,
        observedForkGasUsed: first.creation.gasUsed } },
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: {
    solc: { type: "string" }, lib: { type: "string" }, fork: { type: "string" }, verify: { type: "string" }, output: { type: "string" },
  } });
  assert.ok(values.solc && values.fork && Boolean(values.verify) !== Boolean(values.output), "Supply --solc, --fork and --verify or --output");
  const compilation = compileFixedSupplyProfile({ ...values, chainId, includeImmutableNames: true });
  const pinned = readJson(new URL("4663-profile.json", evidence));
  const portable = ({ executablePlatform, executableSha256, ...fields }) => fields;
  assert.deepEqual(portable(compilation.manifest), portable(pinned));
  const archive = readFileSync(values.fork);
  const raw = values.fork.endsWith(".gz") ? gunzipSync(archive) : archive;
  const bundle = buildBundle(compilation, JSON.parse(raw), sha256(raw));
  if (values.verify) {
    assert.deepEqual(bundle, readJson(values.verify));
    console.log("Verified unsigned deployment and fixture-only RMT creation bundle; BLOCKED_NO_BROADCAST");
  } else {
    writeFileSync(values.output, JSON.stringify(bundle, null, 2) + "\n", { flag: "wx" });
  }
}
