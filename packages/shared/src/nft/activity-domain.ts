import {
  decodeEventLog,
  getAddress,
  isAddressEqual,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import {
  RMT_CURATED_NFT_PROJECTS,
  RMT_NFT_CHAIN_ID,
  type RmtCuratedNftProject,
  type RmtNftCollectionStandard
} from "./project-registry.js";

export const RMT_ERC721_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
export const RMT_ERC1155_TRANSFER_SINGLE_TOPIC = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62" as const;
export const RMT_ERC1155_TRANSFER_BATCH_TOPIC = "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb" as const;
const MAX_ERC1155_BATCH_ITEMS = 1_024;

const ERC721_TRANSFER_ABI = [{
  anonymous: false,
  inputs: [
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" },
    { indexed: true, name: "tokenId", type: "uint256" }
  ],
  name: "Transfer",
  type: "event"
}] as const;

const ERC1155_TRANSFER_SINGLE_ABI = [{
  anonymous: false,
  inputs: [
    { indexed: true, name: "operator", type: "address" },
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" },
    { indexed: false, name: "id", type: "uint256" },
    { indexed: false, name: "value", type: "uint256" }
  ],
  name: "TransferSingle",
  type: "event"
}] as const;

const ERC1155_TRANSFER_BATCH_ABI = [{
  anonymous: false,
  inputs: [
    { indexed: true, name: "operator", type: "address" },
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" },
    { indexed: false, name: "ids", type: "uint256[]" },
    { indexed: false, name: "values", type: "uint256[]" }
  ],
  name: "TransferBatch",
  type: "event"
}] as const;

export type RmtNftActivityCollectionContext = {
  projectId: string;
  collectionAddress: Address;
  standard: RmtNftCollectionStandard;
};

export type RmtNftRawLog = {
  chainId: number;
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  transactionHash: Hex | null;
  blockHash: Hex | null;
  blockNumber: bigint | null;
  logIndex: number | null;
  removed?: boolean;
};

export type RmtNftMovementKind = "MINT" | "TRANSFER" | "BURN";

export type RmtNftTokenMovement = {
  tokenId: bigint;
  amount: bigint;
  from: Address;
  to: Address;
  kind: RmtNftMovementKind;
};

export type RmtNftActivityEvent = {
  schemaVersion: 1;
  chainId: typeof RMT_NFT_CHAIN_ID;
  projectId: string;
  collectionAddress: Address;
  standard: RmtNftCollectionStandard;
  transactionHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockHash: Hex;
  sourceEvent: "TRANSFER" | "TRANSFER_SINGLE" | "TRANSFER_BATCH";
  operator: Address | null;
  movements: readonly RmtNftTokenMovement[];
  marketMeaning: "NOT_ESTABLISHED";
};

export type RmtNftActivityDecodeFailureReason =
  | "COLLECTION_NOT_ADMITTED"
  | "WRONG_CHAIN"
  | "WRONG_COLLECTION"
  | "REMOVED_LOG"
  | "MISSING_LOG_IDENTITY"
  | "UNSUPPORTED_TOPIC"
  | "STANDARD_EVENT_MISMATCH"
  | "DECODE_FAILED"
  | "INVALID_TRANSFER_ENDPOINTS"
  | "INVALID_BATCH_LENGTH";

export type RmtNftActivityDecodeResult =
  | { status: "DECODED"; event: RmtNftActivityEvent }
  | { status: "IGNORED"; reason: RmtNftActivityDecodeFailureReason };

export type RmtNftActivityObservationComparison =
  | "DISTINCT"
  | "DUPLICATE"
  | "REORG_REPLACEMENT";

function canonicalAddress(value: Address) {
  return getAddress(value);
}

function movementKind(from: Address, to: Address): RmtNftMovementKind | null {
  const fromZero = isAddressEqual(from, zeroAddress);
  const toZero = isAddressEqual(to, zeroAddress);
  if (fromZero && toZero) return null;
  if (fromZero) return "MINT";
  if (toZero) return "BURN";
  return "TRANSFER";
}

function admittedCollection(address: Address, verifiedStandard: RmtNftCollectionStandard): RmtNftActivityCollectionContext | null {
  const projects = RMT_CURATED_NFT_PROJECTS as readonly RmtCuratedNftProject[];
  for (const project of projects) {
    if (project.status === "REMOVED") continue;
    for (const collection of project.collections) {
      if (!isAddressEqual(collection.contractAddress, address)) continue;
      if (collection.declaredStandard && collection.declaredStandard !== verifiedStandard) return null;
      return {
        projectId: project.projectId,
        collectionAddress: canonicalAddress(collection.contractAddress),
        standard: verifiedStandard
      };
    }
  }
  return null;
}

export function resolveRmtNftActivityCollection(
  address: Address,
  verifiedStandard: RmtNftCollectionStandard
): RmtNftActivityCollectionContext | null {
  return admittedCollection(canonicalAddress(address), verifiedStandard);
}

function identityFromLog(log: RmtNftRawLog) {
  if (
    log.transactionHash === null
    || log.blockHash === null
    || log.blockNumber === null
    || log.logIndex === null
    || !Number.isSafeInteger(log.logIndex)
    || log.logIndex < 0
  ) return null;

  return {
    transactionHash: log.transactionHash,
    blockHash: log.blockHash,
    blockNumber: log.blockNumber,
    logIndex: log.logIndex
  };
}

function movement(tokenId: bigint, amount: bigint, from: Address, to: Address): RmtNftTokenMovement | null {
  const canonicalFrom = canonicalAddress(from);
  const canonicalTo = canonicalAddress(to);
  const kind = movementKind(canonicalFrom, canonicalTo);
  if (!kind) return null;
  return {
    tokenId,
    amount,
    from: canonicalFrom,
    to: canonicalTo,
    kind
  };
}

export function decodeVerifiedRmtNftActivityLog(
  log: RmtNftRawLog,
  collection: RmtNftActivityCollectionContext
): RmtNftActivityDecodeResult {
  if (log.chainId !== RMT_NFT_CHAIN_ID) return { status: "IGNORED", reason: "WRONG_CHAIN" };
  if (!isAddressEqual(log.address, collection.collectionAddress)) {
    return { status: "IGNORED", reason: "WRONG_COLLECTION" };
  }
  if (log.removed === true) return { status: "IGNORED", reason: "REMOVED_LOG" };

  const identity = identityFromLog(log);
  if (!identity) return { status: "IGNORED", reason: "MISSING_LOG_IDENTITY" };

  const topic0 = log.topics[0]?.toLowerCase();
  if (!topic0) return { status: "IGNORED", reason: "UNSUPPORTED_TOPIC" };
  const topics = [...log.topics] as [Hex, ...Hex[]];

  if (topic0 === RMT_ERC721_TRANSFER_TOPIC) {
    if (collection.standard !== "ERC721") return { status: "IGNORED", reason: "STANDARD_EVENT_MISMATCH" };
    try {
      const decoded = decodeEventLog({
        abi: ERC721_TRANSFER_ABI,
        data: log.data,
        topics,
        strict: true
      });
      const item = movement(decoded.args.tokenId, 1n, decoded.args.from, decoded.args.to);
      if (!item) return { status: "IGNORED", reason: "INVALID_TRANSFER_ENDPOINTS" };
      return {
        status: "DECODED",
        event: {
          schemaVersion: 1,
          chainId: RMT_NFT_CHAIN_ID,
          projectId: collection.projectId,
          collectionAddress: canonicalAddress(collection.collectionAddress),
          standard: "ERC721",
          ...identity,
          sourceEvent: "TRANSFER",
          operator: null,
          movements: [item],
          marketMeaning: "NOT_ESTABLISHED"
        }
      };
    } catch {
      return { status: "IGNORED", reason: "DECODE_FAILED" };
    }
  }

  if (topic0 === RMT_ERC1155_TRANSFER_SINGLE_TOPIC) {
    if (collection.standard !== "ERC1155") return { status: "IGNORED", reason: "STANDARD_EVENT_MISMATCH" };
    try {
      const decoded = decodeEventLog({
        abi: ERC1155_TRANSFER_SINGLE_ABI,
        data: log.data,
        topics,
        strict: true
      });
      const item = movement(decoded.args.id, decoded.args.value, decoded.args.from, decoded.args.to);
      if (!item) return { status: "IGNORED", reason: "INVALID_TRANSFER_ENDPOINTS" };
      return {
        status: "DECODED",
        event: {
          schemaVersion: 1,
          chainId: RMT_NFT_CHAIN_ID,
          projectId: collection.projectId,
          collectionAddress: canonicalAddress(collection.collectionAddress),
          standard: "ERC1155",
          ...identity,
          sourceEvent: "TRANSFER_SINGLE",
          operator: canonicalAddress(decoded.args.operator),
          movements: [item],
          marketMeaning: "NOT_ESTABLISHED"
        }
      };
    } catch {
      return { status: "IGNORED", reason: "DECODE_FAILED" };
    }
  }

  if (topic0 === RMT_ERC1155_TRANSFER_BATCH_TOPIC) {
    if (collection.standard !== "ERC1155") return { status: "IGNORED", reason: "STANDARD_EVENT_MISMATCH" };
    try {
      const decoded = decodeEventLog({
        abi: ERC1155_TRANSFER_BATCH_ABI,
        data: log.data,
        topics,
        strict: true
      });
      const ids = decoded.args.ids;
      const values = decoded.args.values;
      if (ids.length === 0 || ids.length !== values.length || ids.length > MAX_ERC1155_BATCH_ITEMS) {
        return { status: "IGNORED", reason: "INVALID_BATCH_LENGTH" };
      }
      const movements: RmtNftTokenMovement[] = [];
      for (let index = 0; index < ids.length; index += 1) {
        const item = movement(ids[index]!, values[index]!, decoded.args.from, decoded.args.to);
        if (!item) return { status: "IGNORED", reason: "INVALID_TRANSFER_ENDPOINTS" };
        movements.push(item);
      }
      return {
        status: "DECODED",
        event: {
          schemaVersion: 1,
          chainId: RMT_NFT_CHAIN_ID,
          projectId: collection.projectId,
          collectionAddress: canonicalAddress(collection.collectionAddress),
          standard: "ERC1155",
          ...identity,
          sourceEvent: "TRANSFER_BATCH",
          operator: canonicalAddress(decoded.args.operator),
          movements,
          marketMeaning: "NOT_ESTABLISHED"
        }
      };
    } catch {
      return { status: "IGNORED", reason: "DECODE_FAILED" };
    }
  }

  return { status: "IGNORED", reason: "UNSUPPORTED_TOPIC" };
}

export function decodeRmtNftActivityLog(
  log: RmtNftRawLog,
  verifiedStandard: RmtNftCollectionStandard
): RmtNftActivityDecodeResult {
  const collection = resolveRmtNftActivityCollection(log.address, verifiedStandard);
  if (!collection) return { status: "IGNORED", reason: "COLLECTION_NOT_ADMITTED" };
  return decodeVerifiedRmtNftActivityLog(log, collection);
}

export function rmtNftActivityEventKey(event: RmtNftActivityEvent) {
  return [
    event.chainId,
    event.collectionAddress.toLowerCase(),
    event.transactionHash.toLowerCase(),
    event.logIndex
  ].join(":");
}

export function rmtNftActivityObservationKey(event: RmtNftActivityEvent) {
  return [
    rmtNftActivityEventKey(event),
    event.blockNumber.toString(),
    event.blockHash.toLowerCase()
  ].join(":");
}

export function compareRmtNftActivityObservations(
  previous: RmtNftActivityEvent,
  next: RmtNftActivityEvent
): RmtNftActivityObservationComparison {
  if (rmtNftActivityEventKey(previous) !== rmtNftActivityEventKey(next)) return "DISTINCT";
  if (rmtNftActivityObservationKey(previous) === rmtNftActivityObservationKey(next)) return "DUPLICATE";
  return "REORG_REPLACEMENT";
}
