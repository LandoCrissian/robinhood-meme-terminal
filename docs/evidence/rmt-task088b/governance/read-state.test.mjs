import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";

const require = createRequire(new URL("../../../../apps/launch-website/package.json", import.meta.url));
const {parseAbi, encodeFunctionData, decodeFunctionResult, keccak256} = require("viem");
const read = name => readFileSync(new URL(name, import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const raw = gunzipSync(read("read-state.json.gz"), {maxOutputLength: 1048576});
const producer = gunzipSync(read("capture-getters.mjs.gz"), {maxOutputLength: 65536});
const report = JSON.parse(raw), manifest = JSON.parse(read("manifest.json"));
const protocolBytes = readFileSync(new URL("../../mobile-signing/protocol-mainnet.json", import.meta.url));
const protocol = JSON.parse(protocolBytes);
const directory = "0xe677a69a8124714dd0d88b73bdf1b89cc791ca9c";
const factory = "0x7281e1f9d8764ae6533b374dfd08ab2ecbc273c3";
const expectedDigest = "0xad499113950f3410a60c6fe9fe40b4d1d98cf055eeafeb2b1736a5a38c5fea1e";
const abi = parseAbi(["function pending() view returns(bytes32,uint48,uint48)", "function nonce() view returns(uint64)",
  "function signerSetEpoch() view returns(uint64)", "function suspended() view returns(bool)", "function latestVersion() view returns(uint32)",
  "function factories(uint32) view returns(address,bytes32)", "function currentFactory() view returns((address factory,bytes32 runtimeHash))",
  "function engineVersion() view returns(uint32)"]);
const reads = [["pending", []], ["nonce", []], ["signerSetEpoch", []], ["suspended", []], ["latestVersion", []], ["factories", [1]], ["currentFactory", []]];
const normalize = value => typeof value === "bigint" || typeof value === "number" ? String(value)
  : Array.isArray(value) ? value.map(normalize) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]))
    : typeof value === "string" && value.startsWith("0x") ? value.toLowerCase() : value;
const selectors = new Map(reads.map(([name,args]) => [directory + ":" + encodeFunctionData({abi,functionName:name,args}), name]));
selectors.set(factory + ":" + encodeFunctionData({abi,functionName:"engineVersion"}), "factoryEngineVersion");

test("archived governance observation and exact executed producer retain their byte identities", () => {
  assert.equal(digest(raw), manifest.observationDigest.hex);
  assert.equal(digest(producer), manifest.producerDigest.hex);
  assert.equal(digest(producer), report.producerSha256);
  assert.equal(digest(protocolBytes), manifest.protocolEvidenceDigest.hex);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.scope, "BOUNDED_READ_ONLY_DIRECTORY_FACTORY_PUBLICATION_GETTERS");
  assert.equal(report.directory.toLowerCase(), directory); assert.equal(report.factory.toLowerCase(), factory);
  for (const key of ["observationDigest","producerDigest","protocolEvidenceDigest"]) assert.equal(manifest[key].algorithm, "SHA256");
  assert.equal(manifest.notFinancialAuthorization, true);
  assert.equal(manifest.liveVulnerabilityTest, false);
  for (const key of ["signing","broadcast","governanceExecution","stateChangingSimulation","estimateGas"]) assert.equal(report[key], false);
});

test("every retained RPC is a chain/block/code read or one exact public view getter", () => {
  assert.deepEqual(report.permittedMethods, ["eth_chainId","eth_getBlockByNumber","eth_getCode","eth_call"]);
  assert.equal(report.requests.length, 28);
  const ids = new Set();
  for (const row of report.requests) {
    const request = row.request;
    assert.ok(report.permittedMethods.includes(request.method));
    assert.equal(request.jsonrpc, "2.0");
    assert.ok(!ids.has(request.id)); ids.add(request.id);
    assert.equal(row.httpStatus, 200); assert.equal(row.status, "OBSERVED");
    assert.equal(digest(Buffer.from(row.rawUtf8)), row.responseSha256);
    const response = JSON.parse(row.rawUtf8);
    assert.equal(response.jsonrpc, "2.0"); assert.equal(response.id, request.id); assert.ok(!response.error);
    if (request.method === "eth_call") {
      assert.deepEqual(Object.keys(request.params[0]).sort(), ["data","to"]);
      assert.ok(selectors.has(request.params[0].to.toLowerCase() + ":" + request.params[0].data));
      assert.equal(BigInt(request.params[1]).toString(), report.anchor.number);
    }
  }
});

test("both witnesses independently bind getter values, bytecode pins and the same canonical block", () => {
  assert.deepEqual(Object.keys(report.providers).sort(), ["official","pocket"]);
  assert.equal(report.twoProvidersAgree, true); assert.equal(report.canonicalAnchorRechecked, true);
  assert.deepEqual(report.providers.official, report.providers.pocket);
  const pins = [protocol.constructors.find(row => row.id === "directory"), protocol.bootstrapChildren.find(row => row.address.toLowerCase() === factory)];
  for (const name of ["official","pocket"]) {
    const rows = report.requests.filter(row => row.provider === name);
    assert.equal(rows.length, 14);
    assert.deepEqual(report.state, report.providers[name].getters);
    const calls = rows.filter(row => row.request.method === "eth_call");
    assert.deepEqual(calls.map(row => row.request.params[0].to.toLowerCase() + ":" + row.request.params[0].data).sort(), [...selectors.keys()].sort());
    const chain = rows.find(row => row.request.method === "eth_chainId"); assert.equal(BigInt(JSON.parse(chain.rawUtf8).result), 4663n);
    const blocks = rows.filter(row => row.request.method === "eth_getBlockByNumber" && row.request.params[0] !== "latest");
    assert.equal(blocks.length, 2);
    for (const row of blocks) {
      const block = JSON.parse(row.rawUtf8).result;
      assert.equal(BigInt(block.number).toString(), report.anchor.number);
      assert.equal(block.hash.toLowerCase(), report.anchor.hash);
      assert.equal(BigInt(block.timestamp).toString(), report.anchor.timestamp);
    }
    for (const pin of pins) {
      const row = rows.find(row => row.request.method === "eth_getCode" && row.request.params[0].toLowerCase() === pin.address.toLowerCase());
      assert.equal(BigInt(row.request.params[1]).toString(), report.anchor.number);
      assert.equal(keccak256(JSON.parse(row.rawUtf8).result).toLowerCase(), pin.runtimeHash.toLowerCase());
    }
    for (const row of rows.filter(row => row.request.method === "eth_call")) {
      const call = row.request.params[0], nameInReport = selectors.get(call.to.toLowerCase() + ":" + call.data);
      const functionName = nameInReport === "factoryEngineVersion" ? "engineVersion" : nameInReport;
      assert.deepEqual(normalize(decodeFunctionResult({abi,functionName,data:JSON.parse(row.rawUtf8).result})), report.providers[name].getters[nameInReport]);
    }
  }
});

test("the captured pending window is inclusive and remains a read-only publication risk", () => {
  assert.equal(report.expectedDigest, expectedDigest);
  const [pending, readyAt, expiresAt] = report.state.pending, observed = BigInt(report.anchor.timestamp);
  assert.equal(pending, expectedDigest); assert.ok(observed >= BigInt(readyAt)); assert.ok(observed <= BigInt(expiresAt));
  assert.equal(BigInt(expiresAt), BigInt(Date.parse("2026-11-26T19:50:06Z") / 1000));
  assert.equal(report.remainingToOwnerDeadlineSeconds, (BigInt(expiresAt)-observed).toString());
  assert.equal(report.state.nonce, "0"); assert.equal(report.state.signerSetEpoch, "1"); assert.equal(report.state.suspended, false);
  assert.equal(report.state.latestVersion, "0"); assert.equal(report.state.currentFactory.factory, "0x" + "0".repeat(40));
  assert.equal(report.state.factories[0], "0x" + "0".repeat(40)); assert.equal(report.state.factoryEngineVersion, "1");
  assert.equal(report.status, "PENDING_TIME_ELIGIBLE"); assert.equal(report.permissionlessPublicationRisk, true);
  assert.equal(report.deadlineInclusive, true);
  assert.ok(Math.abs(Date.parse(report.startedAt) - Number(observed) * 1000) <= 180000);
  assert.ok(Date.parse(report.finishedAt) >= Date.parse(report.startedAt));
  assert.ok(Date.parse(report.finishedAt) - Date.parse(report.startedAt) <= 180000);
  assert.equal(report.pendingWindow.executableAt, readyAt); assert.equal(report.pendingWindow.expiresAt, expiresAt);
  assert.equal(report.pendingWindow.remainingSeconds, report.remainingToOwnerDeadlineSeconds);
});
