import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { buildFixedSupplyInput, compileFixedSupplyProfile, supply } from "./fixed-supply-profile.mjs";
import { buildBundle, materializeArtifact } from "./verify-fixed-supply-bundle.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { encodeAbiParameters, getContractAddress, getCreate2Address, isAddressEqual, keccak256, toHex, zeroAddress } = require("viem");
const evidence = new URL("../../../docs/evidence/", import.meta.url);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const read = (path) => readFileSync(new URL(path, evidence));
const readJson = (path) => JSON.parse(read(path));
const portable = ({ executablePlatform, executableSha256, ...fields }) => fields;
const explorer = "https://robinhoodchain.blockscout.com";

export function verifyExportInputs({ input, archive, release, pinned, compiled, savedBundle }) {
  assert.deepEqual(portable(compiled), portable(pinned), "Compiler output differs from the pinned 4663 release");
  assert.equal(release.status, "BLOCKED_NO_BROADCAST");
  assert.equal(release.broadcastAuthorized, false);
  assert.equal(release.staticAnalysis.status, "FAIL_HIGH");
  assert.equal(compiled.chainId, 4663);
  assert.equal(compiled.status, "BLOCKED_NO_BROADCAST");
  assert.equal(compiled.broadcastAuthorized, false);
  assert.equal(sha256(input), compiled.inputSha256, "Standard JSON input digest mismatch");
  assert.equal(compiled.inputSha256, release.compiler.inputSha256, "Release compiler digest mismatch");
  assert.equal(sha256(archive), release.fork.archiveSha256, "Archived loopback evidence digest mismatch");
  const raw = gunzipSync(archive);
  assert.equal(sha256(raw), release.fork.reportSha256, "Uncompressed loopback evidence digest mismatch");
  const bundleText = savedBundle.toString("utf8").replaceAll("\r\n", "\n");
  assert.equal(sha256(bundleText), release.unsignedBundleSha256Lf, "Reviewed bundle digest mismatch");
  const fork = JSON.parse(raw);
  assert.equal(fork.report.execution.host, "127.0.0.1");
  assert.equal(fork.report.execution.chainId, 4663);
  assert.equal(fork.report.network.blockHash, release.fork.blockHash);
  assert.equal(fork.report.archiveBoundary.blockedWriteProbe, "HTTP 403");
  const bundle = JSON.parse(bundleText);
  assert.equal(bundle.fixtureOnly.forkSha256, sha256(raw));
  assert.equal(bundle.broadcastAuthorized, false);
  assert.ok(Object.entries(bundle.production).every(([name, value]) => name === "transactions" ? Array.isArray(value) && value.length === 0 : value === null));
  return { fork, rawSha256: sha256(raw), bundle };
}

function createdAt(deployer, nonce) {
  return { opcode: "CREATE", deployer, nonce: nonce.toString() };
}

function salted(deployer, salt) {
  return { opcode: "CREATE2", deployer, salt };
}

export function deriveFixtureAddress({ opcode, deployer, nonce, salt }, initcodeHash) {
  if (opcode === "CREATE") return getContractAddress({ from: deployer, nonce: BigInt(nonce) });
  assert.equal(opcode, "CREATE2");
  return getCreate2Address({ from: deployer, salt, bytecodeHash: initcodeHash });
}

function fixtureRows(compilation, fork, bundle) {
  const rows = [];
  const record = (artifact, creation, receipt, runtimeObserved, constructorEvidence) => {
    const { contract, address, constructorData, initcodeHash, runtimeHash, initcodeBytes, runtimeBytes } = artifact;
    assert.ok(isAddressEqual(address, deriveFixtureAddress(creation, initcodeHash)), "Fixture creation identity mismatch: " + contract);
    const { transactionHash, blockNumber, blockHash, status } = receipt;
    assert.equal(status, "success");
    assert.match(transactionHash, /^0x[0-9a-f]{64}$/);
    assert.match(blockHash, /^0x[0-9a-f]{64}$/);
    assert.match(blockNumber, /^\d+$/);
    if (runtimeObserved !== null) assert.equal(runtimeHash, runtimeObserved, "Fixture runtime mismatch: " + contract);
    const { file, creationSha256, runtimeSha256 } = compilation.manifest.templates[contract];
    rows.push({
      fullyQualifiedName: file + ":" + contract,
      expectedTemplate: { creationSha256, runtimeSha256, initcodeBytes, runtimeBytes },
      fixtureOnly: {
        scope: "LOOPBACK_FIXTURE_ONLY", address, creation, transactionHash, blockNumber, blockHash,
        constructorArguments: constructorData, constructorEvidence, initcodeKeccak256: initcodeHash,
        reconstructedRuntimeKeccak256: runtimeHash, observedRuntimeKeccak256: runtimeObserved,
      },
      production: { address: null, transactionHash: null, creationTrace: null, constructorArguments: null, verifiedRuntimeKeccak256: null },
    });
  };
  const { fixtureOnly: fixture } = bundle;
  const { deployment } = fork.deployment;
  const topLevelReceipts = ["directory", "registry", "v2", "v3"].map((name) => deployment.constructors[name].receipt);
  topLevelReceipts.push(deployment);
  for (const [index, transaction] of fixture.transactions.entries()) {
    const receipt = topLevelReceipts[index];
    assert.equal(receipt.transactionHash, transaction.observedForkReceipt);
    record(transaction, createdAt(fixture.deployer, transaction.nonce), receipt, transaction.runtimeHash, "FORK_TRANSACTION_INPUT");
  }
  const bootstrap = fixture.transactions.find(({ contract }) => contract === "RMTLaunchCurveDeploymentV2");
  const [guard, engine, factory] = fixture.bootstrapChildren;
  assert.equal(guard.hookPermissionBits, "0x2000");
  for (const [artifact, identity] of [[guard, salted(bootstrap.address, guard.create2Salt)],
    [engine, createdAt(bootstrap.address, 2n)], [factory, createdAt(bootstrap.address, 3n)]]) {
    record(artifact, identity, deployment, artifact.runtimeHash, "PINNED_BOOTSTRAP_AND_FORK_RUNTIME");
  }

  const first = fork.projects[0];
  const token = fixture.firstProject.token;
  assert.equal(first.creation.status, "success");
  record(token, salted(factory.address, token.create2Salt), first.creation, first.tokenRuntimeHash,
    "FACTORY_CREATE_INPUT_AND_FORK_RUNTIME");

  const [v2, v3] = first.migrations;
  assert.deepEqual(first.migrations.map(({ version }) => version), [2, 3]);
  assert.ok(isAddressEqual(v2.successor, v3.source));
  assert.ok(isAddressEqual(v3.successor, first.graduation.curve));
  assert.ok(isAddressEqual(v2.revenueLedger, v3.revenueLedger));
  const originalCurve = v2.source;
  const originalLedger = v2.revenueLedger;
  const beneficiaries = {
    creator: first.creator, treasury: first.treasury, treasuryShareBps: first.treasuryBps,
    operatingRecipient: fixture.operatingRecipient, futureReserveRecipient: fixture.futureReserveRecipient,
  };
  const beneficiaryArgs = Object.values(beneficiaries);
  const marketImmutables = {
    ...beneficiaries, treasuryShareBps: toHex(first.treasuryBps), factory: factory.address, token: token.address,
    graduationEngine: engine.address, revenueLedger: originalLedger, totalSupply: toHex(supply),
    virtualToken: toHex(supply * 9n / 5n), graduationSold: toHex(supply * 3n / 5n), projectRegistry: fork.deployment.projectRegistry,
  };
  const original = materializeArtifact(compilation, "RMTLaunchBondingCurveV1", originalCurve,
    [token.address, ...beneficiaryArgs, engine.address, fork.deployment.projectRegistry, factory.address, zeroAddress, zeroAddress],
    { ...marketImmutables, migrationSource: zeroAddress });
  record(original, createdAt(factory.address, 2n), first.creation, null,
    "RECONSTRUCTED_FACTORY_INPUT_AND_ARCHIVED_MIGRATION_SOURCE");
  const ledger = materializeArtifact(compilation, "RMTLaunchCurveRevenueLedgerV1", originalLedger,
    beneficiaryArgs, { ...beneficiaries, treasuryShareBps: toHex(first.treasuryBps), curve: originalCurve });
  record(ledger, createdAt(originalCurve, 1n), first.creation, null,
    "RECONSTRUCTED_CURVE_CONSTRUCTOR_AND_ARCHIVED_LEDGER_IDENTITY");

  const helpers = fixture.transactions.filter(({ contract }) => contract.startsWith("RMTLaunchCurveSuccessorDeployer"));
  assert.deepEqual(helpers.map(({ contract }) => contract), ["RMTLaunchCurveSuccessorDeployerV1", "RMTLaunchCurveSuccessorDeployerV2"]);
  for (const [index, hop] of first.migrations.entries()) {
    const contract = "RMTLaunchBondingCurveV" + hop.version;
    assert.equal(hop.prepared.status, "success");
    assert.equal(hop.migrated.status, "success");
    const factorySalt = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint32" }],
      [token.address, hop.source, hop.version]));
    const helperSalt = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }],
      [factory.address, factorySalt]));
    const artifact = materializeArtifact(compilation, contract, hop.successor, [hop.source],
      { ...marketImmutables, migrationSource: hop.source });
    record(artifact, salted(helpers[index].address, helperSalt), hop.prepared, hop.runtimeHash,
      "PREPARE_MIGRATION_RECEIPT_AND_FORK_RUNTIME");
  }

  const ledgers = first.settlementTraces.graduation.filter(({ type }) => type === "CREATE");
  assert.equal(ledgers.length, 1);
  const [lpLedger] = ledgers;
  assert.ok(isAddressEqual(lpLedger.from, engine.address));
  const manager = compilation.manifest.externalRuntimePins.poolManager.address;
  const lp = materializeArtifact(compilation, "RMTLaunchCurveLpFeeLedgerV1", lpLedger.to,
    [token.address, manager, beneficiaries],
    { ...beneficiaries, treasuryShareBps: toHex(first.treasuryBps), engine: engine.address, poolManager: manager, token: token.address });
  assert.equal(lp.initcodeHash, lpLedger.inputHash, "Graduation trace constructor data mismatch");
  assert.equal(first.graduation.receipt.status, "success");
  record(lp, createdAt(engine.address, 1n), first.graduation.receipt, null, "FORK_CREATE_TRACE_INITCODE_HASH");
  assert.equal(new Set(rows.map(({ fullyQualifiedName }) => fullyQualifiedName)).size, rows.length);
  assert.equal(new Set(rows.map(({ fixtureOnly }) => fixtureOnly.address.toLowerCase())).size, rows.length);
  return rows;
}

function safePins(fork) {
  const source = readJson("rmt-task046/treasury-safe-initializers.json");
  const policy = readJson("rmt-task045/operations-safe-policy.json");
  const safeRegistry = readJson("rmt-task044/safe-infrastructure-4663.json").registry.contracts["1.4.1"];
  assert.equal(source.chainId, 4663);
  assert.equal(source.broadcastAuthorized, false);
  assert.equal(policy.chainId, 4663);
  const safeAddresses = [safeRegistry.safe_l2, safeRegistry.safe_proxy_factory, safeRegistry.compatibility_fallback_handler];
  for (const [index, role] of ["singleton", "factory", "fallback"].entries()) {
    assert.ok(isAddressEqual(fork.safe[role], safeAddresses[index].address));
  }
  const proposals = source.proposals.map(({ role, counterfactualAddress, saltNonce, create2Salt, initializerKeccak256, verifiedBeneficiary }) => {
    assert.equal(verifiedBeneficiary, null);
    assert.ok(isAddressEqual(counterfactualAddress, deriveFixtureAddress(salted(policy.operations.factory, create2Salt), source.initcodeKeccak256)));
    return { role, counterfactualAddress, saltNonce, create2Salt, initializerKeccak256, verifiedBeneficiary };
  });
  return {
    externalContracts: safeAddresses.map(({ address, registryRuntimeKeccak256 }) => ({ address, runtimeKeccak256: registryRuntimeKeccak256 })),
    profile: policy.operations.safeProfile, threshold: policy.operations.threshold, proposals,
    expectedProxyInitcodeKeccak256: source.initcodeKeccak256,
    syntheticProxy: { scope: "LOOPBACK_FIXTURE_ONLY", address: fork.safe.proxy, transactionHash: fork.safe.transactionHash,
      runtimeKeccak256: fork.safe.runtimeHash, logIndex: fork.safe.proxyCreationLogIndex },
  };
}

export function buildBlockscoutExport(compilation, input, { archive, release, pinned, savedBundle }) {
  const { fork, rawSha256, bundle } = verifyExportInputs({
    input, archive, release, pinned, compiled: compilation.manifest, savedBundle,
  });
  assert.deepEqual(buildBundle(compilation, fork, rawSha256), bundle, "Reconstructed unsigned fixture differs");
  const contracts = fixtureRows(compilation, fork, bundle);
  const infrastructureNames = new Set([
    "RMTLaunchCurveDirectoryV2", "RMTLaunchProjectRegistryV3", "RMTLaunchCurveSuccessorDeployerV1",
    "RMTLaunchCurveSuccessorDeployerV2", "RMTLaunchCurveDeploymentV2", "RMTV4CurveInitializationGuardV1",
    "RMTV4CurveGraduationV1", "RMTLaunchCurveFactoryV2",
  ]);
  const infrastructure = contracts.filter(({ fullyQualifiedName }) => infrastructureNames.has(fullyQualifiedName.split(":").at(-1)));
  assert.equal(infrastructure.length, infrastructureNames.size, "Incomplete infrastructure verification scope");
  return {
    schemaVersion: 1, profile: pinned.profile, chainId: 4663, explorer,
    status: "BLOCKED_NO_BROADCAST", broadcastAuthorized: false, sourceVerificationSubmitted: false,
    compiler: { version: pinned.compilerVersion, inputFile: "solc-standard-input-4663.json", inputSha256: pinned.inputSha256,
      settings: pinned.compilerSettings },
    evidence: { baseContractCommit: release.deployableSourceCommit, forkReportSha256: rawSha256,
      archivedBlock: release.fork.blockNumber, archivedBlockHash: release.fork.blockHash },
    deploymentScope: {
      infrastructure: infrastructure.map(({ fullyQualifiedName }) => fullyQualifiedName),
      laterProjectLifecycle: contracts.filter((row) => !infrastructure.includes(row)).map(({ fullyQualifiedName }) => fullyQualifiedName),
      tokenIssuanceIncluded: false,
      firstProjectEntryPoint: "/create-token", firstProjectApproval: null,
      sequence: "VERIFY_INFRASTRUCTURE_THEN_OWNER_CREATES_RMT_THROUGH_WEBSITE",
    },
    ownContracts: contracts,
    externallyDeployed: pinned.externalRuntimePins,
    safe: safePins(fork),
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { solc: { type: "string" }, lib: { type: "string" }, "output-dir": { type: "string" } } });
  assert.ok(values.solc && values["output-dir"], "Supply --solc and a fresh --output-dir");
  const options = { solc: values.solc, lib: values.lib, chainId: 4663 };
  const { input } = buildFixedSupplyInput(options);
  const compilation = compileFixedSupplyProfile({ ...options, includeImmutableNames: true });
  const payload = buildBlockscoutExport(compilation, input, {
    archive: read("fixed-supply-release/fork-4663.json.gz"),
    release: readJson("fixed-supply-release/release-manifest.json"),
    pinned: readJson("fixed-supply-security/4663-profile.json"),
    savedBundle: read("fixed-supply-release/unsigned-bundle.json"),
  });
  const output = resolve(values["output-dir"]);
  mkdirSync(output); // Never overwrite an existing verification export.
  writeFileSync(join(output, payload.compiler.inputFile), input, { flag: "wx" });
  writeFileSync(join(output, "blockscout-verification.json"), JSON.stringify(payload, null, 2) + "\n", { flag: "wx" });
  console.log("Wrote pinned Standard JSON and " + payload.ownContracts.length + " loopback contract rows; BLOCKED_NO_BROADCAST");
}
