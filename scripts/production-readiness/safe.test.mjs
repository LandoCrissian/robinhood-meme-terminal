import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { encodeSafeSetup } from "../../docs/evidence/rmt-task045/operations-safe-initializer.mjs";
import { summarizeGas, verifySafeCreation } from "./safe.mjs";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const viem = require("viem");
const evidence = new URL("../../docs/evidence/", import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, evidence)));
const { operations: { factory, owners, setup, singleton } } = load("rmt-task045/operations-safe-policy.json");
const registry = load("rmt-task044/safe-infrastructure-4663.json").registry.contracts["1.4.1"];
const { role, counterfactualAddress, saltNonce } = load("rmt-task046/treasury-safe-initializers.json").proposals[0];
const payer = owners[0];
const hash = viem.padHex("0x1039", { size: 32 });
const blockHash = viem.padHex("0x2001", { size: 32 });
const block = { number: "0x1234", hash: blockHash, timestamp: "0x694a3000" };
const functions = viem.parseAbi([
  "function masterCopy() view returns (address)",
  "function VERSION() view returns (string)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function getModulesPaginated(address start,uint256 pageSize) view returns (address[] array,address next)",
  "function getStorageAt(uint256 offset,uint256 length) view returns (bytes)",
  "function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns (address proxy)",
  "event ProxyCreation(address indexed proxy,address singleton)",
]);
const input = viem.encodeFunctionData({ abi: functions, functionName: "createProxyWithNonce",
  args: [singleton, encodeSafeSetup(viem, owners, setup), BigInt(saltNonce)] });
const log = {
  address: factory, transactionHash: hash, blockHash, blockNumber: block.number, transactionIndex: "0x0", logIndex: "0x1", removed: false,
  topics: viem.encodeEventTopics({ abi: functions, eventName: "ProxyCreation", args: { proxy: counterfactualAddress } }),
  data: viem.encodeAbiParameters([{ type: "address" }], [singleton]),
};
const receipt = { from: payer, to: factory, status: "0x1", transactionHash: hash, blockHash, blockNumber: block.number,
  transactionIndex: "0x0", contractAddress: null, logs: [log] };
const transaction = { from: payer, to: factory, hash, input, blockHash, blockNumber: block.number, transactionIndex: "0x0",
  value: "0x0", chainId: "0x1237" };
const chain = "0x1237";
const identity = (value) => value;
const proof = ({ receiptValue = receipt, txValue = transaction, head = block, state = {}, overridePins = {} } = {}) =>
  async (method, params, summarize = identity) => {
    const value = {
      eth_chainId: () => summarize(chain),
      eth_getTransactionReceipt: () => receiptValue,
      eth_getTransactionByHash: () => txValue,
      eth_getBlockByNumber: () => summarize(head),
      eth_getCode: () => ({
        [counterfactualAddress]: "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
        [factory]: registry.safe_proxy_factory.registryRuntimeKeccak256,
        [singleton]: registry.safe_l2.registryRuntimeKeccak256,
        [setup.fallbackHandler]: registry.compatibility_fallback_handler.registryRuntimeKeccak256,
        ...overridePins,
      })[params[0]],
      eth_call: () => {
        const { functionName, args } = viem.decodeFunctionData({ abi: functions, data: params[0].data });
        assert.equal(params[0].to, counterfactualAddress);
        assert.equal(params[1], block.number);
        const result = {
          masterCopy: singleton, VERSION: "1.4.1", getOwners: [...owners].reverse(), getThreshold: 2n, nonce: 0n,
          getModulesPaginated: [[], viem.padHex("0x01", { size: 20 })],
          getStorageAt: args?.[0] === BigInt(viem.keccak256(viem.stringToHex("fallback_manager.handler.address")))
            ? viem.padHex(setup.fallbackHandler, { size: 32 }) : viem.zeroHash, ...state,
        }[functionName];
        return summarize(viem.encodeFunctionResult({ abi: functions, functionName, result }));
      },
    }[method]();
    return { status: value === undefined || value === null ? "unavailable" : "observed", value };
  };
const verify = (main = {}, peer = {}, approvedPayer = payer) => verifySafeCreation({
  reader: proof(main), corroboratingReader: proof(peer), role, hash, approvedPayer,
});

test("Nitro L1 poster and L2 execution reconcile without double-counting parent gas", () => {
  const result = summarizeGas({ total: 700_000n, l1: 150_000n, baseFee: 200_000n, l1BaseFee: 1_000_000n, estimateGas: 700_007n });
  assert.equal(result.l2ExecutionWei, "110000000000");
  assert.equal(result.l1PosterWei, "30000000000");
  assert.equal(result.estimatedTotalWei, "140000000000");
  assert.equal(result.estimatedTotalEth, "0.00000014");
  assert.throws(() => summarizeGas({ total: 10n, l1: 11n, baseFee: 1n, l1BaseFee: 0n, estimateGas: 10n }), /Invalid Nitro gas/);
});

test("binds prospective Safe receipt, exact setup and two canonical L2 reads while leaving beneficiary and L1 open", async () => {
  const result = await verify();
  assert.equal(result.status, "L2_CREATION_VERIFIED");
  assert.equal(result.safe, counterfactualAddress);
  assert.equal(result.finality, "L1_UNVERIFIED");
  assert.equal(result.beneficiaryBinding, null);
  assert.equal(result.broadcastAuthorized, false);
});

test("rejects missing or mismatched receipts, wrong payer, altered salt, and duplicate creation logs", async () => {
  await assert.rejects(verify({ receiptValue: null }), /unavailable/);
  await assert.rejects(verify({ txValue: { ...transaction, chainId: "0x1" } }));
  await assert.rejects(verify({}, {}, owners[1]));
  await assert.rejects(verify({ txValue: { ...transaction, input: input.slice(0, -1) + (input.endsWith("0") ? "1" : "0") } }), /initializer or salt/);
  await assert.rejects(verify({ receiptValue: { ...receipt, logs: [log, log] } }), /one pinned-factory/);
  await assert.rejects(verify({ receiptValue: { ...receipt, logs: [{ ...log, removed: true }] } }));
});

test("reports no receipt acceptance on reorg, unsafe owner policy, nonce, or changed pinned infrastructure", async () => {
  await assert.rejects(verify({}, { head: { ...block, hash: hash } }), /reorged/);
  await assert.rejects(verify({}, { receiptValue: null }), /Corroborator/);
  await assert.rejects(verify({ state: { getThreshold: 1n } }), /configuration/);
  await assert.rejects(verify({ state: { nonce: 1n } }), /configuration/);
  await assert.rejects(verify({ state: { getModulesPaginated: [[payer], payer] } }), /configuration/);
  await assert.rejects(verify({ overridePins: { [singleton]: hash } }), /infrastructure/);
});
