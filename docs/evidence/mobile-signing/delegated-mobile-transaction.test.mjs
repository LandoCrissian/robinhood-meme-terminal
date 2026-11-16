import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { mobilePayer } from "../../../packages/contracts/scripts/mobile-review-plan.mjs";
import { buildLoopbackType2Envelope, verifyDirectType2Outcome } from "../../../packages/contracts/scripts/delegated-mobile-transaction.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { getContractAddress } = require("viem");
const dataHash = "0x" + "11".repeat(32);
const hash = "0x" + "22".repeat(32);
const blockHash = "0x" + "33".repeat(32);
const safeFactory = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const nonce = "475";
const expectedAddress = getContractAddress({ from: mobilePayer, nonce: BigInt(nonce) });
const review = { sender: mobilePayer, to: null, nonce, valueWei: "0", dataHash, expectedAddress };
const observed = {
  chainId: 4663, type: "eip1559", from: mobilePayer, to: null, contractAddress: expectedAddress, nonce, valueWei: "0",
  accessList: [], gas: "1000000", gasUsed: "925000", maxFeePerGas: "25000000", maxPriorityFeePerGas: "1000000",
  effectiveGasPrice: "21000000", calldataHash: dataHash, transactionHash: hash, blockHash,
  blockNumber: "114549455", status: "success",
};

test("the loopback type-2 formatter emits an ordinary call or top-level CREATE without authorization", () => {
  const input = { endpoint: "http://127.0.0.1:8545/", chainId: 4663, from: mobilePayer, to: null,
    data: "0x6000", nonce: 475, value: 0n, gas: 90_000n, maxFeePerGas: 25_000_000n, maxPriorityFeePerGas: 0n };
  const creation = { type: "0x2", chainId: "0x1237", from: mobilePayer, data: "0x6000", nonce: "0x1db", value: "0x0",
    gas: "0x15f90", maxFeePerGas: "0x17d7840", maxPriorityFeePerGas: "0x0" };
  assert.deepEqual(buildLoopbackType2Envelope(input), creation);
  assert.deepEqual(buildLoopbackType2Envelope({ ...input, to: safeFactory }), { ...creation, to: safeFactory });
  for (const mutation of [
    { endpoint: "https://rpc.mainnet.chain.robinhood.com/" }, { endpoint: "http://127.0.0.1:8545/relay" },
    { endpoint: "http://localhost:8545/" }, { chainId: 31337 }, { nonce: "18446744073709551615" },
    { from: "0x0000000000000000000000000000000000000000" }, { gas: "0" }, { value: -1n }, { maxPriorityFeePerGas: 25_000_001n },
    { data: "0x1" }, { data: "0x" }, { data: "0x" + "00".repeat(49_153) },
    { authorizationList: [] }, { accessList: [] }, { paymaster: safeFactory },
  ]) assert.throws(() => buildLoopbackType2Envelope({ ...input, ...mutation }));
});

test("type 2 top-level CREATE binds the exact observed sender, nonce, type, input and derived receipt address", () => {
  assert.deepEqual(verifyDirectType2Outcome(observed, review), {
    transactionHash: hash, blockNumber: observed.blockNumber, blockHash, gasLimit: "1000000", gasUsed: "925000",
    status: "success", effectiveGasPriceWei: "21000000", maxFeePerGasWei: "25000000", maxPriorityFeePerGasWei: "1000000",
  });
  assert.ok(verifyDirectType2Outcome({ ...observed, to: safeFactory, contractAddress: null }, { ...review, to: safeFactory }));
  const reverted = { ...observed, status: "reverted", codeAfter: "0x" };
  assert.ok(verifyDirectType2Outcome(reverted, { ...review, expectedStatus: "reverted" }));
  assert.ok(verifyDirectType2Outcome({ ...reverted, contractAddress: null }, { ...review, expectedStatus: "reverted" }));
});

test("type 4, an authorization list, a different chain, destination, sender or nonce all fail closed", () => {
  for (const mutation of [
    { type: "eip7702", authorizationList: [] }, { authorizationList: [] }, { accessList: [{ address: expectedAddress, storageKeys: [] }] },
    { chainId: 31337 }, { from: safeFactory }, { to: mobilePayer }, { to: expectedAddress }, { nonce: "476" }, { nonce: "0475" },
    { nonce: Number.MAX_SAFE_INTEGER + 1 }, { valueWei: "1" }, { calldataHash: blockHash }, { contractAddress: safeFactory },
    { gasUsed: "1000001" }, { maxFeePerGas: "1" }, { effectiveGasPrice: "0" }, { blockNumber: "0" },
    { blockHash: "invalid" }, { transactionHash: null }, { status: "reverted" },
  ]) assert.throws(() => verifyDirectType2Outcome({ ...observed, ...mutation }, review), JSON.stringify(mutation));
  assert.throws(() => verifyDirectType2Outcome({ ...observed, status: "reverted" }, { ...review, expectedStatus: "reverted" }));
  assert.throws(() => verifyDirectType2Outcome({ ...observed, to: safeFactory }, { ...review, to: safeFactory }));
});
