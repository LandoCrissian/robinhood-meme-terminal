import {
  decodeEventLog, decodeFunctionData, isAddress, keccak256, parseAbi, toEventSelector, zeroAddress,
  type Address, type Hash, type Hex, type TransactionReceipt,
} from "viem";
import { historicalFactory } from "./historical-launches.js";

// Frozen #592 contract blobs 038484de and d4a34a9b. The shipping factory is 31337-only.
export const curveCreationAbi = parseAbi([
  "function create(string name,string symbol,string projectURI,uint8 supplyPreset,address treasury,uint16 treasuryShareBps,bytes32 intentId,uint256 deadline) payable returns (address token,address curve)",
  "function engineVersion() view returns (uint32)",
  "function projectRegistry() view returns (address)",
  "function creationFeeWei() view returns (uint256)",
  "function operatingRecipient() view returns (address)",
  "event CurveCreated(address indexed token,address indexed curve,address indexed creator,bytes32 intentId,uint256 supply,address revenueLedger,address treasury,uint16 treasuryShareBps,string name,string symbol,string projectURI)",
  "event CreationFeePaid(address indexed token,address indexed creator,address indexed recipient,uint256 fee,uint256 refund)",
  "event ProjectRegistered(address indexed token,address indexed factory,address indexed curve,uint32 version)",
]);

const [create, , , , , createdEvent, feeEvent, registeredEvent] = curveCreationAbi;
const createdTopic = toEventSelector(createdEvent);
const feeTopic = toEventSelector(feeEvent);
const registeredTopic = toEventSelector(registeredEvent);
const supplyIncrement = 1_000_000n * 10n ** 18n;
const publicChainId = 4663;
export const fixtureChainId = 31337;
export const fixtureConfirmations = 2;
const minimumConfirmations = 20;
const maxLogs = 256;
const maxLogBytes = 64 * 1024;
const maxCreationInputBytes = 1024;

type CommonBinding = {
  engineVersion: 1;
  deploymentBlock: bigint;
  deploymentBlockHash: Hash;
  factory: Address;
  factoryRuntimeHash: Hash;
  projectRegistry: Address;
  projectRegistryRuntimeHash: Hash;
  confirmations: number;
  creationFeeWei: bigint;
  creationFeeRecipient: Address;
};

export type CurveFixtureBinding = CommonBinding & { chainId: 31337; profile: "task036-local-only" };
export type CurveLaunchBinding = (CommonBinding & { chainId: 4663; profile?: never }) | CurveFixtureBinding;

export type CurveCreationLogRef = {
  blockNumber: bigint;
  blockHash: Hash;
  transactionHash: Hash;
  logIndex: number;
};

export type BlockEvidence = { blockNumber: string; blockHash: Hash; timestamp: string };
export type OpeningEvidence = { inventoryWei: string; backingWei: string; soldWei: string };

export type CurveLaunchRegistration = {
  kind: "curve-launch-v1";
  status: "created";
  chainId: 4663 | 31337;
  engineVersion: 1;
  factory: Address;
  projectRegistry: Address;
  token: Address;
  initialCurve: Address;
  creator: Address;
  revenueLedger: Address;
  totalSupplyWei: string;
  intentId: Hash;
  name: string;
  symbol: string;
  projectURI: string;
  treasury: Address | null;
  treasuryShareBps: number;
  creation: BlockEvidence & { transactionHash: Hash; logIndex: number };
  projectRegistrationLogIndex: number;
  creationFee: { amountWei: string; refundWei: string; recipient: Address; logIndex: number };
  opening?: OpeningEvidence;
  checkpoint: BlockEvidence & { confirmations: number; finality: "l2-confirmed" | "fixture-confirmed"; l1Finality: "unverified" };
};

type Block = { number: bigint | null; hash: Hash | null; timestamp: bigint; transactions: readonly Hash[] };
type Receipt = Pick<TransactionReceipt,
  "to" | "from" | "status" | "blockHash" | "blockNumber" | "transactionHash" | "transactionIndex" | "logs">;
type CreationTransaction = {
  hash: Hash;
  to: Address | null;
  from: Address;
  blockHash: Hash | null;
  blockNumber: bigint | null;
  transactionIndex: number | null;
  input: Hex;
  value: bigint;
};
type FactoryRead = "engineVersion" | "projectRegistry" | "creationFeeWei" | "operatingRecipient";

/** Uses the same viem read-only client contract as the V6 Railway worker. */
export type CurveEvidenceRpc = {
  getChainId(): Promise<number>;
  getBlockNumber(args: { cacheTime: 0 }): Promise<bigint>;
  getBlock(args: { blockNumber: bigint; includeTransactions: false }): Promise<Block>;
  getCode(args: { address: Address; blockNumber: bigint }): Promise<Hex | undefined>;
  getTransactionReceipt(args: { hash: Hash }): Promise<Receipt>;
  getTransaction(args: { hash: Hash }): Promise<CreationTransaction>;
  readContract(args: {
    address: Address;
    abi: typeof curveCreationAbi;
    blockNumber: bigint;
    functionName: FactoryRead;
  }): Promise<bigint | number | Address>;
};

const bytes32 = (value: unknown): value is Hash =>
  typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
const validHash = (value: unknown): value is Hash => bytes32(value) && !/^0x0+$/.test(value);
const validAddress = (value: unknown): value is Address =>
  typeof value === "string" && isAddress(value, { strict: false }) && value.toLowerCase() !== zeroAddress;
const same = (a: string | null | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
const validIndex = (index: unknown): index is number =>
  typeof index === "number" && Number.isSafeInteger(index) && index >= 0;
const lengthIn = (value: string, min: number, max: number) =>
  !/[\p{Cc}\p{Cf}]/u.test(value) && Buffer.byteLength(value, "utf8") >= min && Buffer.byteLength(value, "utf8") <= max;

function requireEvidence(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error("New-engine creation evidence rejected: " + reason);
}

export function blockEvidence(block: Pick<Block, "number" | "hash" | "timestamp">, height: bigint): BlockEvidence {
  requireEvidence(block.number === height && validHash(block.hash) && block.timestamp > 0n
    && block.timestamp <= 8_640_000_000_000n, "bad canonical block identity");
  return {
    blockNumber: height.toString(),
    blockHash: block.hash,
    timestamp: new Date(Number(block.timestamp) * 1_000).toISOString(),
  };
}

export function assertCurveLaunchBinding(binding: CurveLaunchBinding) {
  const validProfile = binding.chainId === publicChainId
    ? binding.profile === undefined && Number.isSafeInteger(binding.confirmations) && binding.confirmations >= minimumConfirmations
    : binding.chainId === fixtureChainId && binding.profile === "task036-local-only" && binding.confirmations === fixtureConfirmations;
  requireEvidence(validProfile && binding.engineVersion === 1
    && typeof binding.deploymentBlock === "bigint" && binding.deploymentBlock > 0n
    && validHash(binding.deploymentBlockHash)
    && validAddress(binding.factory) && !same(binding.factory, historicalFactory)
    && validHash(binding.factoryRuntimeHash)
    && validAddress(binding.projectRegistry) && !same(binding.projectRegistry, binding.factory)
    && validHash(binding.projectRegistryRuntimeHash)
    && validAddress(binding.creationFeeRecipient) && !same(binding.creationFeeRecipient, binding.factory)
    && typeof binding.creationFeeWei === "bigint" && binding.creationFeeWei > 0n, "deployment binding");
}

/** Validate the anchor before serving even an empty fixture directory. */
export async function verifyCurveDeployment(binding: CurveLaunchBinding, rpc: CurveEvidenceRpc) {
  assertCurveLaunchBinding(binding);
  const at = binding.deploymentBlock;
  const read = (functionName: FactoryRead) => rpc.readContract({
    address: binding.factory, abi: curveCreationAbi, blockNumber: at, functionName,
  });
  requireEvidence(await rpc.getChainId() === binding.chainId, "chain ID");
  const [block, previous, factory, registry, version, registryAddress, fee, recipient] = await Promise.all([
    rpc.getBlock({ blockNumber: at, includeTransactions: false }),
    rpc.getCode({ address: binding.factory, blockNumber: at - 1n }),
    rpc.getCode({ address: binding.factory, blockNumber: at }),
    rpc.getCode({ address: binding.projectRegistry, blockNumber: at }),
    read("engineVersion"), read("projectRegistry"), read("creationFeeWei"), read("operatingRecipient"),
  ]);
  const evidence = blockEvidence(block, at);
  requireEvidence(same(evidence.blockHash, binding.deploymentBlockHash) && (previous === undefined || previous === "0x")
    && factory && same(keccak256(factory), binding.factoryRuntimeHash)
    && registry && same(keccak256(registry), binding.projectRegistryRuntimeHash)
    && version === binding.engineVersion && typeof registryAddress === "string" && same(registryAddress, binding.projectRegistry)
    && fee === binding.creationFeeWei && typeof recipient === "string" && same(recipient, binding.creationFeeRecipient), "deployment or runtime mismatch");
  return evidence;
}

function checkedReceiptLogs(receipt: Receipt) {
  requireEvidence(validIndex(receipt.transactionIndex) && Array.isArray(receipt.logs)
    && receipt.logs.length <= maxLogs, "invalid receipt bounds");
  const seen = new Set<number>();
  let bytes = 0;
  for (const log of receipt.logs) {
    requireEvidence(validIndex(log.logIndex) && !seen.has(log.logIndex)
      && (log.removed === undefined || log.removed === false)
      && log.blockNumber === receipt.blockNumber && same(log.blockHash, receipt.blockHash)
      && same(log.transactionHash, receipt.transactionHash) && log.transactionIndex === receipt.transactionIndex
      && validAddress(log.address) && Array.isArray(log.topics) && log.topics.length <= 4
      && log.topics.every(bytes32)
      && typeof log.data === "string" && log.data.length <= maxLogBytes * 2 + 2
      && /^0x(?:[0-9a-f]{2})*$/i.test(log.data), "malformed, removed or duplicate receipt log");
    bytes += (log.data.length - 2) / 2;
    requireEvidence(bytes <= maxLogBytes, "receipt log data exceeds the limit");
    seen.add(log.logIndex);
  }
  return receipt.logs;
}

function singleLog(logs: Receipt["logs"], address: Address, signature: Hex) {
  const matches = logs.filter((entry) => same(entry.address, address) && same(entry.topics[0], signature));
  requireEvidence(matches.length === 1 && matches[0] && matches[0].topics.length === 4,
    "expected one indexed event from the bound emitter");
  return matches[0];
}

/**
 * The caller supplies a reviewed binding; null means the candidate is undeployed and performs zero reads.
 * This verifier does not poll, own a writer, persist, or grant permission to expose a public feed.
 */
export async function readCurveLaunchRegistration(
  binding: CurveLaunchBinding | null,
  rpc: CurveEvidenceRpc,
  ref: CurveCreationLogRef,
): Promise<CurveLaunchRegistration | null> {
  if (binding === null) return null;
  assertCurveLaunchBinding(binding);
  requireEvidence(typeof ref.blockNumber === "bigint" && ref.blockNumber >= binding.deploymentBlock
    && validHash(ref.blockHash) && validHash(ref.transactionHash) && validIndex(ref.logIndex), "creation event reference");
  requireEvidence(await rpc.getChainId() === binding.chainId, "chain ID");
  const tip = await rpc.getBlockNumber({ cacheTime: 0 });
  const confirmations = tip - ref.blockNumber;
  requireEvidence(confirmations >= BigInt(binding.confirmations) && confirmations <= BigInt(Number.MAX_SAFE_INTEGER),
    "creation event has insufficient L2 confirmations");
  const checkpointHeight = tip - BigInt(binding.confirmations);
  const readFactory = (functionName: FactoryRead) => rpc.readContract({
    address: binding.factory, abi: curveCreationAbi, blockNumber: ref.blockNumber, functionName,
  });
  const readBlock = (blockNumber: bigint) => rpc.getBlock({ blockNumber, includeTransactions: false });
  const [block, checkpointBlock, deploymentBlock, receipt, tx, priorFactoryCode, deploymentCode, factoryCode, registryCode,
    version, registry, fixedFee, feeRecipient] = await Promise.all([
    readBlock(ref.blockNumber), readBlock(checkpointHeight), readBlock(binding.deploymentBlock),
    rpc.getTransactionReceipt({ hash: ref.transactionHash }),
    rpc.getTransaction({ hash: ref.transactionHash }),
    rpc.getCode({ address: binding.factory, blockNumber: binding.deploymentBlock - 1n }),
    rpc.getCode({ address: binding.factory, blockNumber: binding.deploymentBlock }),
    rpc.getCode({ address: binding.factory, blockNumber: ref.blockNumber }),
    rpc.getCode({ address: binding.projectRegistry, blockNumber: ref.blockNumber }),
    readFactory("engineVersion"), readFactory("projectRegistry"), readFactory("creationFeeWei"), readFactory("operatingRecipient"),
  ]);
  const creationBlock = blockEvidence(block, ref.blockNumber);
  const checkpoint = blockEvidence(checkpointBlock, checkpointHeight);
  requireEvidence(same(creationBlock.blockHash, ref.blockHash) && block.timestamp <= checkpointBlock.timestamp
    && (checkpointHeight !== ref.blockNumber || same(checkpoint.blockHash, creationBlock.blockHash))
    && same(blockEvidence(deploymentBlock, binding.deploymentBlock).blockHash, binding.deploymentBlockHash)
    && deploymentBlock.timestamp <= block.timestamp, "block mismatch");
  requireEvidence((priorFactoryCode === undefined || priorFactoryCode === "0x")
    && deploymentCode && same(keccak256(deploymentCode), binding.factoryRuntimeHash)
    && factoryCode && same(keccak256(factoryCode), binding.factoryRuntimeHash)
    && registryCode && same(keccak256(registryCode), binding.projectRegistryRuntimeHash), "deployment or runtime mismatch");
  requireEvidence(version === binding.engineVersion && typeof registry === "string" && same(registry, binding.projectRegistry)
    && fixedFee === binding.creationFeeWei && typeof feeRecipient === "string" && same(feeRecipient, binding.creationFeeRecipient),
    "factory protocol binding");

  requireEvidence(receipt.status === "success" && receipt.blockNumber === ref.blockNumber
    && same(receipt.blockHash, ref.blockHash) && same(receipt.transactionHash, ref.transactionHash)
    && same(receipt.to, binding.factory) && validAddress(receipt.from)
    && validIndex(receipt.transactionIndex) && Array.isArray(block.transactions)
    && same(block.transactions[receipt.transactionIndex], ref.transactionHash), "unbound or unsuccessful receipt");
  requireEvidence(same(tx.hash, ref.transactionHash) && same(tx.blockHash, ref.blockHash) && tx.blockNumber === ref.blockNumber
    && tx.transactionIndex === receipt.transactionIndex && same(tx.from, receipt.from) && same(tx.to, binding.factory)
    && typeof tx.input === "string" && /^0x(?:[0-9a-f]{2})*$/i.test(tx.input)
    && tx.input.length <= maxCreationInputBytes * 2 + 2, "unbound creation transaction");

  const logs = checkedReceiptLogs(receipt);
  const created = singleLog(logs, binding.factory, createdTopic);
  const paid = singleLog(logs, binding.factory, feeTopic);
  const registered = singleLog(logs, binding.projectRegistry, registeredTopic);
  requireEvidence(created.logIndex === ref.logIndex && validIndex(registered.logIndex) && validIndex(paid.logIndex)
    && registered.logIndex < ref.logIndex && ref.logIndex < paid.logIndex, "event identities or order");
  const { args } = decodeEventLog({ abi: [createdEvent], data: created.data, topics: created.topics });
  const { args: fee } = decodeEventLog({ abi: [feeEvent], data: paid.data, topics: paid.topics });
  const { args: origin } = decodeEventLog({ abi: [registeredEvent], data: registered.data, topics: registered.topics });

  const { token, curve, creator, intentId, supply, revenueLedger, treasury, treasuryShareBps, name, symbol, projectURI } = args;
  requireEvidence([token, curve, creator, revenueLedger].every(validAddress) && same(creator, receipt.from)
    && new Set([token, curve, revenueLedger, binding.factory, binding.projectRegistry].map((address) => address.toLowerCase())).size === 5
    && validHash(intentId) && lengthIn(name, 1, 48) && lengthIn(symbol, 1, 12) && lengthIn(projectURI, 0, 196)
    && (treasuryShareBps === 0) === same(treasury, zeroAddress) && treasuryShareBps <= 9_000
    && !same(treasury, creator), "curve creation arguments");
  requireEvidence(same(origin.token, token) && same(origin.curve, curve) && same(origin.factory, binding.factory)
    && origin.version === binding.engineVersion, "registry registration mismatch");
  requireEvidence(same(fee.token, token) && same(fee.creator, creator)
    && same(fee.recipient, binding.creationFeeRecipient) && fee.fee === binding.creationFeeWei
    && tx.value === fee.fee + fee.refund, "creation fee mismatch");
  const request = decodeFunctionData({ abi: [create], data: tx.input }).args;
  const [requestName, requestSymbol, requestUri, preset, requestTreasury, requestShare, requestIntent, deadline] = request;
  requireEvidence(preset <= 2 && supply === supplyIncrement * 10n ** BigInt(preset) && block.timestamp <= deadline
    && name === requestName && symbol === requestSymbol && projectURI === requestUri
    && same(treasury, requestTreasury) && treasuryShareBps === requestShare && same(intentId, requestIntent),
    "creation calldata mismatch");

  // Detect a canonical replacement while receipts and historical binding reads were being prepared.
  const checked = blockEvidence(await readBlock(checkpointHeight), checkpointHeight);
  requireEvidence(same(checked.blockHash, checkpoint.blockHash) && checked.timestamp === checkpoint.timestamp,
    "canonical checkpoint changed");

  return {
    kind: "curve-launch-v1", status: "created", chainId: binding.chainId, engineVersion: binding.engineVersion,
    factory: binding.factory, projectRegistry: binding.projectRegistry, token, initialCurve: curve,
    creator, revenueLedger, totalSupplyWei: supply.toString(), intentId, name, symbol, projectURI,
    treasury: treasuryShareBps === 0 ? null : treasury, treasuryShareBps,
    creation: { ...creationBlock, transactionHash: ref.transactionHash, logIndex: ref.logIndex },
    projectRegistrationLogIndex: registered.logIndex,
    creationFee: { amountWei: fee.fee.toString(), refundWei: fee.refund.toString(), recipient: fee.recipient, logIndex: paid.logIndex },
    checkpoint: { ...checkpoint, confirmations: binding.confirmations,
      finality: binding.chainId === fixtureChainId ? "fixture-confirmed" : "l2-confirmed", l1Finality: "unverified" },
  };
}
