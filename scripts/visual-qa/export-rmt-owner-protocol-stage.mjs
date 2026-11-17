import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildOwnerTransactionReview } from "./export-rmt-owner-safe.mjs";
import { ownerProtocolConfiguration } from "./export-rmt-owner-protocol.mjs";
import { privateOutputPath } from "../../packages/contracts/scripts/prepare-unsigned-4663.mjs";
const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { encodeAbiParameters, encodeFunctionData, encodeFunctionResult, getContractAddress, keccak256, parseAbi, zeroAddress, zeroHash } = require("viem");
const profile = JSON.parse(readFileSync(new URL("../../docs/evidence/fixed-supply-security/4663-profile.json", import.meta.url)));
const ids = ["directory", "registry", "successor-v2", "successor-v3", "bootstrap"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hash = /^0x[0-9a-f]{64}$/i;
function encodedState(signature, expected, args = []) {
  const abi = parseAbi(["function " + signature]); const functionName = signature.split("(")[0];
  return { data: encodeFunctionData({ abi, functionName, args }), expected: encodeFunctionResult({ abi, functionName, result: expected }) };
}
function pin(code, expected) {
  assert.match(code, /^0x(?:[0-9a-f]{2})+$/i);
  assert.equal(keccak256(code), expected.runtimeHash, "Stage runtime differs from the materialized compiler output");
  assert.equal((code.length - 2) / 2, expected.runtimeBytes);
  return { address: expected.address, sha256: sha256(Buffer.from(code.slice(2), "hex")), byteLength: expected.runtimeBytes };
}
function fieldsFor(id, plan, directoryPostState) {
  if (id === "directory") return directoryPostState;
  if (id === "registry") return [encodedState("directory() view returns(address)", plan.constructors[0].address),
    encodedState("migrationDelay() view returns(uint48)", 172800n), encodedState("migrationWindow() view returns(uint48)", 604800n)];
  if (id === "successor-v3") return [encodedState("fromVersion() view returns(uint32)", 2), encodedState("toVersion() view returns(uint32)", 3)];
  if (id === "bootstrap") return plan.bootstrapChildren.map((child, index) =>
    encodedState(["initializationGuard", "graduationEngine", "factory"][index] + "() view returns(address)", child.address));
  return [];
}
function stageArguments(plan, id) {
  if (id === "registry") return encodeAbiParameters([{ type: "address" }], [plan.constructors[0].address]);
  if (id !== "bootstrap") return "0x";
  const p = profile.externalRuntimePins;
  return encodeAbiParameters([{ type: "tuple", components: [
    { name: "poolManager", type: "address" }, { name: "positionManager", type: "address" }, { name: "permit2", type: "address" },
    { name: "poolManagerHash", type: "bytes32" }, { name: "positionManagerHash", type: "bytes32" }, { name: "permit2Hash", type: "bytes32" },
  ] }, { type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "uint256" }],
  [[p.poolManager.address, p.positionManager.address, p.permit2.address, p.poolManager.runtimeHash, p.positionManager.runtimeHash, p.permit2.runtimeHash],
    plan.bootstrapChildren[0].create2Salt, plan.safeReceipts[0].safe, plan.safeReceipts[1].safe, plan.constructors[1].address,
    plan.constructors[2].address, plan.constructors[2].runtimeHash, 400000000000000n]);
}

export function ownerProtocolStageConfiguration(endpoint, { id, packet, runtimes, stageRuntime, predecessors,
  dependencyRuntimes = [], childRuntimes = [] }, options = {}) {
  assert.ok(ids.includes(id) && id !== "directory", "Unsupported next protocol stage");
  const url = new URL(endpoint);
  assert.ok(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
    url.pathname === "/protocol-" + id + ".html", "Use the stage-specific isolated HTTPS path");
  assert.ok(Array.isArray(predecessors) && predecessors.length === ids.indexOf(id), "Every earlier protocol stage requires a canonical receipt");
  const { plan } = packet;
  const base = ownerProtocolConfiguration(new URL("/protocol-deployment.html", url).href, packet, runtimes, predecessors[0].runtime, options);
  const candidate = plan.constructors[ids.indexOf(id)];
  assert.equal(candidate?.id, id);
  assert.equal(candidate.nonce, (BigInt(plan.constructors[0].nonce) + BigInt(ids.indexOf(id))).toString());
  assert.equal(candidate.address.toLowerCase(), getContractAddress({ from: plan.sender, nonce: BigInt(candidate.nonce) }).toLowerCase());
  const template = profile.templates[candidate.contract]; assert.ok(template);
  assert.equal(sha256(Buffer.from(candidate.initcode.slice(2, 2 + template.creationBytes * 2), "hex")), template.creationSha256,
    "Stage creation bytecode differs from the frozen compiler output");
  const args = stageArguments(plan, id);
  assert.equal(candidate.constructorData, args);
  assert.equal("0x" + candidate.initcode.slice(2 + template.creationBytes * 2), args, "Stage immutable constructor inputs differ");
  assert.equal(keccak256(candidate.initcode), candidate.initcodeHash);
  assert.equal(candidate.initcodeBytes, (candidate.initcode.length - 2) / 2);
  assert.ok(candidate.initcodeBytes <= 49152 && candidate.runtimeBytes <= 24576);
  assert.deepEqual(candidate.unsigned, { type: "0x2", chainId: "0x1237", from: plan.sender,
    nonce: "0x" + BigInt(candidate.nonce).toString(16), value: "0x0", data: candidate.initcode });
  assert.equal(stageRuntime.contract, candidate.contract);
  assert.equal(stageRuntime.address.toLowerCase(), candidate.address.toLowerCase());
  const createdContract = pin(stageRuntime.runtimeCode, candidate);
  const protocolPrerequisites = predecessors.map(({ proof, runtime }, index) => {
    const previous = plan.constructors[index];
    assert.equal(proof?.scope, "READ_ONLY_4663_PROTOCOL_CREATE_RECEIPT");
    assert.equal(proof.status, "L2_DEPLOYMENT_VERIFIED", "An earlier stage is not canonically verified");
    assert.equal(proof.chainId, 4663); assert.equal(proof.id, previous.id); assert.equal(proof.planSha256, plan.planSha256);
    assert.equal(proof.expectedAddress.toLowerCase(), previous.address.toLowerCase());
    assert.equal(proof.initcodeHash, previous.initcodeHash); assert.equal(proof.runtimeHash, previous.runtimeHash);
    assert.ok(hash.test(proof.transactionHash) && hash.test(proof.blockHash) && /^[1-9][0-9]*$/.test(proof.receiptBlock));
    assert.equal(proof.broadcastAuthorized, false); assert.equal(proof.transaction.status, "success");
    assert.equal(proof.transaction.transactionHash.toLowerCase(), proof.transactionHash.toLowerCase());
    assert.equal(proof.transaction.blockHash, proof.blockHash); assert.equal(proof.transaction.blockNumber, proof.receiptBlock);
    assert.equal(proof.archiveRuntime.runtimeHash, previous.runtimeHash);
    assert.deepEqual(proof.canonicalProviders, ["official", "pocket"]);
    assert.ok(proof.current.length === 2 && proof.current.every((w) => w.deployed.runtimeHash === previous.runtimeHash));
    return { id: previous.id, address: previous.address, hash: proof.transactionHash, receiptBlock: proof.receiptBlock,
      blockHash: proof.blockHash, input: previous.initcode, nonce: "0x" + BigInt(previous.nonce).toString(16),
      runtime: pin(runtime.runtimeCode, previous), postState: fieldsFor(previous.id, plan, base.postState) };
  });
  const preflightContracts = [], createdChildren = [];
  if (id === "bootstrap") {
    assert.equal(BigInt(plan.bootstrapChildren[0].address) & 0x3fffn, 0x2000n);
    assert.equal(childRuntimes.length, 3, "Bootstrap requires each independently materialized child runtime");
    for (const [index, child] of plan.bootstrapChildren.entries()) {
      const supplied = childRuntimes[index];
      assert.equal(supplied.address.toLowerCase(), child.address.toLowerCase());
      const runtime = pin(supplied.runtimeCode, child);
      createdChildren.push({ address: child.address, runtime, postState: [] });
    }
    for (const dependency of Object.values(profile.externalRuntimePins)) {
      const supplied = dependencyRuntimes.find((x) => x.address.toLowerCase() === dependency.address.toLowerCase());
      assert.ok(supplied, "Bootstrap requires actual runtime evidence for every pinned Uniswap dependency");
      assert.equal(keccak256(supplied.runtimeCode), dependency.runtimeHash);
      preflightContracts.push({ address: dependency.address, runtime: { address: dependency.address,
        sha256: sha256(Buffer.from(supplied.runtimeCode.slice(2), "hex")), byteLength: (supplied.runtimeCode.length - 2) / 2 }, postState: [] });
    }
    const [guard, engine, factory] = plan.bootstrapChildren;
    const p = profile.externalRuntimePins;
    createdChildren[0].postState = [encodedState("poolManager() view returns(address)", p.poolManager.address), encodedState("graduationEngine() view returns(address)", engine.address)];
    createdChildren[1].postState = [encodedState("factory() view returns(address)", factory.address), encodedState("poolManager() view returns(address)", p.poolManager.address),
      encodedState("positionManager() view returns(address)", p.positionManager.address), encodedState("permit2() view returns(address)", p.permit2.address),
      encodedState("initializationGuard() view returns(address)", guard.address), encodedState("CHAIN_ID() view returns(uint256)", 4663n),
      encodedState("POOL_FEE() view returns(uint24)", 3000), encodedState("TICK_SPACING() view returns(int24)", 60)];
    createdChildren[2].postState = [encodedState("graduationEngine() view returns(address)", engine.address), encodedState("operatingRecipient() view returns(address)", plan.safeReceipts[0].safe),
      encodedState("futureReserveRecipient() view returns(address)", plan.safeReceipts[1].safe), encodedState("projectRegistry() view returns(address)", plan.constructors[1].address),
      encodedState("successorDeployer() view returns(address)", plan.constructors[2].address), encodedState("successorDeployerRuntimeHash() view returns(bytes32)", plan.constructors[2].runtimeHash),
      encodedState("creationFeeWei() view returns(uint256)", 400000000000000n), encodedState("tokenSupply() view returns(uint256)", 1000000000n * 10n ** 18n),
      encodedState("engineVersion() view returns(uint32)", 1), encodedState("creationFeesAccrued() view returns(uint256)", 0n)];
  }
  const gasAbi = parseAbi(["function gasEstimateComponents(address,bool,bytes) payable returns(uint64,uint64,uint256,uint256)"]);
  return { ...base, endpoint: url.href, task: "OWNER_CONTROLLED_PROTOCOL_STAGE", role: "PROTOCOL-" + id.toUpperCase(),
    operation: { ...base.operation, id, label: "Deploy " + candidate.contract, reviewTitle: candidate.contract,
      summary: "Deploy only " + candidate.contract + "; existing protocol inputs and economics remain fixed; this action creates no token.",
      reviewFields: id === "registry" ? [["Immutable governance Directory", plan.constructors[0].address],
        ["Migration notice / execution window", "2 days / 7 days"]] : id === "bootstrap" ? [
        ["Operations beneficiary", plan.safeReceipts[0].safe], ["Reserve beneficiary", plan.safeReceipts[1].safe],
        ["Project registry", plan.constructors[1].address], ["Reviewed successor deployer", plan.constructors[2].address],
        ["Successor runtime hash", plan.constructors[2].runtimeHash], ["Creation fee", "0.0004 ETH"],
        ["PoolManager", profile.externalRuntimePins.poolManager.address], ["PositionManager", profile.externalRuntimePins.positionManager.address],
        ["Permit2", profile.externalRuntimePins.permit2.address], ["Initialization guard CREATE2 salt", plan.bootstrapChildren[0].create2Salt],
      ] : [["Constructor arguments", "None; fixed reviewed implementation"]],
      data: candidate.initcode, dataHash: candidate.initcodeHash, expectedAddress: candidate.address, nonce: "0x" + BigInt(candidate.nonce).toString(16) },
    nitroData: encodeFunctionData({ abi: gasAbi, functionName: "gasEstimateComponents", args: [zeroAddress, true, candidate.initcode] }),
    createdContract, runtimeKeccak256: candidate.runtimeHash, protocolPrerequisites, preflightContracts, createdChildren,
    childVacancies: id === "bootstrap" ? plan.bootstrapChildren.map((x) => x.address) : [],
    postState: fieldsFor(id, plan, base.postState),
  };
}

export function buildOwnerProtocolStageReview(endpoint, inputs, options) {
  const config = ownerProtocolStageConfiguration(endpoint, inputs, options);
  const result = buildOwnerTransactionReview(config);
  return { ...result, manifest: { ...result.manifest, id: config.operation.id, nonce: config.operation.nonce,
    mode: "CREATE", runtimeKeccak256: config.runtimeKeccak256, compilerInputSha256: config.compilerInputSha256,
    planSha256: config.planSha256, predecessorHashes: config.protocolPrerequisites.map((x) => x.hash) } };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { url: { type: "string" }, id: { type: "string" }, packet: { type: "string" }, runtimes: { type: "string" },
    "stage-runtime": { type: "string" }, predecessors: { type: "string" }, "dependency-runtimes": { type: "string" }, "child-runtimes": { type: "string" },
    output: { type: "string" }, "key-file": { type: "string" } } });
  const output = privateOutputPath(values.output), keyFile = privateOutputPath(values["key-file"]);
  assert.notEqual(output.toLowerCase(), keyFile.toLowerCase());
  const json = (path) => JSON.parse(readFileSync(path));
  const built = buildOwnerProtocolStageReview(values.url, { id: values.id, packet: json(values.packet), runtimes: json(values.runtimes),
    stageRuntime: json(values["stage-runtime"]), predecessors: json(values.predecessors),
    dependencyRuntimes: values["dependency-runtimes"] ? json(values["dependency-runtimes"]) : [], childRuntimes: values["child-runtimes"] ? json(values["child-runtimes"]) : [] });
  writeFileSync(output, built.html, { flag: "wx", mode: 0o600 }); writeFileSync(keyFile, built.accessCode + "\n", { flag: "wx", mode: 0o600 });
  console.log("Prepared only the exact " + values.id + " CREATE; owner MetaMask fee approval and canonical predecessor checks remain required.");
}
