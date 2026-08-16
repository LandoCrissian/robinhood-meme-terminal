import {
  decodeEventLog,
  encodeAbiParameters,
  getAddress,
  isHash,
  keccak256,
  toBytes,
  type Address,
  type Hex
} from "viem";
import { z } from "zod";
import {
  RMT_DISTRIBUTION_CHAIN_ID,
  RMT_DISTRIBUTION_SCHEMA_VERSION,
  actionKindNumber,
  parseDistributionManifestV1,
  type DistributionEntryV1
} from "./distribution-domain";
import {
  RMT_DISTRIBUTION_ENGINE_V1_ABI,
  parseDistributionAuthorizationPlanV1,
  type DistributionAuthorizationPlanV1
} from "./distribution-authorization";

export type DistributionReceiptLogV1 = {
  address: string;
  topics: readonly Hex[];
  data: Hex;
  logIndex: number;
};

export type DistributionReceiptV1 = {
  chainId: number;
  transactionHash: string;
  blockNumber: string;
  status: "success" | "reverted";
  logs: DistributionReceiptLogV1[];
};

export type DistributionSettlementRecordV1 = {
  schemaVersion: typeof RMT_DISTRIBUTION_SCHEMA_VERSION;
  status: "confirmed";
  chainId: typeof RMT_DISTRIBUTION_CHAIN_ID;
  manifestHash: Hex;
  batchId: Hex;
  batchHash: Hex;
  planId: Hex;
  executionKey: Hex;
  transactionHash: Hex;
  blockNumber: string;
  engine: Address;
  sender: Address;
  asset: Address;
  actionKind: DistributionAuthorizationPlanV1["actionKind"];
  recipientCount: number;
  exactAssetAmountAtomic: string;
  exactRmtRetiredAtomic: string;
  retirementSink: Address;
  canonicalEventLogIndex: number;
};

const EXECUTION_DOMAIN = keccak256(toBytes("RMT_DISTRIBUTION_EXECUTION_V1"));
const TRANSFER_TOPIC = keccak256(toBytes("Transfer(address,address,uint256)"));
const TRANSFER_SINGLE_TOPIC = keccak256(toBytes("TransferSingle(address,address,address,uint256,uint256)"));

const erc20TransferAbi = [{
  type: "event",
  name: "Transfer",
  anonymous: false,
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false }
  ]
}] as const;

const erc721TransferAbi = [{
  type: "event",
  name: "Transfer",
  anonymous: false,
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true }
  ]
}] as const;

const erc1155TransferAbi = [{
  type: "event",
  name: "TransferSingle",
  anonymous: false,
  inputs: [
    { name: "operator", type: "address", indexed: true },
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "id", type: "uint256", indexed: false },
    { name: "value", type: "uint256", indexed: false }
  ]
}] as const;

const receiptSchema = z.object({
  chainId: z.number().int(),
  transactionHash: z.string(),
  blockNumber: z.string(),
  status: z.enum(["success", "reverted"]),
  logs: z.array(z.object({
    address: z.string(),
    topics: z.array(z.string()),
    data: z.string(),
    logIndex: z.number().int().nonnegative()
  }).strict())
}).strict();

function reject(message: string): never {
  throw new Error(`RMT rejected distribution settlement: ${message}`);
}

function expectedExecutionKey(engine: Address, sender: Address, distributionId: Hex): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "bytes32" }],
    [EXECUTION_DOMAIN, BigInt(RMT_DISTRIBUTION_CHAIN_ID), engine, sender, distributionId]
  ));
}

function multiset(values: string[]) {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function assertSameMultiset(actual: string[], expected: string[], label: string) {
  const actualSet = multiset(actual);
  const expectedSet = multiset(expected);
  if (actualSet.size !== expectedSet.size || actual.length !== expected.length) reject(`${label} count is inconsistent`);
  for (const [key, count] of expectedSet) {
    if (actualSet.get(key) !== count) reject(`${label} evidence is inconsistent`);
  }
}

function erc20Fingerprint(from: string, to: string, value: bigint) {
  return `${getAddress(from).toLowerCase()}:${getAddress(to).toLowerCase()}:${value}`;
}

function relevantLogs(logs: DistributionReceiptLogV1[], token: Address, topic: Hex) {
  return logs.filter((log) => getAddress(log.address) === token && log.topics[0]?.toLowerCase() === topic);
}

function decodeErc20Transfers(logs: DistributionReceiptLogV1[], token: Address) {
  return relevantLogs(logs, token, TRANSFER_TOPIC).map((log) => {
    try {
      const decoded = decodeEventLog({ abi: erc20TransferAbi, eventName: "Transfer", topics: log.topics as [Hex, ...Hex[]], data: log.data });
      return erc20Fingerprint(decoded.args.from, decoded.args.to, decoded.args.value);
    } catch {
      reject("ERC-20 Transfer log is malformed");
    }
  });
}

function expectedAssetTransfers(plan: DistributionAuthorizationPlanV1, entries: DistributionEntryV1[]) {
  if (plan.actionKind === "erc20_equal" || plan.actionKind === "erc20_custom") {
    return entries.map((entry) => erc20Fingerprint(plan.sender, entry.recipient, BigInt(entry.amountAtomic!)));
  }
  return [];
}

function assertAssetTransferEvidence(
  plan: DistributionAuthorizationPlanV1,
  entries: DistributionEntryV1[],
  logs: DistributionReceiptLogV1[]
) {
  if (plan.actionKind === "erc20_equal" || plan.actionKind === "erc20_custom") {
    const expected = expectedAssetTransfers(plan, entries);
    if (getAddress(plan.asset) === getAddress(plan.expectedRmtToken)) {
      expected.push(erc20Fingerprint(plan.sender, plan.retirementSink, BigInt(plan.exactRmtRetirementAtomic)));
    }
    assertSameMultiset(decodeErc20Transfers(logs, plan.asset), expected, "ERC-20 Transfer");
    return;
  }
  if (plan.actionKind === "erc721") {
    const actual = relevantLogs(logs, plan.asset, TRANSFER_TOPIC).map((log) => {
      try {
        const decoded = decodeEventLog({ abi: erc721TransferAbi, eventName: "Transfer", topics: log.topics as [Hex, ...Hex[]], data: log.data });
        return `${getAddress(decoded.args.from).toLowerCase()}:${getAddress(decoded.args.to).toLowerCase()}:${decoded.args.tokenId}`;
      } catch {
        reject("ERC-721 Transfer log is malformed");
      }
    });
    const expected = entries.map((entry) => `${plan.sender.toLowerCase()}:${entry.recipient.toLowerCase()}:${entry.tokenId}`);
    assertSameMultiset(actual, expected, "ERC-721 Transfer");
    return;
  }
  const actual = relevantLogs(logs, plan.asset, TRANSFER_SINGLE_TOPIC).map((log) => {
    try {
      const decoded = decodeEventLog({ abi: erc1155TransferAbi, eventName: "TransferSingle", topics: log.topics as [Hex, ...Hex[]], data: log.data });
      return `${getAddress(decoded.args.operator).toLowerCase()}:${getAddress(decoded.args.from).toLowerCase()}:${getAddress(decoded.args.to).toLowerCase()}:${decoded.args.id}:${decoded.args.value}`;
    } catch {
      reject("ERC-1155 TransferSingle log is malformed");
    }
  });
  const expected = entries.map((entry) => `${plan.target.toLowerCase()}:${plan.sender.toLowerCase()}:${entry.recipient.toLowerCase()}:${entry.tokenId}:${entry.amountAtomic}`);
  assertSameMultiset(actual, expected, "ERC-1155 TransferSingle");
}

function assertRmtRetirementEvidence(plan: DistributionAuthorizationPlanV1, logs: DistributionReceiptLogV1[]) {
  if (getAddress(plan.asset) === getAddress(plan.expectedRmtToken) && (plan.actionKind === "erc20_equal" || plan.actionKind === "erc20_custom")) return;
  const expected = [erc20Fingerprint(plan.sender, plan.retirementSink, BigInt(plan.exactRmtRetirementAtomic))];
  assertSameMultiset(decodeErc20Transfers(logs, plan.expectedRmtToken), expected, "RMT retirement Transfer");
}

export function reconcileDistributionReceiptV1(input: {
  manifest: unknown;
  plan: unknown;
  receipt: unknown;
}): DistributionSettlementRecordV1 {
  const manifest = parseDistributionManifestV1(input.manifest);
  const plan = parseDistributionAuthorizationPlanV1(input.plan, manifest);
  const receiptResult = receiptSchema.safeParse(input.receipt);
  if (!receiptResult.success) reject("receipt schema is malformed");
  const receipt = receiptResult.data as DistributionReceiptV1;
  if (receipt.chainId !== RMT_DISTRIBUTION_CHAIN_ID || receipt.status !== "success") reject("transaction did not succeed on chain 4663");
  if (!isHash(receipt.transactionHash) || !/^(0|[1-9][0-9]*)$/.test(receipt.blockNumber) || BigInt(receipt.blockNumber) === 0n) {
    reject("transaction or block identity is invalid");
  }
  if (new Set(receipt.logs.map((log) => log.logIndex)).size !== receipt.logs.length) reject("receipt contains duplicate log indices");
  const batch = manifest.batches[plan.batchIndex];
  const engineLogs = receipt.logs.filter((log) => getAddress(log.address) === plan.target);
  const decodedEvents: Array<{ log: DistributionReceiptLogV1; args: Record<string, unknown> }> = [];
  for (const log of engineLogs) {
    try {
      const decoded = decodeEventLog({
        abi: RMT_DISTRIBUTION_ENGINE_V1_ABI,
        eventName: "DistributionExecuted",
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data
      });
      decodedEvents.push({ log, args: decoded.args as unknown as Record<string, unknown> });
    } catch {
      // Other engine logs are not expected from V1, but they are not treated as the canonical event.
    }
  }
  if (decodedEvents.length !== 1) reject("receipt must contain exactly one canonical DistributionExecuted event");
  const canonical = decodedEvents[0];
  const args = canonical.args;
  const executionKey = expectedExecutionKey(plan.target, plan.sender, plan.batchId);
  if (
    args.executionKey !== executionKey
    || getAddress(String(args.sender)) !== plan.sender
    || getAddress(String(args.asset)) !== plan.asset
    || args.distributionId !== plan.batchId
    || Number(args.actionKind) !== actionKindNumber(plan.actionKind)
    || BigInt(String(args.recipientCount)) !== BigInt(plan.recipientCount)
    || BigInt(String(args.totalAssetAmount)) !== BigInt(plan.totalAssetAmountAtomic)
    || BigInt(String(args.rmtRetired)) !== BigInt(plan.exactRmtRetirementAtomic)
    || getAddress(String(args.retirementSink)) !== plan.retirementSink
    || args.batchHash !== plan.batchHash
  ) reject("canonical settlement event does not match the authorization plan");

  assertAssetTransferEvidence(plan, batch.entries, receipt.logs);
  assertRmtRetirementEvidence(plan, receipt.logs);

  return {
    schemaVersion: RMT_DISTRIBUTION_SCHEMA_VERSION,
    status: "confirmed",
    chainId: RMT_DISTRIBUTION_CHAIN_ID,
    manifestHash: manifest.manifestHash,
    batchId: batch.batchId,
    batchHash: batch.batchHash,
    planId: plan.planId,
    executionKey,
    transactionHash: receipt.transactionHash.toLowerCase() as Hex,
    blockNumber: BigInt(receipt.blockNumber).toString(),
    engine: plan.target,
    sender: plan.sender,
    asset: plan.asset,
    actionKind: plan.actionKind,
    recipientCount: plan.recipientCount,
    exactAssetAmountAtomic: plan.totalAssetAmountAtomic,
    exactRmtRetiredAtomic: plan.exactRmtRetirementAtomic,
    retirementSink: plan.retirementSink,
    canonicalEventLogIndex: canonical.log.logIndex
  };
}
