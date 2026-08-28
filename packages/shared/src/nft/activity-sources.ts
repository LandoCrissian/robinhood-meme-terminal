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
import { rmtNftCollectionTechnicalVerification } from "./technical-verification.js";

export type RmtNftActivitySource = {
  chainId: typeof RMT_NFT_CHAIN_ID;
  projectId: string;
  collectionAddress: Address;
  standard: RmtNftCollectionStandard;
  deploymentTransaction: Hex;
  startBlock: bigint;
  runtimeBytecodeHash: Hex;
};

function reviewedSource(input: RmtNftActivitySource): RmtNftActivitySource {
  if (input.chainId !== RMT_NFT_CHAIN_ID) {
    throw new Error("RMT NFT activity sources must remain bound to Robinhood Chain 4663.");
  }
  if (input.startBlock < 0n) throw new Error("RMT NFT activity source start block cannot be negative.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.deploymentTransaction)) {
    throw new Error("RMT NFT activity source deployment transaction must be a transaction hash.");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.runtimeBytecodeHash)) {
    throw new Error("RMT NFT activity source runtime bytecode hash must be a 32-byte hash.");
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

function reviewedVerifiedSource(projectId: string, collectionAddress: Address): RmtNftActivitySource {
  const verification = rmtNftCollectionTechnicalVerification(projectId, collectionAddress);
  if (!verification) throw new Error("RMT NFT activity sources require reviewed technical verification evidence.");
  return reviewedSource({
    chainId: verification.chainId,
    projectId: verification.projectId,
    collectionAddress: verification.collectionAddress,
    standard: verification.standard,
    deploymentTransaction: verification.deploymentTransaction,
    startBlock: verification.startBlock,
    runtimeBytecodeHash: verification.runtimeBytecodeHash
  });
}

export const RMT_NFT_ACTIVITY_SOURCES = [
  // Runtime sources derive their duplicated deployment/hash fields from the
  // reviewed technical manifest; project intake is deliberately absent.
  reviewedVerifiedSource("ccff00", getAddress("0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146")),
  reviewedVerifiedSource("robin-rabbits", getAddress("0xb87522e093858d992b7555077ff3541597deb34e")),
  reviewedVerifiedSource("gogh-punks", getAddress("0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6"))
] as const satisfies readonly RmtNftActivitySource[];

export function rmtNftActivitySource(collectionAddress: Address) {
  return RMT_NFT_ACTIVITY_SOURCES.find((source) =>
    isAddressEqual(source.collectionAddress, collectionAddress)
  ) ?? null;
}
