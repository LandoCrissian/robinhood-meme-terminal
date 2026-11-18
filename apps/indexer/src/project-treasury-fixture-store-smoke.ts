import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, parseAbi, zeroAddress, zeroHash,
  type Address, type Hash, type PublicClient } from "viem";
import type { Client } from "pg";
import { materializeProjectTreasuryRuntime, projectTreasuryFactorySignatures, projectTreasurySignatures }
  from "../../../packages/launchpad-common/project-treasury-runtime.mjs";
import { assertFixtureTreasuryReceiptLog, readProjectTreasuryFixtureRange, verifyFixtureTreasuryBirth,
  type FixtureTreasuryModule, type FixtureTreasuryProofLog } from "./project-treasury-fixture-store.js";

const a = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;
const at = (n: number) => ({ blockNumber: String(n), blockHash: h(n), timestamp: new Date((1_700_000_000 + n) * 1000).toISOString() });

export async function testProjectTreasuryFixtureStoreProofs() {
  const factoryAbi = parseAbi(projectTreasuryFactorySignatures), treasuryAbi = parseAbi(projectTreasurySignatures);
  const creator = a(100001), controller = a(100002), treasury = a(100003), intent = h(500), creationHash = h(501), fundingHash = h(502);
  const m: FixtureTreasuryModule = { schemaVersion: 1, profile: "rmt-project-treasury-v1", chainId: 31337,
    treasuryFactory: a(100004), factoryRuntimeHash: h(100), coreFactory: a(100005), coreFactoryRuntimeHash: h(101),
    graduationEngine: a(100006), graduationRuntimeHash: h(102), tokenRuntimeHash: h(103),
    treasuryCreationCode: "0x6000", treasuryCreationCodeHash: keccak256("0x6000"), treasuryRuntimeTemplate: `0x${"00".repeat(160)}`,
    treasuryImmutableReferences: { "1": [{ start: 0, length: 32 }], "2": [{ start: 32, length: 32 }], "3": [{ start: 64, length: 32 }], "4": [{ start: 96, length: 32 }], "5": [{ start: 128, length: 32 }] },
    treasuryImmutableNames: { "1": "creator", "2": "deploymentFactory", "3": "intentId", "4": "treasuryShareBps", "5": "deploymentChainId" },
    deployment: { transactionHash: h(499), blockNumber: "2", blockHash: h(2) }, compilerInputSha256: "a".repeat(64) };
  const runtime = materializeProjectTreasuryRuntime(m.treasuryRuntimeTemplate, m.treasuryImmutableReferences, m.treasuryImmutableNames,
    { creator, deploymentFactory: m.treasuryFactory, intentId: intent, treasuryShareBps: 2250, deploymentChainId: 31337 });
  const creation: FixtureTreasuryProofLog = { address: m.treasuryFactory,
    topics: encodeEventTopics({ abi: factoryAbi, eventName: "TreasuryCreated", args: { creator, intentId: intent, treasury } }) as Hash[],
    data: encodeAbiParameters([{ type: "address" }, { type: "uint16" }], [controller, 2250]),
    transactionHash: creationHash, transactionIndex: 0, logIndex: 0, blockNumber: 3n, blockHash: h(3), removed: false };
  const funding: FixtureTreasuryProofLog = { address: treasury,
    topics: encodeEventTopics({ abi: treasuryAbi, eventName: "FundingReceived", args: { asset: zeroAddress, sender: creator } }) as Hash[],
    data: encodeAbiParameters([{ type: "uint8" }, { type: "uint256" }, { type: "bytes32" }], [1, 17n, zeroHash]),
    transactionHash: fundingHash, transactionIndex: 0, logIndex: 0, blockNumber: 4n, blockHash: h(4), removed: false };
  const transaction = { hash: creationHash, from: creator, to: m.treasuryFactory, value: 0n, chainId: 31337, blockNumber: 3n,
    blockHash: h(3), transactionIndex: 0, input: encodeFunctionData({ abi: factoryAbi, functionName: "create", args: [intent, controller, 2250, m.treasuryCreationCode] }) };
  const knobs = { mode: "", phase: "birth", receipts: 0, headers: 0, secondFunding: false };
  const receipt = (birth: boolean) => {
    const height = birth ? 3n : 4n, hash = birth ? creationHash : fundingHash;
    let logs = birth ? [creation] : [funding, ...(knobs.secondFunding ? [{ ...funding, logIndex: 1 }] : [])];
    if (knobs.mode === "missing-log") logs = [];
    if (knobs.mode === "topics") logs = logs.map(l => ({ ...l, topics: [h(999), ...l.topics.slice(1)] }));
    if (knobs.mode === "data") logs = logs.map(l => ({ ...l, data: "0x1234" }));
    if (knobs.mode === "removed") logs = logs.map(l => ({ ...l, removed: true }));
    if (knobs.mode === "log-transaction") logs = logs.map(l => ({ ...l, transactionHash: h(999) }));
    if (knobs.mode === "log-block") logs = logs.map(l => ({ ...l, blockHash: h(999) }));
    if (knobs.mode === "log-index") logs = logs.map(l => ({ ...l, logIndex: 9 }));
    if (knobs.mode === "duplicate") logs = [...logs, ...logs];
    return { status: "success", transactionHash: knobs.mode === "transaction" ? h(999) : hash,
      from: creator, to: m.treasuryFactory, blockNumber: knobs.mode === "height" ? height + 1n : height,
      blockHash: h(Number(height)), transactionIndex: knobs.mode === "transaction-index" ? 1 : 0, logs };
  };
  const rpc = {
    getCode: async () => runtime,
    getLogs: async ({ address }: { address: Address | Address[] }) => Array.isArray(address)
      ? [funding, ...(knobs.secondFunding ? [{ ...funding, logIndex: 1 }] : [])] : knobs.phase === "birth" ? [creation] : [],
    getTransaction: async () => transaction,
    getTransactionReceipt: async ({ hash }: { hash: Hash }) => { knobs.receipts++; return receipt(hash === creationHash); },
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
      knobs.headers++;
      return { number: blockNumber, hash: h(Number(blockNumber)), timestamp: 1_700_000_000n + blockNumber,
        transactions: knobs.mode === "membership" ? [h(999)] : blockNumber === 3n ? [creationHash] : [fundingHash] };
    },
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "creator") return creator;
      if (functionName === "intentId") return intent;
      if (functionName === "treasuryShareBps") return 2250;
      if (functionName === "deploymentFactory") return m.treasuryFactory;
      if (functionName === "controllerInitialized") return true;
      if (functionName === "controller") return controller;
      if (functionName === "pins") return [m.coreFactory, m.coreFactoryRuntimeHash, m.graduationEngine, m.graduationRuntimeHash, m.tokenRuntimeHash];
      if (functionName === "predict" || functionName === "treasuryForIntent") return treasury;
      throw Error("Unexpected fixture proof read");
    },
  } as unknown as PublicClient;
  const birth = await verifyFixtureTreasuryBirth(rpc, m, treasury, at(4));
  assert.equal(birth.creator, creator); assert.equal(birth.deployment.logIndex, 0);
  for (const mode of ["missing-log", "topics", "data", "removed", "log-transaction", "log-block", "log-index", "duplicate", "transaction", "height", "transaction-index", "membership"]) {
    knobs.mode = mode;
    await assert.rejects(verifyFixtureTreasuryBirth(rpc, m, treasury, at(4)), /evidence/, "A birth needs an exact canonical receipt log: " + mode);
  }
  knobs.mode = ""; knobs.phase = "funding";
  const db = { query: async () => ({ rows: [{ payload: birth }] }) } as unknown as Client;
  const scope: [number, string, string] = [31337, m.coreFactory.toLowerCase(), h(2)];
  const range = await readProjectTreasuryFixtureRange(db, scope, m, rpc, [at(4)]);
  assert.equal(range.events.length, 1); assert.equal(range.events[0]?.amountWei, "17");
  for (const mode of ["missing-log", "topics", "data", "removed", "log-transaction", "log-block", "log-index", "duplicate", "transaction", "height", "transaction-index", "membership"]) {
    knobs.mode = mode;
    await assert.rejects(readProjectTreasuryFixtureRange(db, scope, m, rpc, [at(4)]), /evidence/, "Funding history needs exact receipt inclusion: " + mode);
  }
  knobs.mode = ""; knobs.secondFunding = true; knobs.receipts = 0; knobs.headers = 0;
  const bounded = await readProjectTreasuryFixtureRange(db, scope, m, rpc, [at(4)]);
  assert.equal(bounded.events.length, 2); assert.equal(knobs.receipts, 1); assert.equal(knobs.headers, 1);
  assert.throws(() => assertFixtureTreasuryReceiptLog(receipt(false) as never,
    { number: 4n, hash: h(4), timestamp: 1_700_000_004n, transactions: [fundingHash] }, at(4), { ...funding, transactionIndex: 1 }), /evidence/);
}
