import { getAddress, isAddress, type Address, type Hex } from "viem";
import { RMT_NFT_CHAIN_ID, type RmtNftCollectionStandard } from "./project-registry.js";

export const RMT_NFT_TECHNICAL_VERIFICATION_CLASSIFICATIONS = [
  "VERIFIED_TOP_LEVEL_CREATION",
  "UNSUPPORTED_FACTORY_CREATION_V1",
  "NO_CURRENT_BYTECODE",
  "WRONG_CHAIN",
  "ERC165_UNSUPPORTED",
  "INVALID_INTERFACE_BEHAVIOR",
  "ERC721_UNSUPPORTED",
  "CREATION_PROVENANCE_MISMATCH",
  "INCONCLUSIVE_PROVIDER_UNAVAILABLE",
  "INCONCLUSIVE_MALFORMED_PROVIDER_RESPONSE"
] as const;

export type RmtNftTechnicalVerificationClassification =
  typeof RMT_NFT_TECHNICAL_VERIFICATION_CLASSIFICATIONS[number];
export type RmtNftTokenUriKind = "DATA_JSON" | "IPFS" | "HTTPS" | "OTHER" | "REVERTED" | "UNAVAILABLE";
export type RmtNftProxyDetection = "YES" | "NO" | "UNKNOWN";

export type RmtNftCollectionTechnicalVerification = {
  projectId: string;
  chainId: typeof RMT_NFT_CHAIN_ID;
  collectionAddress: Address;
  standard: RmtNftCollectionStandard;
  deploymentTransaction: Hex;
  startBlock: bigint;
  runtimeBytecodeHash: Hex;
  supportsErc165: true;
  supportsInvalidInterface: false;
  supportsErc721: true;
  supportsErc721Metadata: boolean;
  name: string | null;
  symbol: string | null;
  representativeTokenId: bigint | null;
  tokenUriKind: RmtNftTokenUriKind;
  proxyDetected: RmtNftProxyDetection;
  implementationAddress: Address | null;
  implementationRuntimeBytecodeHash: Hex | null;
  verifiedAt: string;
};

function requiredHash(value: Hex, label: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be a 32-byte hash.`);
  return value.toLowerCase() as Hex;
}

export function defineRmtNftCollectionTechnicalVerification(
  input: RmtNftCollectionTechnicalVerification
): RmtNftCollectionTechnicalVerification {
  if (input.chainId !== RMT_NFT_CHAIN_ID) throw new Error("Verified NFT collections must use Robinhood Chain 4663.");
  if (!isAddress(input.collectionAddress, { strict: false })) throw new Error("Verified NFT collection address is invalid.");
  if (input.standard !== "ERC721" && input.standard !== "ERC1155") throw new Error("Verified NFT collection standard is invalid.");
  if (input.startBlock < 0n) throw new Error("Verified NFT deployment block cannot be negative.");
  if (!Number.isFinite(Date.parse(input.verifiedAt))) throw new Error("Verified NFT timestamp is invalid.");
  if (input.proxyDetected === "YES" && input.implementationAddress === null) {
    throw new Error("A positively detected NFT proxy requires an implementation address.");
  }
  return {
    ...input,
    collectionAddress: getAddress(input.collectionAddress),
    deploymentTransaction: requiredHash(input.deploymentTransaction, "Verified NFT deployment transaction"),
    runtimeBytecodeHash: requiredHash(input.runtimeBytecodeHash, "Verified NFT runtime bytecode hash"),
    implementationAddress: input.implementationAddress === null ? null : getAddress(input.implementationAddress),
    implementationRuntimeBytecodeHash: input.implementationRuntimeBytecodeHash === null
      ? null
      : requiredHash(input.implementationRuntimeBytecodeHash, "Verified NFT implementation runtime bytecode hash"),
    verifiedAt: new Date(input.verifiedAt).toISOString()
  };
}

// Only independently reviewed VERIFIED_TOP_LEVEL_CREATION records belong here.
export const RMT_NFT_VERIFIED_COLLECTIONS = [
  defineRmtNftCollectionTechnicalVerification({
    projectId: "ccff00",
    chainId: RMT_NFT_CHAIN_ID,
    collectionAddress: "0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146",
    standard: "ERC721",
    deploymentTransaction: "0x46b097f55f69ee1005f0e04bc6501e632ba4145355361498a156f8f401a5c96b",
    startBlock: 10_929_152n,
    runtimeBytecodeHash: "0x9172fab56f52887b2b271fa9c2fd9fa857edd79a39cf3f72513f1c343558fab1",
    supportsErc165: true,
    supportsInvalidInterface: false,
    supportsErc721: true,
    supportsErc721Metadata: true,
    name: "CCFF00",
    symbol: "CCFF00",
    representativeTokenId: null,
    tokenUriKind: "UNAVAILABLE",
    proxyDetected: "UNKNOWN",
    implementationAddress: null,
    implementationRuntimeBytecodeHash: null,
    verifiedAt: "2026-08-28T11:29:53.179Z"
  }),
  defineRmtNftCollectionTechnicalVerification({
    projectId: "robin-rabbits",
    chainId: RMT_NFT_CHAIN_ID,
    collectionAddress: "0xb87522e093858d992b7555077ff3541597deb34e",
    standard: "ERC721",
    deploymentTransaction: "0x063e82c75855f4da390d37fd38b3f451ba123fb88135b2c98c6af3bcd2eda756",
    startBlock: 41_824_510n,
    runtimeBytecodeHash: "0x1fd16a16fe1fd169db01fd6e74295935ed8767b16315e1f665d666111493f82b",
    supportsErc165: true,
    supportsInvalidInterface: false,
    supportsErc721: true,
    supportsErc721Metadata: true,
    name: "Robin Rabbits",
    symbol: "MOON",
    representativeTokenId: 1n,
    tokenUriKind: "HTTPS",
    proxyDetected: "UNKNOWN",
    implementationAddress: null,
    implementationRuntimeBytecodeHash: null,
    verifiedAt: "2026-08-28T11:30:04.914Z"
  }),
  defineRmtNftCollectionTechnicalVerification({
    projectId: "gogh-punks",
    chainId: RMT_NFT_CHAIN_ID,
    collectionAddress: "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6",
    standard: "ERC721",
    deploymentTransaction: "0x7cd34483503c65b37e7130d73197d399922b7a1cca40318f2a9276e02c38b991",
    startBlock: 31_277_277n,
    runtimeBytecodeHash: "0x3222e4925f77909e6370e17fe071d2774d43e191f6bc72c3a97c97209c6e2e93",
    supportsErc165: true,
    supportsInvalidInterface: false,
    supportsErc721: true,
    supportsErc721Metadata: true,
    name: "Gogh Punks",
    symbol: "GOGH",
    representativeTokenId: null,
    tokenUriKind: "UNAVAILABLE",
    proxyDetected: "UNKNOWN",
    implementationAddress: null,
    implementationRuntimeBytecodeHash: null,
    verifiedAt: "2026-08-28T11:30:28.502Z"
  })
] as const satisfies readonly RmtNftCollectionTechnicalVerification[];

export function rmtNftCollectionTechnicalVerification(projectId: string, collectionAddress: Address) {
  const normalized = projectId.trim().toLowerCase();
  return (RMT_NFT_VERIFIED_COLLECTIONS as readonly RmtNftCollectionTechnicalVerification[]).find((entry) =>
    entry.projectId === normalized && entry.collectionAddress.toLowerCase() === collectionAddress.toLowerCase()
  ) ?? null;
}
