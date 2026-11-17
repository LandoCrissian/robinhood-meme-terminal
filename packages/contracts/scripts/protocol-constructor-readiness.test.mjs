import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { MOBILE_DEPLOYMENT_PAYER } from "../../../scripts/production-readiness/mobile-sender.mjs";
import { pinnedSafeCreationRows } from "./mobile-review-plan.mjs";
import { approvedRmtTerms } from "./prepare-unsigned-4663.mjs";
import { observeProtocolBindings, probeProtocolConstructor, protocolStageCandidate, validatePredecessorProofs } from "./protocol-constructor-readiness.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { encodeAbiParameters, encodeFunctionResult, decodeFunctionData, getContractAddress, getCreate2Address,
  keccak256, parseAbi, padHex, stringToHex, toHex, zeroHash } = require("viem");
const load = (name) => JSON.parse(readFileSync(new URL("../../../docs/evidence/" + name, import.meta.url)));
const gz = (name) => JSON.parse(gunzipSync(readFileSync(new URL("../../../docs/evidence/" + name, import.meta.url))));
const profile = load("fixed-supply-security/4663-profile.json");
const policy = load("rmt-task045/operations-safe-policy.json").operations;
const fork = gz("fixed-supply-release/fork-4663.json.gz");
const safeRuntime = gz("mobile-signing/safe-runtime-4663.json.gz").proxyRuntimeCode;
const ids = ["directory", "registry", "successor-v2", "successor-v3", "bootstrap"];
const contracts = ["RMTLaunchCurveDirectoryV2", "RMTLaunchProjectRegistryV3", "RMTLaunchCurveSuccessorDeployerV1", "RMTLaunchCurveSuccessorDeployerV2", "RMTLaunchCurveDeploymentV2"];
const typed = (...types) => types.map((type) => ({ type }));
const dependenciesType = { type: "tuple", components: typed("address", "address", "address", "bytes32", "bytes32", "bytes32") };
const sha = (data) => createHash("sha256").update(data).digest("hex");
const creationCode = Object.fromEntries(contracts.map((contract, index) => [contract,
  fork.unsignedConstructors[index].data.slice(0, 2 + profile.templates[contract].creationBytes * 2)]));

// Recover only public frozen creation-code templates embedded in the retained
// bootstrap fixture. No private packet, current provider or production key is used.
const bootstrap = Buffer.from(creationCode.RMTLaunchCurveDeploymentV2.slice(2), "hex");
for (const contract of ["RMTV4CurveInitializationGuardV1", "RMTV4CurveGraduationV1", "RMTLaunchCurveFactoryV2"]) {
  const template = profile.templates[contract];
  for (let offset = 0; offset <= bootstrap.length - template.creationBytes; offset++) {
    const candidate = bootstrap.subarray(offset, offset + template.creationBytes);
    if (sha(candidate) === template.creationSha256) { creationCode[contract] = "0x" + candidate.toString("hex"); break; }
  }
  assert.ok(creationCode[contract], "Retained fixture lacks the checksum-pinned child creation template");
}
const helperRuntime = (contract) => {
  const code = Buffer.from(creationCode[contract].slice(2), "hex"), template = profile.templates[contract];
  for (let offset = 0; offset <= code.length - template.runtimeBytes; offset++) {
    const runtime = code.subarray(offset, offset + template.runtimeBytes);
    if (sha(runtime) === template.runtimeSha256) return "0x" + runtime.toString("hex");
  }
  throw new Error("Missing helper runtime in retained frozen fixture");
};

function fixture() {
  // Synthetic metadata and RPC evidence; never a mainnet receipt or signing approval.
  const runtimes = {};
  const row = (contract, address, args) => {
    const runtimeCode = /SuccessorDeployer/.test(contract) ? helperRuntime(contract)
      : "0x" + "01".repeat(profile.templates[contract].runtimeBytes);
    runtimes[address.toLowerCase()] = runtimeCode;
    const initcode = creationCode[contract] + args.slice(2);
    return { contract, address, initcode, constructorData: args, initcodeHash: keccak256(initcode),
      runtimeHash: keccak256(runtimeCode), initcodeBytes: (initcode.length - 2) / 2,
      runtimeBytes: profile.templates[contract].runtimeBytes };
  };
  const addresses = ids.map((_, index) => getContractAddress({ from: MOBILE_DEPLOYMENT_PAYER, nonce: BigInt(478 + index) }));
  const [directory, registry, v2Address, v3Address, bootstrapAddress] = addresses;
  const v2 = row(contracts[2], v2Address, "0x"), v3 = row(contracts[3], v3Address, "0x");
  const pins = profile.externalRuntimePins;
  const dependencies = [pins.poolManager.address, pins.positionManager.address, pins.permit2.address,
    pins.poolManager.runtimeHash, pins.positionManager.runtimeHash, pins.permit2.runtimeHash];
  const engineAddress = getContractAddress({ from: bootstrapAddress, nonce: 2n });
  const factoryAddress = getContractAddress({ from: bootstrapAddress, nonce: 3n });
  const guardArgs = encodeAbiParameters(typed("address", "address"), [pins.poolManager.address, engineAddress]);
  const guardInitcode = creationCode.RMTV4CurveInitializationGuardV1 + guardArgs.slice(2);
  const salt = toHex(0x51dfn, { size: 32 });
  const guardAddress = getCreate2Address({ from: bootstrapAddress, salt, bytecodeHash: keccak256(guardInitcode) });
  const guard = { ...row("RMTV4CurveInitializationGuardV1", guardAddress, guardArgs), create2Salt: salt, hookPermissionBits: "0x2000" };
  const engine = row("RMTV4CurveGraduationV1", engineAddress,
    encodeAbiParameters([dependenciesType, ...typed("address", "address")], [dependencies, factoryAddress, guardAddress]));
  const safes = pinnedSafeCreationRows();
  const factory = row("RMTLaunchCurveFactoryV2", factoryAddress,
    encodeAbiParameters(typed("address", "address", "address", "address", "address", "bytes32", "uint256"),
      [engineAddress, safes[0].expectedAddress, safes[1].expectedAddress, registry, v2Address, v2.runtimeHash, 400_000_000_000_000n]));
  const constructors = [row(contracts[0], directory, encodeAbiParameters(typed("address", "address", "address"), policy.owners)),
    row(contracts[1], registry, encodeAbiParameters(typed("address"), [directory])), v2, v3,
    row(contracts[4], bootstrapAddress,
      encodeAbiParameters([dependenciesType, ...typed("bytes32", "address", "address", "address", "address", "bytes32", "uint256")],
        [dependencies, salt, safes[0].expectedAddress, safes[1].expectedAddress, registry, v2Address, v2.runtimeHash, 400_000_000_000_000n]))]
    .map((candidate, index) => ({ ...candidate, id: ids[index], nonce: String(478 + index),
      unsigned: { type: "0x2", chainId: "0x1237", from: MOBILE_DEPLOYMENT_PAYER,
        nonce: toHex(BigInt(478 + index)), value: "0x0", data: candidate.initcode } }));
  const evidence = { governanceOwners: policy.owners };
  const plan = { chainId: 4663, scope: "UNSIGNED_4663_PROTOCOL_CONTINUATION_AFTER_BOTH_SAFE_RECEIPTS", sender: MOBILE_DEPLOYMENT_PAYER,
    broadcastAuthorized: false, signingAuthorized: false, compiler: { profile: profile.profile,
      inputSha256: profile.inputSha256, compilerVersion: profile.compilerVersion }, terms: approvedRmtTerms,
    tokenCreation: null, constructors, bootstrapChildren: [guard, engine, factory], evidenceSha256: sha(JSON.stringify(evidence)),
    safeReceipts: safes.map((safe, index) => ({ status: "L2_CREATION_VERIFIED", chainId: 4663,
      role: index === 0 ? "RMT-OPERATIONS" : "RMT-RESERVE", safe: safe.expectedAddress,
      hash: "0x" + String(index + 1).repeat(64), blockHash: "0x" + "33".repeat(32), broadcastAuthorized: false })) };
  plan.planSha256 = sha(JSON.stringify(plan));
  return { packet: { plan, evidence }, runtimes };
}
const reseal = (packet) => { delete packet.plan.planSha256; packet.plan.planSha256 = sha(JSON.stringify(packet.plan)); };
const proofs = (packet, id) => packet.plan.constructors.slice(0, ids.indexOf(id)).map((row, index) => ({
  status: "L2_DEPLOYMENT_VERIFIED", id: row.id, chainId: 4663, expectedAddress: row.address,
  transactionHash: "0x" + String(index + 4).repeat(64), receiptBlock: "100", blockHash: "0x" + "44".repeat(32),
  planSha256: packet.plan.planSha256, initcodeHash: row.initcodeHash, runtimeHash: row.runtimeHash, broadcastAuthorized: false,
}));

test("four future stages retain frozen creation code, exact committed inputs and original nonces", () => {
  const { packet } = fixture();
  for (const id of ids.slice(1)) {
    const result = protocolStageCandidate(packet, id);
    assert.equal(result.candidate.nonce, String(478 + ids.indexOf(id)));
    assert.equal(result.requiredPredecessors.length, ids.indexOf(id));
    assert.ok(!Object.hasOwn(result.candidate.request, "to"));
  }
});

test("resealed packet digests cannot authorize changed supply, beneficiaries, helper pins, bytecode or constructor inputs", () => {
  for (const mutate of [
    (p) => { p.plan.terms = { ...p.plan.terms, fixedSupplyTokens: "2" }; },
    (p) => { p.plan.safeReceipts[0].safe = policy.owners[0]; },
    (p) => { p.plan.constructors[1].initcode = "0x6000" + p.plan.constructors[1].initcode.slice(6); },
    (p) => { p.plan.constructors[2].runtimeHash = zeroHash; },
    (p) => { p.plan.bootstrapChildren[0].create2Salt = zeroHash; },
    (p) => { p.plan.bootstrapChildren[2].initcode = p.plan.bootstrapChildren[2].initcode.slice(0, -2) + "01"; },
    (p) => { p.plan.constructors[4].unsigned.value = "0x1"; },
    (p) => { p.plan.constructors[1].nonce = "480"; },
  ]) {
    const { packet } = fixture(); mutate(packet); reseal(packet);
    assert.throws(() => protocolStageCandidate(packet, "bootstrap"));
  }
});

test("all preceding actual receipt proofs are required in order; pending, wrong-plan and changed identities fail", () => {
  const { packet } = fixture();
  for (const id of ids.slice(1)) assert.equal(validatePredecessorProofs(packet, id, proofs(packet, id)).candidate.id, id);
  for (const mutate of [
    (p) => p.pop(), (p) => p.reverse(), (p) => { p[0].status = "PENDING"; },
    (p) => { p[0].planSha256 = "0".repeat(64); }, (p) => { p[0].runtimeHash = zeroHash; },
    (p) => { p[0].chainId = 31337; }, (p) => { p[0].transactionHash = zeroHash; },
  ]) {
    const input = proofs(packet, "bootstrap"); mutate(input);
    assert.throws(() => validatePredecessorProofs(packet, "bootstrap", input));
  }
});

test("missing predecessors stop before any RPC, while unavailable or changed fresh proofs stop before CREATE simulation", async () => {
  const { packet } = fixture(); let calls = 0;
  const fetcher = async () => { calls++; throw new Error("No RPC should occur"); };
  await assert.rejects(probeProtocolConstructor(packet, { id: "registry", predecessorProofs: [], fetcher }));
  assert.equal(calls, 0);
  const prior = proofs(packet, "registry");
  const safeVerifier = async ({ role }) => packet.plan.safeReceipts.find((proof) => proof.role === role);
  for (const fresh of [{ ...prior[0], status: "PENDING" }, { ...prior[0], blockHash: "0x" + "ee".repeat(32) }]) {
    await assert.rejects(probeProtocolConstructor(packet, { id: "registry", predecessorProofs: prior,
      fetcher, safeVerifier, receiptVerifier: async () => fresh }));
  }
  assert.equal(calls, 0);
  await assert.rejects(probeProtocolConstructor(packet, { id: "registry", predecessorProofs: prior,
    fetcher, safeVerifier: async () => ({ status: "PENDING" }) }));
  assert.equal(calls, 0);
});

const safeAbi = parseAbi(["function masterCopy() view returns(address)", "function VERSION() view returns(string)",
  "function getOwners() view returns(address[])", "function getThreshold() view returns(uint256)", "function nonce() view returns(uint256)",
  "function getModulesPaginated(address,uint256) view returns(address[] array,address next)", "function getStorageAt(uint256,uint256) view returns(bytes)"]);
function bindingReaders(input, mutate) {
  const anchor = { number: "100", hash: "0x" + "aa".repeat(32) };
  const read = async (method, params = []) => {
    const changed = mutate?.(method, params); if (changed !== undefined) return { status: "observed", value: changed };
    if (method === "eth_chainId") return { status: "observed", value: "0x1237" };
    if (method === "eth_getBlockByNumber") return { status: "observed", value: { hash: anchor.hash } };
    if (method === "eth_getCode") return { status: "observed", value: input.runtimes[params[0].toLowerCase()]
      ?? (input.packet.plan.safeReceipts.some((safe) => safe.safe.toLowerCase() === params[0].toLowerCase()) ? safeRuntime : "0x6000") };
    if (method === "eth_call") {
      const { functionName, args } = decodeFunctionData({ abi: safeAbi, data: params[0].data });
      const values = { masterCopy: policy.singleton, VERSION: "1.4.1", getOwners: policy.owners,
        getThreshold: 2n, nonce: 0n, getModulesPaginated: [[], "0x0000000000000000000000000000000000000001"] };
      const fallbackSlot = BigInt(keccak256(stringToHex("fallback_manager.handler.address")));
      const result = functionName === "getStorageAt" ? args[0] === fallbackSlot ? padHex(policy.setup.fallbackHandler, { size: 32 }) : zeroHash : values[functionName];
      return { status: "observed", value: encodeFunctionResult({ abi: safeAbi, functionName, result }) };
    }
    throw new Error("Unexpected synthetic method " + method);
  };
  return { anchor, readers: { official: read, pocket: read } };
}

test("changed predecessor runtime and Safe ownership, threshold, nonce, modules, handler or guard stop current binding", async () => {
  const input = fixture(), stage = protocolStageCandidate(input.packet, "registry");
  for (const [name, result] of [["getOwners", [policy.owners[0], policy.owners[0], policy.owners[2]]],
    ["getThreshold", 1n], ["nonce", 1n], ["getModulesPaginated", [[policy.owners[0]], "0x0000000000000000000000000000000000000001"]],
    ["getStorageAt", padHex(policy.owners[0], { size: 32 })]]) {
    const { anchor, readers } = bindingReaders(input, (method, params) => {
      if (method !== "eth_call") return undefined;
      const decoded = decodeFunctionData({ abi: safeAbi, data: params[0].data });
      return decoded.functionName === name ? encodeFunctionResult({ abi: safeAbi, functionName: name, result }) : undefined;
    });
    await assert.rejects(observeProtocolBindings(input.packet, stage, anchor, readers));
  }
  const { anchor, readers } = bindingReaders(input, (method, params) => method === "eth_getCode" &&
    params[0] === input.packet.plan.constructors[0].address ? "0x6000" : undefined);
  await assert.rejects(observeProtocolBindings(input.packet, stage, anchor, readers), /predecessor/);
});

test("unknown dependency code and missing observations never satisfy current bindings", async () => {
  const input = fixture(), stage = protocolStageCandidate(input.packet, "registry");
  const { anchor, readers } = bindingReaders(input);
  // Safe fields above are synthetically valid; Uniswap bytes are deliberately
  // unavailable, so there can be no successful readiness claim from this fixture.
  await assert.rejects(observeProtocolBindings(input.packet, stage, anchor, readers), /Uniswap/);
  await assert.rejects(observeProtocolBindings(input.packet, stage, anchor,
    { official: async () => ({ status: "unavailable" }), pocket: readers.pocket }), /unavailable/);
});
