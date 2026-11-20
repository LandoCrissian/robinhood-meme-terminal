import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {fileURLToPath, pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {materializeArtifact} from "../../packages/contracts/scripts/verify-fixed-supply-bundle.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const {keccak256} = require("viem");
const json = path => JSON.parse(readFileSync(resolve(repo, path), "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const normalized = path => readFileSync(resolve(repo, path), "utf8").replaceAll("\r\n", "\n");
const profile = json("docs/evidence/fixed-supply-security/4663-profile.json");
const providers = Object.freeze({official: "https://rpc.mainnet.chain.robinhood.com", pocket: "https://robinhood.api.pocket.network"});
const deployed = json("docs/evidence/mobile-signing/protocol-mainnet.json");
const pins = {...profile.externalRuntimePins};
for (const [role, contract] of Object.entries({initializationGuard: "RMTV4CurveInitializationGuardV1", graduationEngine: "RMTV4CurveGraduationV1", factory: "RMTLaunchCurveFactoryV2"})) {
  const row = deployed.bootstrapChildren.find(value => value.contract === contract);
  assert.ok(row, "Missing retained deployed pin " + role);
  pins[role] = {address: row.address, runtimeHash: row.runtimeHash};
}
const roles = ["poolManager", "positionManager", "permit2", "initializationGuard", "graduationEngine", "factory"];
const graduationIds = [
  "090ec24d83d9e6ad807b554f60ae3f0da246d90f832ea7c7554ac361e893feed",
  "096666f0be36ac0ff3aa789012f4f2a57e4f492e550c7d29355adb415b4b4e32",
  "1dd97f6a638a2d49ef2776e94dbe4ca63a74e016c58d0412fd656f51548a6ab0",
  "1e179df9a2b61d35bf108283a1433bf4e2e9a218fc9a7c8403a8ad369cd94608",
  "6e56005d266c4a8c0585c6256c43259ac2a3067695b32500be2c856d986bc5db",
  "aed981db86d8898210985ae2ef6677507e125e0801d50fae7531dde65e6af4c8",
  "cbb7601e1d47b36023a61dc771411d08d802e547da425ee330f9a610486257a0",
  "f02be6651ef27afaa0ea6c8c69a5b596575818c75d397e27b9bae568443a3aea",
  "c161ac1c6b54242b7449fb6df62dcb4eacf5b0f9857b6896a08be1410c2fdc0c",
  "fae53a948b4211e780cefaa3873d9c7a251e243cbb72473bbd48df23c9a5cbf3",
  "fe593a6c4b173403178cbf5681aacc3f3e9bc93b4b777c573c982f6db0a8108c",
].sort();

export function validateSourceBindings({read = normalized, register = json("docs/evidence/rmt-task089/security/stage-dispositions.json")} = {}) {
  const findings = register.findings.filter(row => ["position-funding", "curve-graduation"].includes(row.group));
  assert.equal(findings.length, 11, "Exact graduation cluster required");
  assert.equal(new Set(findings.map(row => row.id)).size, 11, "Duplicate finding");
  assert.deepEqual(findings.map(row => row.id).sort(), graduationIds, "Graduation finding identities changed");
  assert.equal(findings.filter(row => row.group === "position-funding").length, 8);
  assert.equal(findings.filter(row => row.group === "curve-graduation").length, 3);
  const original = new Map(profile.originalSourceSha256);
  const paths = ["src/RMTLaunchBondingCurveV1.sol", "src/RMTV4CurveGraduationV1.sol", "src/RMTV4CurveInitializationGuardV1.sol", "src/RMTLaunchCurveTokenV2.sol"];
  const sources = paths.map(path => {
    const actual = sha(read("packages/contracts/" + path));
    assert.equal(actual, original.get(path), "First-party source changed: " + path);
    return {path: "packages/contracts/" + path, normalizedSha256: actual};
  });
  return {findingIds: findings.map(row => row.id).sort(), sources, productionCompilerInputSha256: profile.inputSha256,
    rawHighCount: register.strictRawHighCount, strictGateUnchanged: true, financialActivationAuthorized: false};
}

export function validateLocalPermit2Binding(report, testSource = normalized("packages/contracts/test/Task090GraduationProof.t.sol")) {
  validateRuntimeObservation(report);
  const matches = [...testSource.matchAll(/function _permit2Runtime\(\) private pure returns \(bytes memory\) \{\s*return hex"([0-9a-f]+)";/g)];
  assert.equal(matches.length, 1, "Exactly one embedded genuine Permit2 runtime required");
  assert.equal("0x" + matches[0][1], report.witnesses.official.contracts.permit2.code, "Local Permit2 differs from observed runtime");
  return {role: "permit2", byteLength: matches[0][1].length / 2, runtimeHash: keccak256("0x" + matches[0][1]),
    scope: "EXACT_OBSERVED_RUNTIME_IN_ISOLATED_VM_NO_SIGNATURE_OR_LIVE_CALL"};
}

export function verifyConservation(row) {
  const {nativeBefore, nativeAfter, tokenBefore, tokenAfter} = row;
  for (const array of [nativeBefore, nativeAfter, tokenBefore, tokenAfter]) {
    assert.ok(Array.isArray(array) && array.length === 8, "Exact eight-account state required");
    for (const value of array) assert.match(String(value), /^(0|[1-9][0-9]*)$/);
  }
  const native = BigInt(row.nativeUsed), token = BigInt(row.tokenUsed);
  assert.ok(native > 0n && token > 0n && BigInt(row.liquidity) > 0n && BigInt(row.positionId) > 0n);
  for (let i = 0; i < 8; i++) {
    const multiplier = i === 0 ? -1n : i === 2 ? 1n : 0n;
    assert.equal(BigInt(nativeAfter[i]) - BigInt(nativeBefore[i]), multiplier * native, "Native recipient/debit mismatch at " + i);
    assert.equal(BigInt(tokenAfter[i]) - BigInt(tokenBefore[i]), multiplier * token, "Token recipient/debit mismatch at " + i);
  }
  return true;
}

export function readRecordedProof(text) {
  assert.match(text, /\[PASS\] testExactRealPermit2GraphConservesPrefundingAndOriginalPosition\(\)/);
  assert.match(text, /1 tests passed, 0 failed, 0 skipped/);
  assert.doesNotMatch(text, /\[FAIL/);
  const cleaned = text.replace(/ \[[0-9]+(?:\.[0-9]+)?e[0-9]+\]/g, "");
  const lines = cleaned.split(/\r?\n/);
  const conservation = lines.filter(line => line.includes("emit Conservation("));
  assert.equal(conservation.length, 1, "Exactly one recorded conservation event required");
  const line = conservation[0];
  const row = {};
  for (const name of ["nativeBefore", "nativeAfter", "tokenBefore", "tokenAfter"]) {
    const matched = line.match(new RegExp(name + ": \\[([^\\]]*)\\]"));
    assert.ok(matched, "Missing exact " + name);
    row[name] = matched[1].split(",").map(value => value.trim());
  }
  for (const name of ["nativeUsed", "tokenUsed", "nativeDust", "tokenDust", "positionId", "liquidity"]) {
    const matched = line.match(new RegExp(name + ": ([0-9]+)"));
    assert.ok(matched, "Missing " + name); row[name] = matched[1];
  }
  row.token = line.match(/token: .*?(0x[0-9a-f]{40})/i)?.[1];
  row.curve = line.match(/curve: .*?(0x[0-9a-f]{40})/i)?.[1];
  assert.ok(row.token && row.curve);
  verifyConservation(row);
  const edges = lines.filter(value => value.includes("emit ExactCallbackEdge(")).map(value => {
    const match = value.match(/index: ([0-9]+), caller: .*?(0x[0-9a-f]{40}).*?, target: .*?(0x[0-9a-f]{40}).*?, calldataHash: (0x[0-9a-f]{64}), value: ([0-9]+), depth: ([0-9]+)/i);
    assert.ok(match, "Malformed recorded callback edge");
    return {index: Number(match[1]), caller: match[2], target: match[3], calldataHash: match[4], value: match[5], depth: Number(match[6])};
  });
  assert.equal(edges.length, BigInt(row.nativeDust) > 0n ? 21 : 20);
  edges.forEach((edge, index) => assert.equal(edge.index, index, "Mutable graph order changed"));
  return {scope: "RECORDED_LOCAL_CANONICAL_4663_TEST_WITH_EXACT_GRAPH_ASSERTIONS", balances: row, edges,
    fullCalldataCallerTargetValueDepthAssertedBy: "Task090GraduationProofTest._assertGraph",
    liveProductionStorage: false, financialActivationAuthorized: false};
}

/** Pure compiler-output correspondence; it does not prepare or simulate a transaction. */
export function verifyCanonicalLiveRuntimes(serializedCompilation, report) {
  validateRuntimeObservation(report);
  const compilation = {...serializedCompilation, immutableNames: new Map(serializedCompilation.immutableNames)};
  assert.equal(compilation.manifest.chainId, 4663);
  assert.equal(compilation.manifest.compilerVersion, profile.compilerVersion);
  assert.equal(compilation.manifest.inputSha256, profile.inputSha256);
  assert.deepEqual(compilation.manifest.compilerSettings, profile.compilerSettings);
  assert.deepEqual(compilation.manifest.sourceSha256, profile.sourceSha256);
  assert.deepEqual(compilation.manifest.originalSourceSha256, profile.originalSourceSha256);
  const engine = pins.graduationEngine.address, factory = pins.factory.address, guard = pins.initializationGuard.address;
  const dependencies = {poolManager: pins.poolManager.address, positionManager: pins.positionManager.address, permit2: pins.permit2.address,
    poolManagerHash: pins.poolManager.runtimeHash, positionManagerHash: pins.positionManager.runtimeHash, permit2Hash: pins.permit2.runtimeHash};
  const registry = deployed.constructors.find(row => row.id === "registry" || row.contract === "RMTLaunchProjectRegistryV3");
  const successor = deployed.constructors.find(row => row.id === "successor-v2" || row.contract === "RMTLaunchCurveSuccessorDeployerV1");
  assert.ok(registry && successor, "Missing retained constructor bindings");
  const operating = "0xAF9F10258b091719618c19D057F9cDAB72eFFd8b", reserve = "0x8D44078642ce938Fd799b23087BcdD6114A302e5";
  const guardPlan = materializeArtifact(compilation, "RMTV4CurveInitializationGuardV1", guard,
    [dependencies.poolManager, engine], {poolManager: dependencies.poolManager, graduationEngine: engine});
  const enginePlan = materializeArtifact(compilation, "RMTV4CurveGraduationV1", engine, [dependencies, factory, guard], {
    factory, poolManager: dependencies.poolManager, positionManager: dependencies.positionManager, permit2: dependencies.permit2,
    initializationGuard: guard, poolManagerRuntimeHash: dependencies.poolManagerHash,
    positionManagerRuntimeHash: dependencies.positionManagerHash, permit2RuntimeHash: dependencies.permit2Hash,
    initializationGuardRuntimeHash: guardPlan.runtimeHash});
  const registryAddress = registry.address ?? registry.predictedAddress;
  const successorAddress = successor.address ?? successor.predictedAddress;
  const factoryPlan = materializeArtifact(compilation, "RMTLaunchCurveFactoryV2", factory,
    [engine, operating, reserve, registryAddress, successorAddress, successor.runtimeHash, 400_000_000_000_000n],
    {graduationEngine: engine, operatingRecipient: operating, futureReserveRecipient: reserve, projectRegistry: registryAddress,
      successorDeployer: successorAddress, successorDeployerRuntimeHash: successor.runtimeHash, creationFeeWei: "0x16bcc41e90000"});
  const plans = {initializationGuard: guardPlan, graduationEngine: enginePlan, factory: factoryPlan};
  for (const [role, row] of Object.entries(plans)) {
    assert.equal(row.runtimeHash, pins[role].runtimeHash, "Materialized canonical runtime changed: " + role);
    for (const name of Object.keys(providers)) assert.equal(row.runtimeHash, report.witnesses[name].contracts[role].runtimeHash);
  }
  return {scope: "CANONICAL_4663_COMPILER_OUTPUT_AND_DEPLOYED_IMMUTABLE_RUNTIME_CORRESPONDENCE_ONLY",
    compilerInputSha256: compilation.manifest.inputSha256, compilerVersion: compilation.manifest.compilerVersion,
    compilerExecutableSha256: compilation.manifest.executableSha256, auxiliaryCompilerInputSha256: compilation.auxiliaryCompilerInputSha256,
    runtimeBindings: Object.values(plans).map(({contract, address, runtimeHash, runtimeBytes}) => ({contract, address, runtimeHash, runtimeBytes})),
    runtimeAnchor: report.anchor, productionExecutionTested: false, financialActivationAuthorized: false};
}

export function validateRuntimeObservation(report) {
  assert.equal(report.chainId, 4663);
  assert.match(report.anchor.number, /^0x[1-9a-f][0-9a-f]*$/);
  assert.match(report.anchor.hash, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(report.witnesses).sort(), ["official", "pocket"]);
  for (const name of Object.keys(providers)) {
    const witness = report.witnesses[name];
    assert.equal(witness.chainId, "0x1237");
    assert.equal(witness.blockHash, report.anchor.hash);
    assert.equal(witness.recheckedBlockHash, report.anchor.hash);
    assert.deepEqual(Object.keys(witness.contracts).sort(), roles.toSorted());
    for (const role of roles) {
      const row = witness.contracts[role], pin = pins[role];
      assert.equal(row.address.toLowerCase(), pin.address.toLowerCase());
      assert.equal(row.runtimeHash, pin.runtimeHash);
      assert.match(row.code, /^0x(?:[0-9a-f]{2})+$/);
      assert.equal(keccak256(row.code), pin.runtimeHash, "Runtime bytes mismatch: " + role);
      assert.equal(row.byteLength, (row.code.length - 2) / 2);
      assert.deepEqual(row, report.witnesses.official.contracts[role]);
    }
  }
  return true;
}

export async function observeGraduationRuntimes(fetcher = fetch) {
  let sequence = 0;
  const calls = [];
  async function rpc(name, method, params) {
    assert.ok(["eth_chainId", "eth_getBlockByNumber", "eth_getCode"].includes(method), "Read-only method required");
    if (method === "eth_chainId") assert.deepEqual(params, []);
    else if (method === "eth_getBlockByNumber") assert.ok(params.length === 2 && params[1] === false && /^(latest|0x[0-9a-f]+)$/.test(params[0]));
    else assert.ok(params.length === 2 && roles.some(role => pins[role].address.toLowerCase() === params[0].toLowerCase()) && /^0x[0-9a-f]+$/.test(params[1]));
    calls.push({provider: name, method, params});
    const response = await fetcher(providers[name], {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({jsonrpc: "2.0", id: ++sequence, method, params}), redirect: "error", signal: AbortSignal.timeout(20_000)});
    assert.equal(response.status, 200, name + " HTTP " + response.status);
    const body = await response.json();
    assert.equal(body.error, undefined, name + " RPC error: " + JSON.stringify(body.error));
    assert.ok(body.result !== undefined, name + " missing RPC result");
    return body.result;
  }
  const heads = {};
  const witnesses = {};
  for (const name of Object.keys(providers)) {
    const chainId = await rpc(name, "eth_chainId", []);
    assert.equal(chainId, "0x1237");
    heads[name] = await rpc(name, "eth_getBlockByNumber", ["latest", false]);
    witnesses[name] = {chainId, contracts: {}};
  }
  const height = Object.values(heads).map(row => BigInt(row.number)).reduce((a, b) => a < b ? a : b);
  const tag = "0x" + height.toString(16);
  let anchor;
  for (const name of Object.keys(providers)) {
    const block = await rpc(name, "eth_getBlockByNumber", [tag, false]);
    assert.equal(block.number, tag);
    anchor ??= {number: tag, hash: block.hash, timestamp: block.timestamp};
    assert.equal(block.hash, anchor.hash, "Canonical block disagreement");
    witnesses[name].blockHash = block.hash;
    for (const role of roles) {
      const pin = pins[role];
      const code = await rpc(name, "eth_getCode", [pin.address, tag]);
      witnesses[name].contracts[role] = {address: pin.address, code, runtimeHash: keccak256(code), byteLength: (code.length - 2) / 2};
    }
    witnesses[name].recheckedBlockHash = (await rpc(name, "eth_getBlockByNumber", [tag, false])).hash;
  }
  const report = {schemaVersion: 1, scope: "READ_ONLY_RUNTIME_CORRESPONDENCE_NOT_BEHAVIORAL_CLEARANCE", observedAt: new Date().toISOString(),
    chainId: 4663, anchor, witnesses, rpcCalls: calls, signing: false, transactionPreparation: false, transactions: false, liveVulnerabilityTesting: false};
  validateRuntimeObservation(report);
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv[2] === "--read-recorded-proof") {
    assert.ok(process.argv[3] && process.argv[4]);
    const result = readRecordedProof(readFileSync(resolve(process.argv[3]), "utf8"));
    writeFileSync(resolve(process.argv[4]), JSON.stringify(result, null, 2) + "\n", {flag: "wx"});
    console.log(JSON.stringify({result: "PASS", mutableFrames: result.edges.length, balances: result.balances}));
    process.exit(0);
  }
  if (process.argv[2] === "--verify-canonical") {
    assert.ok(process.argv[3] && process.argv[4] && process.argv[5], "Use --verify-canonical <compilation-json> <observation-json> <new-output-json>");
    validateSourceBindings();
    const result = verifyCanonicalLiveRuntimes(JSON.parse(readFileSync(resolve(process.argv[3]), "utf8")), JSON.parse(readFileSync(resolve(process.argv[4]), "utf8")));
    writeFileSync(resolve(process.argv[5]), JSON.stringify(result, null, 2) + "\n", {flag: "wx"});
    console.log(JSON.stringify(result));
    process.exit(0);
  }
  assert.equal(process.argv[2], "--observe-runtimes", "Use --observe-runtimes <new-output-json>; no transaction method exists");
  assert.ok(process.argv[3]);
  validateSourceBindings();
  const report = await observeGraduationRuntimes();
  writeFileSync(resolve(process.argv[3]), JSON.stringify(report, null, 2) + "\n", {flag: "wx"});
  console.log(JSON.stringify({result: "PASS", anchor: report.anchor, runtimeRoles: roles, rpcCalls: report.rpcCalls.length, output: process.argv[3]}));
}
