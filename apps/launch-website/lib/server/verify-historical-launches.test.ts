import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbi, parseAbiParameters, type Hex } from "viem";
import { historicalAnchors, historicalSources, rpcPeer, verifyHistoricalLaunches, verifyHistoricalReceipt } from "./verify-historical-launches";

const anchor = historicalAnchors[0];
const blockHash = ("0x" + "11".repeat(32)) as Hex;
const poolId = ("0x" + "22".repeat(32)) as Hex;
const creator = ("0x" + "33".repeat(20)) as Hex;
const vault = ("0x" + "44".repeat(20)) as Hex;
const factory = historicalSources[4].factory;
const block = {
  number: ("0x" + Number(anchor.blockNumber).toString(16)) as Hex,
  hash: blockHash,
  timestamp: "0x6a552f98",
};
const abi = parseAbi(["event TokenLaunched(uint256 indexed launchId,address indexed token,address indexed creator,address market,address rewardVault,bytes32 graduationPoolId,string name,string symbol,string metadataURI,uint16[5] rewardBps)"]);
const params = parseAbiParameters("address,address,bytes32,string,string,string,uint16[5]");

function fixture(token: Hex = anchor.token, name = "Verified Anchor") {
  const log = {
    address: factory,
    blockNumber: block.number,
    blockHash,
    transactionHash: anchor.transactionHash,
    logIndex: "0x8",
    removed: false,
    topics: encodeEventTopics({ abi, eventName: "TokenLaunched", args: { launchId: 0n, token, creator } }),
    data: encodeAbiParameters(params, [anchor.market, vault, poolId, name, "ANCHOR", "", [7_000, 0, 0, 0, 3_000]]),
  };
  return {
    status: "0x1",
    to: factory,
    blockNumber: block.number,
    blockHash,
    transactionHash: anchor.transactionHash,
    logs: [log],
  };
}

test("public historical evidence uses the exact registered token, label, and receipt", () => {
  const { launch } = verifyHistoricalReceipt(fixture(), block, anchor);
  assert.equal(launch.kind, "historical-rmt");
  assert.equal(launch.token, anchor.token);
  assert.equal(launch.market, anchor.market);
  assert.equal(launch.classification, "deployment-test");
  assert.equal(launch.receipt.blockHash, blockHash);
  assert.equal(launch.receipt.logIndex, 8);
  assert.equal(launch.receipt.timestamp, "2026-07-13T18:34:00.000Z");
  assert.equal(launch.lifecycle, "unknown");
  assert.equal(launch.reservedPoolId, poolId);
});

test("rejects missing, reverted, and noncanonical receipts", () => {
  assert.throws(() => verifyHistoricalReceipt(null, block, anchor), /receipt unavailable/);
  assert.throws(() => verifyHistoricalReceipt(fixture(), null, anchor), /Block unavailable/);
  assert.throws(() => verifyHistoricalReceipt({ ...fixture(), status: "0x0" }, block, anchor), /receipt identity or status/);
  assert.throws(() => verifyHistoricalReceipt(fixture(), { ...block, hash: poolId }, anchor), /receipt identity or status/);
});

test("rejects a same-name token from the wrong address and an event from the wrong factory", () => {
  assert.throws(() => verifyHistoricalReceipt(fixture(creator), block, anchor), /pinned launch registration/);
  const receipt = fixture();
  receipt.logs[0].address = historicalSources[6].factory as typeof factory;
  assert.throws(() => verifyHistoricalReceipt(receipt, block, anchor), /canonical factory/);
});

test("rejects duplicate, removed, and receipt-unbound log data", () => {
  const receipt = fixture();
  assert.throws(() => verifyHistoricalReceipt({ ...receipt, logs: [...receipt.logs, ...receipt.logs] }, block, anchor), /exactly one/);
  receipt.logs[0].removed = true;
  assert.throws(() => verifyHistoricalReceipt(receipt, block, anchor), /not bound/);
  receipt.logs[0].removed = false;
  receipt.logs[0].blockHash = poolId;
  assert.throws(() => verifyHistoricalReceipt(receipt, block, anchor), /not bound/);
});

test("does not accept poisoned Unicode metadata or truncated ABI event data", () => {
  assert.throws(() => verifyHistoricalReceipt(fixture(anchor.token, "Launch\u202e"), block, anchor), /display metadata/);
  const receipt = fixture();
  receipt.logs[0].data = "0x11";
  assert.throws(() => verifyHistoricalReceipt(receipt, block, anchor));
});

test("an RPC chain mismatch and duplicate identity do not silently fail over", async () => {
  const correct = { host: "a.example", read: async () => "0x1237" };
  const wrong = { host: "b.example", read: async () => "0x1" };
  await assert.rejects(verifyHistoricalLaunches(undefined, [correct, wrong]), /Unexpected RPC chain/);
  await assert.rejects(verifyHistoricalLaunches(undefined, [correct, correct]), /Independent RPC hostnames/);
});

test("RPC body is bounded and an HTTP rate limit is represented as failure", async () => {
  const url = "https://rpc.mainnet.chain.robinhood.com";
  const tooLarge = (async () => new Response(" ".repeat(262_145))) as typeof fetch;
  await assert.rejects(rpcPeer(url, tooLarge).read("eth_chainId", []), /size limit/);
  const limited = (async () => new Response("Rate limited", { status: 429 })) as typeof fetch;
  await assert.rejects(rpcPeer(url, limited).read("eth_chainId", []), /RPC HTTP failure/);
});

test("injection of wrong JSON-RPC message ID fails closed", async () => {
  const badId = (async () => Response.json({ jsonrpc: "2.0", id: 2, result: "0x1237" })) as typeof fetch;
  await assert.rejects(
    rpcPeer("https://rpc.mainnet.chain.robinhood.com", badId).read("eth_chainId", []),
    /Invalid JSON-RPC envelope/,
  );
});
