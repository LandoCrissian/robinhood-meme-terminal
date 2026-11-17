import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { protocolReceiptPlan, verifyProtocolReceipt } from "./protocol-receipt.mjs";
import { mobilePayer } from "../../packages/contracts/scripts/mobile-review-plan.mjs";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { encodeFunctionData, encodeFunctionResult, getContractAddress, keccak256, parseAbi, toHex, zeroHash } = require("viem");
const profile = JSON.parse(readFileSync(new URL("../../docs/evidence/fixed-supply-security/4663-profile.json", import.meta.url)));
const owners = JSON.parse(readFileSync(new URL("../../docs/evidence/rmt-task045/operations-safe-policy.json", import.meta.url))).operations.owners;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const ids = ["directory", "registry", "successor-v2", "successor-v3", "bootstrap"];
const contracts = ["RMTLaunchCurveDirectoryV2", "RMTLaunchProjectRegistryV3", "RMTLaunchCurveSuccessorDeployerV1", "RMTLaunchCurveSuccessorDeployerV2", "RMTLaunchCurveDeploymentV2"];
const txHash = "0x" + "11".repeat(32), blockHash = "0x" + "22".repeat(32), currentHash = "0x" + "33".repeat(32);
const code = "0x6000", codeHash = keccak256(code), now = Date.parse("2026-11-17T19:00:00Z");

// All chain observations below are synthetic unit fixtures. They are not deployment receipts or production bytecode evidence.
function fixture() {
  const evidence = { governanceOwners: owners, scope: "SYNTHETIC_UNIT_FIXTURE" };
  const plan = { schemaVersion: 1, scope: "UNSIGNED_4663_PROTOCOL_CONTINUATION_AFTER_BOTH_SAFE_RECEIPTS", chainId: 4663,
    broadcastAuthorized: false, signingAuthorized: false, sender: mobilePayer, evidenceSha256: sha256(JSON.stringify(evidence)),
    compiler: { profile: profile.profile, inputSha256: profile.inputSha256, compilerVersion: profile.compilerVersion }, tokenCreation: null,
    constructors: ids.map((id, index) => ({ id, contract: contracts[index], nonce: String(478 + index),
      address: getContractAddress({ from: mobilePayer, nonce: BigInt(478 + index) }), initcode: code, initcodeHash: codeHash,
      initcodeBytes: 2, runtimeHash: codeHash, runtimeBytes: 2,
      unsigned: { type: "0x2", chainId: "0x1237", from: mobilePayer, nonce: toHex(478 + index), value: "0x0", data: code } })),
    bootstrapChildren: ["RMTV4CurveInitializationGuardV1", "RMTV4CurveGraduationV1", "RMTLaunchCurveFactoryV2"].map((contract, index) => ({
      contract, address: index === 0 ? "0x0000000000000000000000000000000000002000" : getContractAddress({ from: mobilePayer, nonce: BigInt(800 + index) }),
      runtimeHash: codeHash, runtimeBytes: 2, ...(index === 0 ? { hookPermissionBits: "0x2000" } : {}) })),
  };
  plan.planSha256 = sha256(JSON.stringify(plan));
  return { plan, evidence };
}
function reseal(packet) { const { planSha256: ignored, ...body } = packet.plan; packet.plan.planSha256 = sha256(JSON.stringify(body)); return packet; }
function harness({ id = "directory", alterTx, alterReceipt, peerTx, peerReceipt, unavailable, wrongCode, wrongState,
  stale = false, reorg = false, peerBlock = false, childCode = false } = {}) {
  const packet = fixture(), row = packet.plan.constructors.find((item) => item.id === id), calls = [];
  const tx = { hash: txHash, blockHash, blockNumber: "0x64", transactionIndex: "0x0", type: "0x2", chainId: "0x1237",
    from: mobilePayer, to: null, nonce: toHex(BigInt(row.nonce)), value: "0x0", input: code, gas: "0x4c4b40",
    maxFeePerGas: "0x2625a00", maxPriorityFeePerGas: "0x0", accessList: [] };
  const receipt = { transactionHash: txHash, blockHash, blockNumber: "0x64", transactionIndex: "0x0", type: "0x2", status: "0x1",
    from: mobilePayer, to: null, contractAddress: row.address, gasUsed: "0x244dc0", effectiveGasPrice: "0x1312d00", logs: [] };
  alterTx?.(tx); alterReceipt?.(receipt);
  const states = new Map();
  const register = (name, type, value) => { const abi = parseAbi(["function " + name + "() view returns (" + type + ")"]);
    states.set(encodeFunctionData({ abi, functionName: name }), { abi, name, value }); };
  for (const [name, type, value] of [["signerA", "address", owners[0]], ["signerB", "address", owners[1]], ["signerC", "address", owners[2]],
    ["signerSetEpoch", "uint64", 1n], ["nonce", "uint64", 0n], ["rotationNonce", "uint64", 0n],
    ["publicationDelay", "uint48", 172800n], ["executionWindow", "uint48", 604800n], ["latestVersion", "uint32", 0n],
    ["suspended", "bool", false], ["pending", "bytes32,uint48,uint48", [zeroHash, 0n, 0n]],
    ["pendingRotation", "bytes32,uint48,uint48", [zeroHash, 0n, 0n]], ["directory", "address", packet.plan.constructors[0].address],
    ["migrationDelay", "uint48", 172800n], ["migrationWindow", "uint48", 604800n]]) register(name, type, value);
  for (const [index, child] of packet.plan.bootstrapChildren.entries()) register(["initializationGuard", "graduationEngine", "factory"][index], "address", child.address);
  const readers = Object.fromEntries(["official", "pocket"].map((provider) => {
    let receiptHeaders = 0;
    return [provider, async (method, params = []) => {
      calls.push({ provider, method, params });
      assert.ok(!/send|sign|set|impersonate/i.test(method), "Receipt verification must remain read-only");
      if (unavailable?.(provider, method, params)) return { status: "unavailable" };
      let value;
      if (method === "eth_chainId") value = "0x1237";
      else if (method === "eth_getTransactionByHash") { value = structuredClone(tx); if (provider === "official") peerTx?.(value); }
      else if (method === "eth_getTransactionReceipt") { value = structuredClone(receipt); if (provider === "official") peerReceipt?.(value); }
      else if (method === "eth_getCode") value = wrongCode?.(provider, params) || (childCode && params[0] !== row.address ? "0x6001" : code);
      else if (method === "eth_getBlockByNumber") {
        const initial = params[0] === "0x64"; if (initial) receiptHeaders++;
        value = { number: initial ? "0x64" : "0x65", hash: initial ? blockHash : currentHash,
          timestamp: toHex(BigInt(Math.floor(now / 1000) - (stale ? 1000 : 0))) };
        if ((peerBlock && provider === "official") || (reorg && initial && receiptHeaders > 1)) value.hash = "0x" + "44".repeat(32);
      } else if (method === "eth_call") {
        const state = states.get(params[0].data); assert.ok(state, "Unrecognized fixture getter");
        value = encodeFunctionResult({ abi: state.abi, functionName: state.name, result: wrongState?.(provider, state.name, params[1]) ?? state.value });
      } else assert.fail("Unexpected RPC method " + method);
      return { status: "observed", value };
    }];
  }));
  return { packet, calls, readers, id, hash: txHash, now: () => now };
}

test("exact packet digest, evidence digest, chain, bytecode, nonce and no-token boundary are required before any RPC", () => {
  for (const mutate of [
    (p) => { p.plan.planSha256 = "0".repeat(64); }, (p) => { p.evidence.governanceOwners = []; },
    (p) => { p.plan.chainId = 31337; reseal(p); }, (p) => { p.plan.constructors[0].initcode = "0x6001"; reseal(p); },
    (p) => { p.plan.constructors[0].unsigned.nonce = "0x1"; reseal(p); },
    (p) => { p.plan.constructors[0].unsigned.to = owners[0]; reseal(p); },
    (p) => { p.plan.compiler.inputSha256 = "0".repeat(64); reseal(p); },
    (p) => { p.plan.tokenCreation = {}; reseal(p); },
  ]) { const packet = fixture(); mutate(packet); assert.throws(() => protocolReceiptPlan(packet, "directory")); }
  assert.throws(() => protocolReceiptPlan(fixture(), "unknown"));
});

test("canonical Directory CREATE verifies exact transaction, archived runtime, initial/current signers and notice controls", async () => {
  const h = harness(), result = await verifyProtocolReceipt(h);
  assert.equal(result.status, "L2_DEPLOYMENT_VERIFIED", result.reason);
  assert.equal(result.transaction.gasUsed, "2379200");
  assert.equal(result.initialState.publicationDelay, "172800");
  assert.equal(result.initialState.executionWindow, "604800");
  assert.equal(result.initialState.signerSetEpoch, "1");
  assert.equal(result.current.length, 2); assert.equal(result.finality, "L1_UNVERIFIED");
  assert.equal(result.broadcastAuthorized, false); assert.equal(result.sourceVerification, "BLOCKSCOUT_PENDING");
  assert.ok(h.calls.some((c) => c.provider === "pocket" && c.method === "eth_getCode" && c.params[1] === "0x64"));
  assert.ok(!h.calls.some((c) => c.provider === "official" && c.method === "eth_getCode" && c.params[1] === "0x64"));
});

test("remaining constructors preserve exact deployment identity and bootstrap children", async () => {
  for (const id of ids.slice(1)) { const result = await verifyProtocolReceipt(harness({ id })); assert.equal(result.status, "L2_DEPLOYMENT_VERIFIED", result.reason); }
});

test("missing transaction, receipt, archive code or current reads remains pending", async () => {
  for (const method of ["eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getCode", "eth_call", "eth_getBlockByNumber"]) {
    const result = await verifyProtocolReceipt(harness({ unavailable: (_, requested) => requested === method }));
    assert.equal(result.status, "PENDING", result.reason);
  }
});

test("wrong sender, nonce, chain, value, destination, input, type, allowance list and delegation authorization fail closed", async () => {
  for (const alterTx of [
    (tx) => { tx.from = owners[0]; }, (tx) => { tx.nonce = "0x1"; }, (tx) => { tx.chainId = "0x7a69"; },
    (tx) => { tx.value = "0x1"; }, (tx) => { tx.to = owners[0]; }, (tx) => { tx.input = "0x6001"; },
    (tx) => { tx.type = "0x4"; }, (tx) => { tx.accessList = [{ address: owners[0], storageKeys: [] }]; },
    (tx) => { tx.authorizationList = []; }, (tx) => { tx.maxFeePerGas = "0x1"; },
  ]) { const result = await verifyProtocolReceipt(harness({ alterTx })); assert.equal(result.status, "EVIDENCE_INVALID", result.reason); }
});

test("reverted or wrong CREATE receipt cannot advance", async () => {
  for (const alterReceipt of [
    (receipt) => { receipt.status = "0x0"; }, (receipt) => { receipt.contractAddress = owners[0]; },
    (receipt) => { receipt.from = owners[0]; }, (receipt) => { receipt.gasUsed = "0xffffff"; },
    (receipt) => { receipt.transactionIndex = "0x1"; }, (receipt) => { receipt.blockHash = currentHash; },
  ]) { const result = await verifyProtocolReceipt(harness({ alterReceipt })); assert.equal(result.status, "EVIDENCE_INVALID", result.reason); }
});

test("provider transaction, receipt or canonical block disagreement fails closed", async () => {
  for (const option of [
    { peerTx: (tx) => { tx.gas = "0x4c4b41"; } },
    { peerReceipt: (receipt) => { receipt.effectiveGasPrice = "0x1312d01"; } },
    { peerBlock: true },
  ]) { const result = await verifyProtocolReceipt(harness(option)); assert.equal(result.status, "EVIDENCE_INVALID", result.reason); }
});

test("runtime, Directory controls, reorgs, stale observations and bootstrap child changes fail closed", async () => {
  for (const option of [
    { wrongCode: () => "0x6001" }, { wrongState: (_, name) => name === "signerA" ? owners[1] : undefined },
    { wrongState: (_, name) => name === "nonce" ? 1n : undefined },
    { wrongState: (_, name) => name === "publicationDelay" ? 0n : undefined },
    { wrongState: (_, name) => name === "pending" ? [blockHash, 1n, 2n] : undefined },
    { reorg: true }, { stale: true }, { id: "bootstrap", childCode: true },
  ]) { const result = await verifyProtocolReceipt(harness(option)); assert.equal(result.status, "EVIDENCE_INVALID", result.reason); }
});
