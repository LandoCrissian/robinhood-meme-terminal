import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {parseArgs} from "node:util";
import {compileFixedSupplyProfile} from "../../packages/contracts/scripts/fixed-supply-profile.mjs";
import {eip712, materializeArtifact} from "../../packages/contracts/scripts/verify-fixed-supply-bundle.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const {keccak256, toHex} = require("viem");
const readJson = path => JSON.parse(readFileSync(resolve(repo, path), "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const hexBytes = hex => Buffer.from(hex.slice(2), "hex");
const profile = readJson("docs/evidence/fixed-supply-security/4663-profile.json");
const protocol = readJson("docs/evidence/mobile-signing/protocol-mainnet.json");
const owner = readJson("docs/evidence/mobile-signing/protocol-owner-plan.json");
const originalSigners = readJson("docs/evidence/mobile-signing/protocol-directory-mainnet.json").initialState;
const roles = Object.freeze({directory: "RMTLaunchCurveDirectoryV2", registry: "RMTLaunchProjectRegistryV3",
  factory: "RMTLaunchCurveFactoryV2", successorV2: "RMTLaunchCurveSuccessorDeployerV1", successorV3: "RMTLaunchCurveSuccessorDeployerV2"});
const fixtureContracts = [...Object.values(roles), "RMTLaunchCurveDeploymentV2", "RMTV4CurveInitializationGuardV1",
  "RMTV4CurveGraduationV1", "RMTLaunchCurveLpFeeLedgerV1"];
const pins = Object.fromEntries(Object.entries(roles).map(([role, contract]) => {
  const row = [...protocol.constructors, ...protocol.bootstrapChildren].find(row => row.contract === contract);
  assert.ok(row, "Missing retained deployed identity " + contract);
  return [role, {contract, address: row.address, runtimeHash: row.runtimeHash, byteLength: row.runtimeBytes}];
}));
const providers = Object.freeze({official: "https://rpc.mainnet.chain.robinhood.com", pocket: "https://robinhood.api.pocket.network"});
const ids = [
  "04dd86035f4ee7098c24bb34ee716fb14d25372ec3714df5c746a364f9aa83d9",
  "1fdf2b7ea9c9f97d447984c8465928fb275e1762930f87972a33d2dedc10f9da",
  "7f0d825327586187a4f0c915e12ad0b7ecb6555643bb51e223e5ec407788b16a",
  "be7b3e4ab44843109965a75e105e1eeda02e07c291640eecad1a6a313afdbdee",
  "c87c792deb6a8d1b2cd802f5d698e711471eeec6436202d64d463d82af745826",
  "d7b62a52dbdc751f89829f6663cbbdb7c775d05f9aa0b6364b707aaa531573fe",
].sort();
const balanceOrder = ["sourceNativeWei", "successorNativeWei", "sourceTokenWei", "successorTokenWei", "sourceSoldWei",
  "sourceBackingWei", "tokenTotalSupplyWei", "holderTokenWei", "ledgerNativeWei", "ledgerTokenWei",
  "totalAccruedWei", "totalClaimedWei", "factoryNativeWei", "creationFeesAccruedWei"];
const recipientOrder = ["creator", "treasury", "operations", "reserve"];

export function validateSourceBindings({register = readJson("docs/evidence/rmt-task089/security/stage-dispositions.json"),
  read = path => readFileSync(resolve(repo, "packages/contracts", path), "utf8").replaceAll("\r\n", "\n")} = {}) {
  const findings = register.findings.filter(row => row.group === "asset-bearing-migration");
  assert.deepEqual(findings.map(row => row.id).sort(), ids, "Exact six migration observations required");
  for (const row of findings) {
    assert.equal(row.check, "reentrancy-balance");
    assert.equal(row.affectedFunction, "migrateAssets");
    assert.equal(row.rawSeverity, "High");
    assert.equal(row.disposition, "UNRESOLVED", "This evidence does not amend the retained raw register");
    for (const pin of row.sourcePins) assert.equal(sha(read(pin.path)), pin.originalContentDigest.hex);
  }
  const sources = profile.originalSourceSha256.map(([path, digest]) => {
    assert.equal(sha(read(path)), digest, "Production first-party source changed: " + path);
    return {relativePath: "packages/contracts/" + path, contentDigest: {algorithm: "SHA-256", normalization: "LF", hex: digest}};
  });
  const dependencies = profile.sourceSha256.filter(([path]) => path.startsWith("lib/")).map(([path, digest]) => {
    assert.equal(sha(read(path)), digest, "Pinned dependency changed: " + path);
    return {relativePath: "packages/contracts/" + path, contentDigest: {algorithm: "SHA-256", normalization: "LF", hex: digest}};
  });
  assert.equal(dependencies.length, 50);
  return {findingIds: ids, sources, dependencies, productionCompilerInputSha256: profile.inputSha256,
    strictScannerGateChanged: false, financialActivationAuthorized: false};
}

export function validateCompilation(compilation) {
  assert.equal(compilation.manifest.chainId, 4663);
  assert.equal(compilation.manifest.status, "BLOCKED_NO_BROADCAST");
  assert.equal(compilation.manifest.broadcastAuthorized, false);
  assert.equal(compilation.manifest.inputSha256, profile.inputSha256);
  for (const field of ["compilerVersion", "compilerSettings", "terms", "sourceSha256", "originalSourceSha256", "templates"])
    assert.deepEqual(compilation.manifest[field], profile[field], "Canonical compilation mismatch " + field);
  assert.equal(Object.keys(compilation.artifacts).length, 16);
  assert.ok(compilation.immutableNames instanceof Map && compilation.immutableNames.size > 0);
  for (const [contract, artifact] of Object.entries(compilation.artifacts)) {
    const template = profile.templates[contract];
    assert.equal(sha(hexBytes(artifact.bytecode)), template.creationSha256, "Creation bytecode drift " + contract);
    assert.equal(sha(hexBytes(artifact.runtime)), template.runtimeSha256, "Runtime bytecode drift " + contract);
  }
  return true;
}

export function validateFixtureProfile(fixture) {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.scope, "EXACT_4663_CANONICAL_BYTECODE_IN_ISOLATED_VM_SYNTHETIC_CONSTRUCTORS_NO_LIVE_EXECUTION");
  assert.equal(fixture.manifest.chainId, 4663);
  assert.equal(fixture.manifest.status, "BLOCKED_NO_BROADCAST");
  assert.equal(fixture.manifest.broadcastAuthorized, false);
  for (const field of ["inputSha256", "compilerVersion", "compilerSettings", "terms", "sourceSha256", "originalSourceSha256", "templates"])
    assert.deepEqual(fixture.manifest[field], profile[field], "Fixture profile changed " + field);
  assert.deepEqual(Object.keys(fixture.creationCode).sort(), fixtureContracts.toSorted());
  for (const contract of fixtureContracts) {
    assert.match(fixture.creationCode[contract], /^0x(?:[0-9a-f]{2})+$/);
    assert.equal(sha(hexBytes(fixture.creationCode[contract])), profile.templates[contract].creationSha256, "Canonical creation code changed " + contract);
  }
  assert.deepEqual(Object.keys(fixture.runtimeCode), ["RMTLaunchCurveTokenV2"]);
  assert.equal(sha(hexBytes(fixture.runtimeCode.RMTLaunchCurveTokenV2)), profile.templates.RMTLaunchCurveTokenV2.runtimeSha256);
  return true;
}

export function canonicalFixture(compilation) {
  validateCompilation(compilation);
  return {schemaVersion: 1, scope: "EXACT_4663_CANONICAL_BYTECODE_IN_ISOLATED_VM_SYNTHETIC_CONSTRUCTORS_NO_LIVE_EXECUTION",
    manifest: compilation.manifest,
    creationCode: Object.fromEntries(fixtureContracts.map(contract => [contract, compilation.artifacts[contract].bytecode])),
    runtimeCode: {RMTLaunchCurveTokenV2: compilation.artifacts.RMTLaunchCurveTokenV2.runtime}};
}

export function validateFixture(fixture, compilation) {
  validateFixtureProfile(fixture);
  assert.deepEqual(fixture, canonicalFixture(compilation), "Local migration bytecodes differ from canonical compilation");
  return true;
}

export function materializeMigrationBindings(compilation) {
  validateCompilation(compilation);
  const engine = protocol.bootstrapChildren.find(row => row.contract === "RMTV4CurveGraduationV1").address;
  const operating = owner.safes.find(row => row.role === "RMT-OPERATIONS").safe;
  const reserve = owner.safes.find(row => row.role === "RMT-RESERVE").safe;
  const factoryArgs = [engine, operating, reserve, pins.registry.address, pins.successorV2.address,
    pins.successorV2.runtimeHash, BigInt(profile.terms.creationFeeWei)];
  const definitions = {
    directory: {args: [originalSigners.signerA, originalSigners.signerB, originalSigners.signerC],
      immutables: eip712("RMT Launch Curve Directory", "2", pins.directory.address)},
    registry: {args: [pins.directory.address], immutables: {
      ...eip712("RMT Launch Project Registry", "4", pins.registry.address), directory: pins.directory.address}},
    factory: {args: factoryArgs, immutables: {graduationEngine: engine, operatingRecipient: operating,
      futureReserveRecipient: reserve, projectRegistry: pins.registry.address, successorDeployer: pins.successorV2.address,
      successorDeployerRuntimeHash: pins.successorV2.runtimeHash, creationFeeWei: toHex(BigInt(profile.terms.creationFeeWei))}},
    successorV2: {args: [], immutables: {}}, successorV3: {args: [], immutables: {}},
  };
  return Object.fromEntries(Object.entries(pins).map(([role, pin]) => {
    const definition = definitions[role];
    const result = materializeArtifact(compilation, pin.contract, pin.address, definition.args, definition.immutables);
    assert.equal(result.runtimeHash, pin.runtimeHash, "Materialized deployed migration runtime mismatch " + role);
    assert.equal(result.runtimeBytes, pin.byteLength);
    const constructor = protocol.constructors.find(row => row.contract === pin.contract);
    if (constructor) assert.equal(result.initcodeHash, constructor.initcodeHash, "Historical constructor identity mismatch " + role);
    return [role, {...result, immutableInputs: definition.immutables}];
  }));
}

export function validateRuntimeObservation(report) {
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.scope, "READ_ONLY_MIGRATION_RUNTIME_CORRESPONDENCE_NOT_STAGE_CLEARANCE");
  assert.equal(report.chainId, 4663);
  assert.match(report.anchor.number, /^0x[1-9a-f][0-9a-f]*$/);
  assert.match(report.anchor.hash, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(report.witnesses).sort(), Object.keys(providers).sort());
  const expectedCalls = [];
  for (const provider of Object.keys(providers)) expectedCalls.push({provider, method: "eth_chainId", params: []},
    {provider, method: "eth_getBlockByNumber", params: ["latest", false]});
  for (const provider of Object.keys(providers)) {
    const witness = report.witnesses[provider];
    assert.equal(witness.chainId, "0x1237");
    assert.equal(witness.blockHash, report.anchor.hash);
    assert.equal(witness.recheckedBlockHash, report.anchor.hash);
    assert.deepEqual(Object.keys(witness.contracts).sort(), Object.keys(roles).sort());
    expectedCalls.push({provider, method: "eth_getBlockByNumber", params: [report.anchor.number, false]});
    for (const [role, pin] of Object.entries(pins)) {
      const row = witness.contracts[role];
      assert.equal(row.address.toLowerCase(), pin.address.toLowerCase());
      assert.match(row.code, /^0x(?:[0-9a-f]{2})+$/);
      assert.equal(keccak256(row.code), pin.runtimeHash, "Observed runtime mismatch " + role);
      assert.equal(row.runtimeHash, pin.runtimeHash);
      assert.equal(row.byteLength, pin.byteLength);
      assert.equal((row.code.length - 2) / 2, pin.byteLength);
      assert.deepEqual(row, report.witnesses.official.contracts[role]);
      expectedCalls.push({provider, method: "eth_getCode", params: [pin.address, report.anchor.number]});
    }
    expectedCalls.push({provider, method: "eth_getBlockByNumber", params: [report.anchor.number, false]});
  }
  assert.deepEqual(report.rpcCalls, expectedCalls, "Unexpected live RPC scope");
  for (const flag of ["signing", "transactionPreparation", "transactions", "liveVulnerabilityTesting"]) assert.equal(report[flag], false);
  return true;
}

export function verifyConservationVector(report) {
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.scope, "CONCRETE_CANONICAL_4663_MIGRATION_AND_ORIGINAL_EARNED_CLAIMS");
  assert.equal(report.chainId, 4663);
  assert.equal(report.compilerInputSha256, profile.inputSha256);
  assert.deepEqual(report.balanceOrder, balanceOrder);
  assert.deepEqual(report.recipientOrder, recipientOrder);
  assert.deepEqual(report.phases.map(row => row.phase), ["before", "after", "after-claims"]);
  for (const row of report.phases) {
    assert.equal(row.chainId, 4663);
    assert.equal(row.canonicalBytecodes, true);
    assert.equal(row.graduationBackingWei, "2000000000000000000");
    for (const [key, length] of [["balances", 14], ["bucketAccrued", 4], ["claimable", 4], ["beneficiaryNative", 4]]) {
      assert.equal(row[key].length, length);
      for (const value of row[key]) assert.match(String(value), /^(0|[1-9][0-9]*)$/);
    }
  }
  const [before, after, claimed] = report.phases.map(row => Object.fromEntries(Object.entries(row)
    .map(([key, value]) => [key, Array.isArray(value) ? value.map(BigInt) : value])));
  const b = before.balances, a = after.balances, c = claimed.balances;
  const inventory = b[6] - b[4], backing = b[5];
  assert.ok(inventory > 0n && backing > 0n);
  assert.equal(b[6], 1_000_000_000n * 10n ** 18n);
  assert.equal(a[0], b[0] - backing);
  assert.equal(a[1], b[1] + backing);
  assert.equal(a[2], b[2] - inventory);
  assert.equal(a[3], b[3] + inventory);
  assert.equal(a[5], 0n);
  for (const index of [4, 6, 7, 8, 9, 10, 11, 12, 13]) assert.equal(a[index], b[index]);
  for (const key of ["bucketAccrued", "claimable", "beneficiaryNative"]) assert.deepEqual(after[key], before[key]);
  const sum = array => array.reduce((a, b) => a + b, 0n);
  assert.equal(sum(before.claimable), b[8]);
  assert.equal(b[10] - b[11], b[8]);
  assert.ok(b[11] > 0n, "Already claimed earnings must be represented");
  assert.ok(before.claimable.some(value => value > 0n), "Unclaimed rights must be represented");
  for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 12, 13]) assert.equal(c[index], a[index]);
  assert.equal(c[8], 0n);
  assert.equal(c[11], c[10]);
  assert.deepEqual(claimed.bucketAccrued, after.bucketAccrued);
  for (let i = 0; i < 4; ++i) {
    assert.equal(claimed.claimable[i], 0n);
    assert.equal(claimed.beneficiaryNative[i], after.beneficiaryNative[i] + after.claimable[i]);
  }
  return true;
}

export function extractConservationVector(log) {
  const phases = [...log.matchAll(/TASK090_MIGRATION_VECTOR: (\{[^\r\n]+\})/g)].map(match =>
    // Solidity's JSON writer emits some uint64 values as unquoted numbers. Quote them before JS parsing.
    JSON.parse(match[1].replace(/([\[,])(\d+)(?=[,\]])/g, '$1"$2"')));
  const report = {schemaVersion: 1, scope: "CONCRETE_CANONICAL_4663_MIGRATION_AND_ORIGINAL_EARNED_CLAIMS",
    chainId: 4663, compilerInputSha256: profile.inputSha256,
    balanceOrder, recipientOrder, phases};
  verifyConservationVector(report);
  return report;
}

export async function observeMigrationRuntimes(fetcher = fetch) {
  let sequence = 0;
  const rpcCalls = [];
  async function rpc(provider, method, params) {
    assert.ok(["eth_chainId", "eth_getBlockByNumber", "eth_getCode"].includes(method));
    if (method === "eth_chainId") assert.deepEqual(params, []);
    else if (method === "eth_getBlockByNumber") assert.ok(params.length === 2 && params[1] === false && /^(latest|0x[0-9a-f]+)$/.test(params[0]));
    else assert.ok(params.length === 2 && Object.values(pins).some(pin => pin.address === params[0]) && /^0x[0-9a-f]+$/.test(params[1]));
    rpcCalls.push({provider, method, params});
    const response = await fetcher(providers[provider], {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({jsonrpc: "2.0", id: ++sequence, method, params}), redirect: "error", signal: AbortSignal.timeout(20_000)});
    assert.equal(response.status, 200, provider + " HTTP " + response.status);
    const body = await response.json();
    assert.equal(body.error, undefined, JSON.stringify(body.error));
    assert.ok(body.result !== undefined);
    return body.result;
  }
  const heads = {}, witnesses = {};
  for (const provider of Object.keys(providers)) {
    const chainId = await rpc(provider, "eth_chainId", []);
    assert.equal(chainId, "0x1237");
    heads[provider] = await rpc(provider, "eth_getBlockByNumber", ["latest", false]);
    witnesses[provider] = {chainId, contracts: {}};
  }
  const height = Object.values(heads).map(row => BigInt(row.number)).reduce((a, b) => a < b ? a : b);
  const tag = "0x" + height.toString(16);
  let anchor;
  for (const provider of Object.keys(providers)) {
    const block = await rpc(provider, "eth_getBlockByNumber", [tag, false]);
    assert.equal(block.number, tag);
    anchor ??= {number: tag, hash: block.hash, timestamp: block.timestamp};
    assert.equal(block.hash, anchor.hash, "Canonical block disagreement");
    witnesses[provider].blockHash = block.hash;
    for (const [role, pin] of Object.entries(pins)) {
      const code = await rpc(provider, "eth_getCode", [pin.address, tag]);
      witnesses[provider].contracts[role] = {address: pin.address, code, runtimeHash: keccak256(code), byteLength: (code.length - 2) / 2};
    }
    witnesses[provider].recheckedBlockHash = (await rpc(provider, "eth_getBlockByNumber", [tag, false])).hash;
  }
  const report = {schemaVersion: 1, scope: "READ_ONLY_MIGRATION_RUNTIME_CORRESPONDENCE_NOT_STAGE_CLEARANCE",
    observedAt: new Date().toISOString(), chainId: 4663, anchor, witnesses, rpcCalls,
    signing: false, transactionPreparation: false, transactions: false, liveVulnerabilityTesting: false};
  validateRuntimeObservation(report);
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {
    solc: {type: "string"}, compilation: {type: "string"}, fixture: {type: "string"},
    observation: {type: "string"}, output: {type: "string"}, log: {type: "string"}, "solc-cache": {type: "string"},
  }});
  const [command] = positionals;
  const sources = validateSourceBindings();
  if (command === "vector") {
    assert.ok(values.log && values.output);
    const vector = extractConservationVector(readFileSync(values.log, "utf8"));
    writeFileSync(values.output, JSON.stringify(vector, null, 2) + "\n", {flag: "wx"});
    console.log(JSON.stringify({result: "PASS", phases: vector.phases.length}));
  } else if (command === "observe") {
    assert.ok(values.output);
    const observation = await observeMigrationRuntimes();
    writeFileSync(values.output, JSON.stringify(observation, null, 2) + "\n", {flag: "wx"});
    console.log(JSON.stringify({result: "PASS", anchor: observation.anchor, calls: observation.rpcCalls.length}));
  } else if (command === "compile") {
    assert.ok(values.solc && values.output && values.fixture);
    const compilation = compileFixedSupplyProfile({solc: values.solc, chainId: 4663, includeImmutableNames: true, solcCache: values["solc-cache"]});
    validateCompilation(compilation);
    writeFileSync(values.output, JSON.stringify({...compilation, immutableNames: [...compilation.immutableNames]}) + "\n", {flag: "wx"});
    writeFileSync(values.fixture, JSON.stringify(canonicalFixture(compilation), null, 2) + "\n", {flag: "wx"});
    console.log(JSON.stringify({result: "PASS", inputSha256: compilation.manifest.inputSha256}));
  } else {
    assert.equal(command, "verify", "Use compile, observe, vector, or verify; no transaction method exists");
    assert.ok(values.compilation && values.fixture && values.observation && values.output);
    const compilation = readJson(values.compilation);
    compilation.immutableNames = new Map(compilation.immutableNames);
    validateFixture(readJson(values.fixture), compilation);
    const runtime = materializeMigrationBindings(compilation);
    const observation = readJson(values.observation);
    validateRuntimeObservation(observation);
    const result = {schemaVersion: 1, scope: "CANONICAL_4663_SOURCE_COMPILER_FIXTURE_AND_OBSERVED_RUNTIME_BINDING",
      sources, inputSha256: compilation.manifest.inputSha256,
      auxiliaryCompilerInputSha256: compilation.auxiliaryCompilerInputSha256, runtime, anchor: observation.anchor,
      strictSecurityGate: "UNCHANGED_FAIL_HIGH", signing: false, broadcast: false};
    writeFileSync(values.output, JSON.stringify(result, null, 2) + "\n", {flag: "wx"});
    console.log(JSON.stringify({result: "PASS", inputSha256: compilation.manifest.inputSha256, roles: Object.keys(runtime), anchor: observation.anchor}));
  }
}
