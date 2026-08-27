import { getAddress, type Address } from "viem";
import { readVNextVerifiedAssetIdentity } from "../server/vnext-asset-identity";
import type { RmtNftProjectTokenRegistryEntry } from "./project-registry";
import { RMT_NFT_CHAIN_ID } from "./project-registry";

export type RmtNftProjectTokenVerification = {
  chainId: typeof RMT_NFT_CHAIN_ID;
  contractAddress: Address;
  symbol: string;
  decimals: number;
  association: "OWNER_CONFIRMED_PROJECT_TOKEN";
  verifiedAt: string;
};

export type RmtNftProjectTokenVerificationResult =
  | { status: "VERIFIED"; verification: RmtNftProjectTokenVerification }
  | {
      status: "REJECTED";
      reason: "WRONG_CHAIN" | "TOKEN_IDENTITY_UNAVAILABLE" | "ASSOCIATION_NOT_OWNER_CONFIRMED";
      contractAddress: Address;
      verifiedAt: string;
    };

export type RmtNftProjectTokenVerificationDependencies = {
  readIdentity?: typeof readVNextVerifiedAssetIdentity;
  now?: () => Date;
};

export async function verifyRmtNftProjectToken(
  projectToken: RmtNftProjectTokenRegistryEntry,
  dependencies: RmtNftProjectTokenVerificationDependencies = {}
): Promise<RmtNftProjectTokenVerificationResult> {
  const contractAddress = getAddress(projectToken.contractAddress);
  const verifiedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  if (projectToken.chainId !== RMT_NFT_CHAIN_ID) {
    return { status: "REJECTED", reason: "WRONG_CHAIN", contractAddress, verifiedAt };
  }
  if (projectToken.association !== "OWNER_CONFIRMED_PROJECT_TOKEN") {
    return { status: "REJECTED", reason: "ASSOCIATION_NOT_OWNER_CONFIRMED", contractAddress, verifiedAt };
  }

  // Consume the already-established RMT Robinhood token identity boundary.
  // This does not modify token discovery, search, canonical markets, quoting,
  // authorization, or execution.
  const readIdentity = dependencies.readIdentity ?? readVNextVerifiedAssetIdentity;
  const identity = await readIdentity(contractAddress);
  if (!identity || identity.native) {
    return { status: "REJECTED", reason: "TOKEN_IDENTITY_UNAVAILABLE", contractAddress, verifiedAt };
  }

  return {
    status: "VERIFIED",
    verification: {
      chainId: RMT_NFT_CHAIN_ID,
      contractAddress,
      symbol: identity.symbol,
      decimals: identity.decimals,
      association: "OWNER_CONFIRMED_PROJECT_TOKEN",
      verifiedAt
    }
  };
}
