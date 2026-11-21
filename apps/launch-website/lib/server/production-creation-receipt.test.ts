import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi, parseAbiParameters, type Hex } from "viem";
import { artworkCID, artworkOrigin, assetPath, receiptForImage } from "../token-artwork";
import { productionCreationAbi, productionCreationFactory, type ProductionCreationRequest } from "../production-creation";
import { launchTokenSupplyWei } from "../launch-terms";
import { curveProductionDeployment, curveProductionPins } from "./curve-production";
import { verifyCanonicalCurveCreation } from "./test-creation";

// Synthetic receipt/provider fixtures exercise decoding and recovery. They are
// neither real mainnet transactions nor a claim of physical wallet acceptance.
const hash = (digit: string) => `0x${digit.repeat(64)}` as Hex;
const token = "0x2222222222222222222222222222222222222222";
const curve = "0x3333333333333333333333333333333333333333";
const ledger = "0x4444444444444444444444444444444444444444";
const owner = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA";
const zero = "0x0000000000000000000000000000000000000000";
const txHash = hash("a"); const blockHash = hash("b"); const blockNumber = 116835400n;
const name = "Owner Token"; const symbol = "OWNER"; const uri = receiptForImage(artworkOrigin + assetPath(artworkCID(new TextEncoder().encode("receipt fixture")),"image.webp")).projectURI;
const events = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event ProjectRegistered(address indexed token,address indexed factory,address indexed curve,uint32 version)",
  "event CurveCreated(address indexed token,address indexed curve,address indexed creator,bytes32 intentId,uint256 supply,address revenueLedger,address treasury,uint16 treasuryShareBps,string name,string symbol,string projectURI)",
  "event CreationFeePaid(address indexed token,address indexed creator,address indexed recipient,uint256 fee,uint256 refund)",
]);

function setup(options: { wrongArtwork?: boolean; reverted?: boolean; wrongNonce?: boolean; wrongChain?: boolean; reorg?: boolean; laterTrade?: boolean; indexed?: boolean;
  missingReceipt?: boolean; duplicateRecovery?: boolean; malformedMint?: boolean } = {}) {
  const request: ProductionCreationRequest = { from: owner, to: productionCreationFactory, chainId: "0x1237", intentId: hash("c"),
    deadline: "1794935300", blockNumber: "0x6f6c3e0", blockHash: hash("d"), nonce: "0x1e3", value: "0x16bcc41e90000",
    data: encodeFunctionData({ abi: productionCreationAbi, functionName: "create", args: [name, symbol, uri, zero, 0, hash("c"), 1794935300n] }) };
  const base = { transactionHash: txHash, blockHash, blockNumber, transactionIndex: 0, removed: false };
  const logs = [
    { ...base, logIndex: 0, address: token,
      topics: encodeEventTopics({ abi: events, eventName: "Transfer", args: { from: zero, to: productionCreationFactory } }),
      data: encodeAbiParameters(parseAbiParameters("uint256"), [options.malformedMint ? 1n : launchTokenSupplyWei]) },
    { ...base, logIndex: 1, address: token,
      topics: encodeEventTopics({ abi: events, eventName: "Transfer", args: { from: productionCreationFactory, to: curve } }),
      data: encodeAbiParameters(parseAbiParameters("uint256"), [launchTokenSupplyWei]) },
    { ...base, logIndex: 2, address: curveProductionPins.registry[0],
      topics: encodeEventTopics({ abi: events, eventName: "ProjectRegistered", args: { token, factory: productionCreationFactory, curve } }),
      data: encodeAbiParameters(parseAbiParameters("uint32"), [1]) },
    { ...base, logIndex: 3, address: productionCreationFactory,
      topics: encodeEventTopics({ abi: events, eventName: "CurveCreated", args: { token, curve, creator: owner } }),
      data: encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,address,uint16,string,string,string"),
        [hash("c"), launchTokenSupplyWei, ledger, zero, 0, name, symbol, options.wrongArtwork ? "" : uri]) },
    { ...base, logIndex: 4, address: productionCreationFactory,
      topics: encodeEventTopics({ abi: events, eventName: "CreationFeePaid", args: { token, creator: owner, recipient: curveProductionDeployment.operating } }),
      data: encodeAbiParameters(parseAbiParameters("uint256,uint256"), [curveProductionDeployment.creationFeeWei, 0n]) },
  ];
  const receipt = { ...base, from: owner, to: productionCreationFactory, status: options.reverted ? "reverted" : "success", logs };
  const block = { number: blockNumber, hash: options.reorg ? hash("e") : blockHash, timestamp: 1794935200n, transactions: [txHash] };
  const rpc = {
    async getTransaction() { return { hash: txHash, from: owner, to: productionCreationFactory, input: request.data,
      value: curveProductionDeployment.creationFeeWei, chainId: options.wrongChain ? 31337 : 4663,
      nonce: options.wrongNonce ? 484 : 483, blockNumber, blockHash, transactionIndex: 0 }; },
    async getTransactionReceipt() { if (options.missingReceipt) throw new Error("Receipt unavailable"); return receipt; },
    async getBlock() { return block; },
    async getLogs() { return options.duplicateRecovery ? [base, base] : [base]; },
    async readContract({ functionName }: { functionName: string }) {
      const values: Record<string, unknown> = { tokenForIntent: token, originCurveForToken: curve, factory: productionCreationFactory,
        token, creator: owner, treasury: zero, treasuryShareBps: 0, revenueLedger: ledger,
        totalSupply: launchTokenSupplyWei, FIXED_SUPPLY: launchTokenSupplyWei, decimals: 18, name, symbol,
        sold: options.laterTrade ? 1n : 0n, backingReserve: options.laterTrade ? 1n : 0n,
        balanceOf: options.laterTrade ? launchTokenSupplyWei - 1n : launchTokenSupplyWei, GRADUATION_BACKING: 2n * 10n ** 18n };
      assert.ok(Object.hasOwn(values, functionName), functionName); return values[functionName];
    },
  };
  const input: Parameters<typeof verifyCanonicalCurveCreation>[0] = { deployment: { factory: productionCreationFactory, registry: curveProductionPins.registry[0],
    deploymentBlock: curveProductionDeployment.blockNumber, feeRecipient: curveProductionDeployment.operating }, chainId: 4663 as const,
    request, transactionHash: txHash, rpc: rpc as unknown as Parameters<typeof verifyCanonicalCurveCreation>[0]["rpc"],
    head: { ...block, number: blockNumber + 100n } as unknown as Parameters<typeof verifyCanonicalCurveCreation>[0]["head"],
    readIndexed: async () => options.indexed ?? false };
  return input;
}

test("synthetic 4663 creation receipt binds exact form calldata, nonce, minted supply, initial inventory, registry and fee evidence", async () => {
  const response = await verifyCanonicalCurveCreation(setup());
  assert.deepEqual(await response.json(), { status: "confirmed", transactionHash: txHash, token, indexed: false });
  const indexed = await verifyCanonicalCurveCreation(setup({ indexed: true }));
  assert.equal((await indexed.json()).indexed, true);
  const sameBlockTrade = await verifyCanonicalCurveCreation(setup({ laterTrade: true }));
  assert.equal((await sameBlockTrade.json()).status, "confirmed", "Receipt opening evidence is distinct from block-close balances");
});

test("missing-hash recovery reuses the original intent and canonical receipt without submitting", async () => {
  const response = await verifyCanonicalCurveCreation({ ...setup(), transactionHash: undefined });
  assert.equal((await response.json()).transactionHash, txHash);
  const duplicate = await verifyCanonicalCurveCreation({ ...setup({ duplicateRecovery: true }), transactionHash: undefined });
  assert.equal((await duplicate.json()).status, "unavailable");
});

test("chain, nonce, reorg, interrupted receipt and malformed mint evidence fail closed", async () => {
  for (const options of [{ wrongArtwork: true }, { wrongChain: true }, { wrongNonce: true }, { reorg: true }, { malformedMint: true }]) {
    assert.equal((await (await verifyCanonicalCurveCreation(setup(options))).json()).status, "unavailable");
  }
  await assert.rejects(verifyCanonicalCurveCreation(setup({ missingReceipt: true })), /Receipt unavailable/);
});

test("reverted creation retains the original metadata-bound request for recovery", async () => {
  const input = setup({reverted:true});
  const original = input.request.data;
  assert.equal((await (await verifyCanonicalCurveCreation(input)).json()).status,"reverted");
  assert.equal(input.request.data,original);
});
