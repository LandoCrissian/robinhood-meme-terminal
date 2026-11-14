import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, zeroAddress, type Address, type Hash } from "viem";
import { curveCreationAbi, readCurveLaunchRegistration, type CurveEvidenceRpc, type CurveLaunchBinding } from "./curve-launch-evidence.js";
import { historicalFactory } from "./historical-launches.js";

const address = (id: number): Address => `0x${id.toString(16).padStart(40, "0")}`;
const hash = (id: number): Hash => `0x${id.toString(16).padStart(64, "0")}`;
const factory = address(1);
const registry = address(2);
const operator = address(3);
const token = address(4);
const curve = address(5);
const creator = address(6);
const revenueLedger = address(7);
const treasury = address(8);
const transactionHash = hash(90);
const intent = hash(95);
const factoryCode = "0x6001";
const registryCode = "0x6002";
const deploymentBlock = 100n;
const blockNumber = 108n;
const tip = 130n;
const blockHash = hash(Number(blockNumber));
const timestamp = 1_795_000_000n;
const fee = 400_000_000_000_000n;
const supply = 10_000_000n * 10n ** 18n;
const binding: CurveLaunchBinding = {
  chainId: 4663, engineVersion: 1, deploymentBlock, deploymentBlockHash: hash(Number(deploymentBlock)),
  factory, factoryRuntimeHash: keccak256(factoryCode), projectRegistry: registry,
  projectRegistryRuntimeHash: keccak256(registryCode), creationFeeWei: fee, creationFeeRecipient: operator,
  confirmations: 20,
};
const eventRef = { blockNumber, blockHash, transactionHash, logIndex: 5 };

function fixtureTopics(params: Parameters<typeof encodeEventTopics<typeof curveCreationAbi>>[0]): [Hash, ...Hash[]] {
  const [selector, ...indexed] = encodeEventTopics(params);
  assert.ok(indexed.every((topic) => typeof topic === "string"));
  return [selector, ...indexed];
}

const event = { blockNumber, blockHash, transactionHash, transactionIndex: 3, removed: false };
const baseReceipt: Awaited<ReturnType<CurveEvidenceRpc["getTransactionReceipt"]>> = {
  blockNumber, blockHash, transactionHash, transactionIndex: 3, status: "success", from: creator, to: factory,
  logs: [
    {
      ...event, address: registry, logIndex: 4, topics: fixtureTopics({
        abi: curveCreationAbi, eventName: "ProjectRegistered", args: { token, factory, curve },
      }),
      data: encodeAbiParameters([{ type: "uint32" }], [1]),
    },
    {
      ...event, address: factory, logIndex: 5, topics: fixtureTopics({
        abi: curveCreationAbi, eventName: "CurveCreated", args: { token, curve, creator },
      }),
      data: encodeAbiParameters([
        { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" },
        { type: "uint16" }, { type: "string" }, { type: "string" }, { type: "string" },
      ], [intent, supply, revenueLedger, treasury, 2_000, "Project", "TEST", "ipfs://untrusted"]),
    },
    {
      ...event, address: factory, logIndex: 6, topics: fixtureTopics({
        abi: curveCreationAbi, eventName: "CreationFeePaid", args: { token, creator, recipient: operator },
      }),
      data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [fee, 5n]),
    },
    // ERC-20 mint logs may contain a valid all-zero topic.
    { ...event, address: token, logIndex: 1, topics: [hash(0)], data: "0x" },
  ],
};
const receipt = () => structuredClone(baseReceipt);
const tx = {
  hash: transactionHash, blockNumber, blockHash, transactionIndex: 3, from: creator, to: factory,
  value: fee + 5n,
  input: encodeFunctionData({
    abi: curveCreationAbi, functionName: "create",
    args: ["Project", "TEST", "ipfs://untrusted", 1, treasury, 2_000, intent, timestamp + blockNumber],
  }),
};
const block: CurveEvidenceRpc["getBlock"] = async ({ blockNumber: number }) => ({
  number, hash: hash(Number(number)), timestamp: timestamp + number,
  transactions: number === blockNumber ? [hash(80), hash(81), hash(82), transactionHash] : [],
});
const providers: CurveEvidenceRpc = {
  getChainId: async () => 4663,
  getBlockNumber: async () => tip,
  getBlock: block,
  getCode: async ({ address, blockNumber }) => {
    if (address === registry) return registryCode;
    assert.equal(address, factory);
    return blockNumber < deploymentBlock ? undefined : factoryCode;
  },
  getTransactionReceipt: async ({ hash }) => { assert.equal(hash, transactionHash); return receipt(); },
  getTransaction: async ({ hash }) => { assert.equal(hash, transactionHash); return tx; },
  readContract: async ({ address, blockNumber: at, functionName }) => {
    assert.equal(at, blockNumber);
    assert.equal(address, factory);
    return { engineVersion: 1, projectRegistry: registry, creationFeeWei: fee, operatingRecipient: operator }[functionName];
  },
};

export async function testCurveLaunchEvidence() {
  const forbidden = new Proxy(providers, { get() { throw new Error("disabled sources must perform zero reads"); } });
  assert.equal(await readCurveLaunchRegistration(null, forbidden, eventRef), null);
  await assert.rejects(readCurveLaunchRegistration({ ...binding, confirmations: 19 }, forbidden, eventRef),
    /deployment binding/);
  await assert.rejects(readCurveLaunchRegistration({ ...binding, factory: historicalFactory }, forbidden, eventRef),
    /deployment binding/);
  await assert.rejects(readCurveLaunchRegistration(binding, forbidden, { ...eventRef, blockNumber: 99n }),
    /creation event reference/);
  await assert.rejects(readCurveLaunchRegistration(binding, {
    ...providers, getChainId: async () => 31337,
    getBlockNumber: async () => { throw new Error("wrong chain must not proceed"); },
  }, eventRef), /chain ID/);

  const verified = await readCurveLaunchRegistration(binding, providers, eventRef);
  assert.ok(verified);
  assert.deepEqual({
    kind: verified.kind, lifecycle: verified.status, chainId: verified.chainId, engineVersion: verified.engineVersion,
    factory: verified.factory, registry: verified.projectRegistry, token: verified.token, initialCurve: verified.initialCurve,
    creator: verified.creator, totalSupplyWei: verified.totalSupplyWei, registration: verified.projectRegistrationLogIndex,
    receipt: verified.creation, funding: verified.creationFee, checkpoint: verified.checkpoint,
  }, {
    kind: "curve-launch-v1", lifecycle: "created", chainId: 4663, engineVersion: 1, factory, registry, token, initialCurve: curve,
    creator, totalSupplyWei: supply.toString(), registration: 4,
    receipt: { blockNumber: "108", blockHash, timestamp: new Date(Number(timestamp + blockNumber) * 1000).toISOString(),
      transactionHash, logIndex: 5 },
    funding: { amountWei: fee.toString(), recipient: operator, refundWei: "5", logIndex: 6 },
    checkpoint: { blockNumber: "110", blockHash: hash(110), timestamp: new Date(Number(timestamp + 110n) * 1000).toISOString(),
      confirmations: 20, finality: "l2-confirmed", l1Finality: "unverified" },
  });
  assert.deepEqual(await readCurveLaunchRegistration(binding, providers, eventRef), verified, "replay projects same identity");

  const rpcOverrides: Array<[string, Partial<CurveEvidenceRpc>, RegExp]> = [
    ["insufficient depth", { getBlockNumber: async () => blockNumber + 19n }, /insufficient L2/],
    ["old deployment block", { getCode: async () => factoryCode }, /deployment or runtime/],
    ["substituted registry", { getCode: async (params) => params.address === registry ? "0x6003" : providers.getCode(params) },
      /deployment or runtime/],
    ["unexpected protocol", { readContract: async (params) => params.functionName === "engineVersion" ? 6 : providers.readContract(params) },
      /factory protocol binding/],
    ["different recipient", { readContract: async (params) => params.functionName === "operatingRecipient" ? zeroAddress : providers.readContract(params) },
      /factory protocol binding/],
    ["unknown receipt", { getTransactionReceipt: async () => { throw new Error("receipt unavailable"); } }, /receipt unavailable/],
    ["reverted receipt", { getTransactionReceipt: async () => ({ ...receipt(), status: "reverted" }) }, /unsuccessful receipt/],
    ["wrong transaction value", { getTransaction: async () => ({ ...tx, value: fee }) }, /creation fee mismatch/],
    ["wrong transaction sender", { getTransaction: async () => ({ ...tx, from: operator }) }, /unbound creation transaction/],
    ["expired creation tx", { getTransaction: async () => ({ ...tx, input: encodeFunctionData({
      abi: curveCreationAbi, functionName: "create",
      args: ["Project", "TEST", "ipfs://untrusted", 1, treasury, 2_000, intent, timestamp],
    }) }) }, /creation calldata mismatch/],
    ["wrong canonical block", { getBlock: async (params) => ({ ...await block(params), hash: hash(99) }) }, /block mismatch/],
    ["transaction missing from canonical block", { getBlock: async (params) => ({ ...await block(params), transactions: [] }) },
      /unbound or unsuccessful receipt/],
    ["noncanonical deployment", { getBlock: async (params) => params.blockNumber === deploymentBlock
      ? { ...await block(params), hash: hash(99) } : block(params) }, /block mismatch/],
    ["corrupted fee event", { getTransactionReceipt: async () => {
      const r = receipt();
      r.logs[2]!.data = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [fee - 1n, 6n]);
      return r;
    } }, /creation fee mismatch/],
    ["spoofed event factory", { getTransactionReceipt: async () => {
      const r = receipt();
      r.logs[1]!.address = historicalFactory;
      return r;
    } }, /expected one indexed event/],
    ["ambiguous creation events", { getTransactionReceipt: async () => {
      const r = receipt();
      r.logs.push({ ...r.logs[1]!, logIndex: 200 });
      return r;
    } }, /expected one indexed event/],
    ["spoofed project registry", { getTransactionReceipt: async () => {
      const r = receipt();
      r.logs[0]!.address = address(9);
      return r;
    } }, /expected one indexed event/],
    ["removed event", { getTransactionReceipt: async () => {
      const r = receipt();
      r.logs[1]!.removed = true;
      return r;
    } }, /malformed, removed or duplicate/],
    ["log from a different transaction", { getTransactionReceipt: async () => {
      const r = receipt();
      r.logs[1]!.transactionHash = hash(99);
      return r;
    } }, /malformed, removed or duplicate/],
  ];

  for (const [label, overrides, expected] of rpcOverrides) {
    await assert.rejects(readCurveLaunchRegistration(binding, { ...providers, ...overrides }, eventRef), expected, label);
  }
  await assert.rejects(readCurveLaunchRegistration(binding, providers, { ...eventRef, logIndex: 6 }), /event identities/);
  let checkpointReads = 0;
  await assert.rejects(readCurveLaunchRegistration(binding, {
    ...providers,
    getBlock: async (params) => params.blockNumber === tip - 20n && ++checkpointReads > 1
      ? { ...await block(params), hash: hash(99) } : block(params),
  }, eventRef), /canonical checkpoint changed/);
}
