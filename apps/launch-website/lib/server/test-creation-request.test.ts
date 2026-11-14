import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, parseAbi, type Address } from "viem";
import { calldataMatchesTestCreation, isLocalTestWallet, isTestCreationRequest,
  sameTestCreationRequest, testCreationChain, testCreationFeeWei, testCreationSignature,
  type TestCreationFields, type TestCreationRequest } from "../test-creation";

const account: Address = "0x" + "11".repeat(20) as Address;
const factory: Address = "0x" + "22".repeat(20) as Address;
const treasury: Address = "0x" + "33".repeat(20) as Address;
const deadline = "1783776000";
const intentId = "0x" + "aa".repeat(32) as `0x${string}`;
const blockHash = "0x" + "bb".repeat(32) as `0x${string}`;
const fields: TestCreationFields = { name: "Fixture token", symbol: "FIX", supplyPreset: 1,
  projectURI: "https://example.test/project", treasury, treasuryShareBps: 1234 };
const data = encodeFunctionData({
  abi: parseAbi([testCreationSignature]), functionName: "create",
  args: [fields.name, fields.symbol, fields.projectURI, fields.supplyPreset, treasury,
    fields.treasuryShareBps, intentId, BigInt(deadline)],
});
const request: TestCreationRequest = {
  from: account, to: factory, data, value: `0x${testCreationFeeWei.toString(16)}`,
  chainId: testCreationChain, deadline, intentId, blockHash, blockNumber: "0x123",
};

test("binds reviewed test calldata to each committed field and creator", async () => {
  assert.equal(await calldataMatchesTestCreation(request, fields), true);
  for (const changed of [
    { name: "Other token" }, { symbol: "BAD" }, { projectURI: "https://example.test/other" },
    { supplyPreset: 0 }, { treasury: account }, { treasury: "" }, { treasuryShareBps: 1235 },
  ]) {
    assert.equal(await calldataMatchesTestCreation(request, { ...fields, ...changed }), false);
  }
  assert.equal(await calldataMatchesTestCreation({ ...request, from: treasury }, fields), false);
  assert.equal(await calldataMatchesTestCreation({ ...request, deadline: "1783776001" }, fields), false);
  assert.equal(await calldataMatchesTestCreation({ ...request, intentId: blockHash }, fields), false);
});

test("tests exact execution request format, fee, chain, and stable review", () => {
  assert.equal(isTestCreationRequest(request), true);
  assert.equal(sameTestCreationRequest(request, { ...request }), true);
  assert.equal(sameTestCreationRequest(request, { ...request, blockHash: intentId }), false);
  assert.equal(sameTestCreationRequest(request, { ...request, to: treasury }), false);
  assert.equal(isTestCreationRequest({ ...request, chainId: "0x1237" }), false);
  assert.equal(isTestCreationRequest({ ...request, value: "0x1" }), false);
  assert.equal(isTestCreationRequest({ ...request, deadline: "0" }), false);
  assert.equal(isTestCreationRequest({ ...request, data: "0x0" }), false);
});

test("requires an exact HTTP loopback origin and explicit port for the test wallet", () => {
  assert.equal(isLocalTestWallet(new URL("http://127.0.0.1:3225/")), true);
  assert.equal(isLocalTestWallet(new URL("http://127.0.0.1/")), false);
  assert.equal(isLocalTestWallet(new URL("http://localhost:3225/")), false);
  assert.equal(isLocalTestWallet(new URL("https://127.0.0.1:3225/")), false);
  assert.equal(isLocalTestWallet(new URL("https://example.test:3225/")), false);
});
