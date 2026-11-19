import type { Address, Hash, Hex } from "viem";
import type { BlockEvidence } from "./curve-launch-evidence.js";

export const nftAcquisitionProfile = "rmt-nft-acquisition-local-v1" as const;
export type NftAcquisitionScope = [number, string, string];
export type NftAcquisitionModule = {
  schemaVersion: 1; profile: typeof nftAcquisitionProfile; chainId: 31337;
  coreFactory: Address; coreFactoryRuntimeHash: Hash;
  factory: Address; factoryRuntimeHash: Hash; venue: Address; venueRuntimeHash: Hash;
  paymentToken: Address; paymentTokenRuntimeHash: Hash;
  projectToken: Address; creator: Address; vault: Address; vaultRuntimeHash: Hash;
  collections: { address: Address; standard: 721 | 1155; runtimeHash: Hash; sourceInputSha256: string; name: string }[];
  deployment: BlockEvidence & { transactionHash: Hash };
  compilerInputSha256: string;
};
export type NftAcquisitionEvent = BlockEvidence & {
  vault: Address; projectToken: Address; transactionHash: Hash; logIndex: number; eventName: string;
  args: Record<string, unknown>;
  settlement?: {
    kind: "purchase" | "funding" | "withdrawal";
    evidence: "canonical-receipt-and-exact-local-call-trace";
    orderHash?: Hash; collection?: Address; tokenId?: string; quantity?: string;
    currency?: Address; totalCost?: string; custody?: Address;
    origin?: Record<string, unknown>;
    withdrawalId?:string;assetKind?:number;recipient?:Address;
  };
};
export type NftAcquisitionState = BlockEvidence & {
  vault: Address; projectToken: Address; controller: Address; controllerEpoch: string;
  policyEpoch: string; enabled: boolean; policy: Record<string, unknown>;
  nativeBalance: string; paymentBalance: string;
};
export type NftAcquisitionRange = { events: NftAcquisitionEvent[]; states: NftAcquisitionState[] };

// This is a private, explicitly selected local fixture profile. There is no
// production acquisition writer, route admission or database migration here.
export type NftAcquisitionReviewCall = { target: Address; actor: Address; data: Hex };
