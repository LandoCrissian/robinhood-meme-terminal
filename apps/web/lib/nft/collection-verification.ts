import {
  createPublicClient,
  getAddress,
  http,
  type Address,
  type PublicClient
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { fetchVerifiedContractLogs } from "../server/blockscout-contract-logs";
import {
  RMT_ERC721_TRANSFER_TOPIC,
  RMT_ERC1155_TRANSFER_BATCH_TOPIC,
  RMT_ERC1155_TRANSFER_SINGLE_TOPIC
} from "./activity-domain";
import {
  RMT_NFT_CHAIN_ID,
  type RmtNftCollectionRegistryEntry,
  type RmtNftCollectionStandard
} from "./project-registry";

const ERC165_ABI = [{
  inputs: [{ name: "interfaceId", type: "bytes4" }],
  name: "supportsInterface",
  outputs: [{ name: "", type: "bool" }],
  stateMutability: "view",
  type: "function"
}] as const;

const NAME_ABI = [{
  inputs: [],
  name: "name",
  outputs: [{ name: "", type: "string" }],
  stateMutability: "view",
  type: "function"
}] as const;

const SYMBOL_ABI = [{
  inputs: [],
  name: "symbol",
  outputs: [{ name: "", type: "string" }],
  stateMutability: "view",
  type: "function"
}] as const;

const ERC721_INTERFACE_ID = "0x80ac58cd" as const;
const ERC721_METADATA_INTERFACE_ID = "0x5b5e139f" as const;
const ERC1155_INTERFACE_ID = "0xd9b67a26" as const;
const ERC1155_METADATA_URI_INTERFACE_ID = "0x0e89341c" as const;

export type RmtNftMetadataCapability =
  | "ERC721_METADATA"
  | "ERC1155_METADATA_URI"
  | "UNAVAILABLE";

export type RmtNftActivityEvidence =
  | { status: "OBSERVED"; transactionHash: string; blockNumber: string }
  | { status: "NOT_OBSERVED_IN_SAMPLE" }
  | { status: "UNAVAILABLE" };

export type RmtNftCollectionVerification = {
  chainId: typeof RMT_NFT_CHAIN_ID;
  contractAddress: Address;
  contractExists: true;
  standard: RmtNftCollectionStandard;
  name: string | null;
  symbol: string | null;
  metadataCapability: RmtNftMetadataCapability;
  activityEvidence: RmtNftActivityEvidence;
  verifiedAt: string;
};

export type RmtNftCollectionVerificationFailure = {
  chainId: typeof RMT_NFT_CHAIN_ID;
  contractAddress: Address;
  contractExists: boolean;
  reason:
    | "WRONG_CHAIN"
    | "NO_CONTRACT_CODE"
    | "UNSUPPORTED_NFT_STANDARD"
    | "DECLARED_STANDARD_MISMATCH";
  verifiedAt: string;
};

export type RmtNftCollectionVerificationResult =
  | { status: "VERIFIED"; verification: RmtNftCollectionVerification }
  | { status: "REJECTED"; verification: RmtNftCollectionVerificationFailure };

export type RmtNftCollectionVerificationDependencies = {
  client?: PublicClient;
  readActivityEvidence?: (address: Address, standard: RmtNftCollectionStandard) => Promise<RmtNftActivityEvidence>;
  now?: () => Date;
};

const verificationClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_MAINNET_RPC_URL
      ?? process.env.ROBINHOOD_MAINNET_RPC_URL
      ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 0, timeout: 5_000 }
  )
});

function boundedIdentity(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maximum);
  return normalized || null;
}

async function supportsInterface(client: PublicClient, address: Address, interfaceId: `0x${string}`) {
  try {
    return await client.readContract({
      address,
      abi: ERC165_ABI,
      functionName: "supportsInterface",
      args: [interfaceId]
    }) === true;
  } catch {
    return false;
  }
}

async function readIdentity(client: PublicClient, address: Address) {
  const [name, symbol] = await Promise.all([
    client.readContract({ address, abi: NAME_ABI, functionName: "name" }).catch(() => null),
    client.readContract({ address, abi: SYMBOL_ABI, functionName: "symbol" }).catch(() => null)
  ]);
  return {
    name: boundedIdentity(name, 120),
    symbol: boundedIdentity(symbol, 40)
  };
}

function activityTopics(standard: RmtNftCollectionStandard): ReadonlySet<string> {
  return standard === "ERC721"
    ? new Set<string>([RMT_ERC721_TRANSFER_TOPIC])
    : new Set<string>([RMT_ERC1155_TRANSFER_SINGLE_TOPIC, RMT_ERC1155_TRANSFER_BATCH_TOPIC]);
}

export async function readSampledRmtNftActivityEvidence(
  address: Address,
  standard: RmtNftCollectionStandard
): Promise<RmtNftActivityEvidence> {
  try {
    const logs = await fetchVerifiedContractLogs(address, { pages: 1 });
    const expected = activityTopics(standard);
    const event = logs.find((log) => {
      const topic0 = log.topics[0]?.toLowerCase();
      return topic0 ? expected.has(topic0) : false;
    });
    return event ? {
      status: "OBSERVED",
      transactionHash: event.transactionHash,
      blockNumber: event.blockNumber.toString()
    } : { status: "NOT_OBSERVED_IN_SAMPLE" };
  } catch {
    return { status: "UNAVAILABLE" };
  }
}

export async function verifyRmtNftCollection(
  collection: RmtNftCollectionRegistryEntry,
  dependencies: RmtNftCollectionVerificationDependencies = {}
): Promise<RmtNftCollectionVerificationResult> {
  const client = dependencies.client ?? verificationClient;
  const now = dependencies.now ?? (() => new Date());
  const verifiedAt = now().toISOString();
  const contractAddress = getAddress(collection.contractAddress);

  const chainId = await client.getChainId();
  if (collection.chainId !== RMT_NFT_CHAIN_ID || chainId !== RMT_NFT_CHAIN_ID) {
    return {
      status: "REJECTED",
      verification: {
        chainId: RMT_NFT_CHAIN_ID,
        contractAddress,
        contractExists: false,
        reason: "WRONG_CHAIN",
        verifiedAt
      }
    };
  }

  const bytecode = await client.getBytecode({ address: contractAddress }).catch(() => undefined);
  if (!bytecode || bytecode === "0x") {
    return {
      status: "REJECTED",
      verification: {
        chainId: RMT_NFT_CHAIN_ID,
        contractAddress,
        contractExists: false,
        reason: "NO_CONTRACT_CODE",
        verifiedAt
      }
    };
  }

  const [erc721, erc1155] = await Promise.all([
    supportsInterface(client, contractAddress, ERC721_INTERFACE_ID),
    supportsInterface(client, contractAddress, ERC1155_INTERFACE_ID)
  ]);
  const standard: RmtNftCollectionStandard | null = erc721 !== erc1155
    ? erc721 ? "ERC721" : "ERC1155"
    : null;
  if (!standard) {
    return {
      status: "REJECTED",
      verification: {
        chainId: RMT_NFT_CHAIN_ID,
        contractAddress,
        contractExists: true,
        reason: "UNSUPPORTED_NFT_STANDARD",
        verifiedAt
      }
    };
  }
  if (collection.declaredStandard && collection.declaredStandard !== standard) {
    return {
      status: "REJECTED",
      verification: {
        chainId: RMT_NFT_CHAIN_ID,
        contractAddress,
        contractExists: true,
        reason: "DECLARED_STANDARD_MISMATCH",
        verifiedAt
      }
    };
  }

  const metadataCapability = standard === "ERC721"
    ? await supportsInterface(client, contractAddress, ERC721_METADATA_INTERFACE_ID)
      ? "ERC721_METADATA" as const
      : "UNAVAILABLE" as const
    : await supportsInterface(client, contractAddress, ERC1155_METADATA_URI_INTERFACE_ID)
      ? "ERC1155_METADATA_URI" as const
      : "UNAVAILABLE" as const;
  const identity = await readIdentity(client, contractAddress);
  const readActivityEvidence = dependencies.readActivityEvidence ?? readSampledRmtNftActivityEvidence;
  const activityEvidence = await readActivityEvidence(contractAddress, standard);

  return {
    status: "VERIFIED",
    verification: {
      chainId: RMT_NFT_CHAIN_ID,
      contractAddress,
      contractExists: true,
      standard,
      ...identity,
      metadataCapability,
      activityEvidence,
      verifiedAt
    }
  };
}
