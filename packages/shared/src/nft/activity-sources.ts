import {
  getAddress,
  isAddressEqual,
  type Address,
  type Hex
} from "viem";
import {
  RMT_CURATED_NFT_PROJECTS,
  RMT_NFT_CHAIN_ID,
  type RmtCuratedNftProject,
  type RmtNftCollectionStandard
} from "./project-registry.js";

export type RmtNftActivitySource = {
  chainId: typeof RMT_NFT_CHAIN_ID;
  projectId: string;
  collectionAddress: Address;
  standard: RmtNftCollectionStandard;
  deploymentTransaction: Hex;
  startBlock: bigint;
};

function reviewedSource(input: RmtNftActivitySource): RmtNftActivitySource {
  if (input.chainId !== RMT_NFT_CHAIN_ID) {
    throw new Error("RMT NFT activity sources must remain bound to Robinhood Chain 4663.");
  }
  if (input.startBlock < 0n) throw new Error("RMT NFT activity source start block cannot be negative.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.deploymentTransaction)) {
    throw new Error("RMT NFT activity source deployment transaction must be a transaction hash.");
  }

  const projects = RMT_CURATED_NFT_PROJECTS as readonly RmtCuratedNftProject[];
  const project = projects.find((candidate) => candidate.projectId === input.projectId);
  if (!project || !project.ownerApproved || project.status === "REMOVED") {
    throw new Error("RMT NFT activity sources must belong to an admitted project.");
  }
  const collection = project.collections.find((candidate) =>
    isAddressEqual(candidate.contractAddress, input.collectionAddress)
  );
  if (!collection) throw new Error("RMT NFT activity source contract must exist in the curated project registry.");
  if (collection.declaredStandard && collection.declaredStandard !== input.standard) {
    throw new Error("RMT NFT activity source standard must match the curated collection declaration.");
  }

  return {
    ...input,
    collectionAddress: getAddress(input.collectionAddress)
  };
}

export const RMT_NFT_ACTIVITY_SOURCES = [
  reviewedSource({
    chainId: RMT_NFT_CHAIN_ID,
    projectId: "ccff00",
    collectionAddress: getAddress("0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146"),
    standard: "ERC721",
    // Verified contract-creation transaction. Runtime indexers must independently
    // re-read the receipt and bytecode before using this reviewed source.
    deploymentTransaction: "0x46b097f55f69ee1005f0e04bc6501e632ba4145355361498a156f8f401a5c96b",
    startBlock: 10_929_152n
  })
] as const satisfies readonly RmtNftActivitySource[];

export function rmtNftActivitySource(collectionAddress: Address) {
  return RMT_NFT_ACTIVITY_SOURCES.find((source) =>
    isAddressEqual(source.collectionAddress, collectionAddress)
  ) ?? null;
}
