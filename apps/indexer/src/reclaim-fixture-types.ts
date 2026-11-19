import type { Address, Hash, Hex } from "viem";
import type { BlockEvidence } from "./curve-launch-evidence.js";
import type { ReclaimOrigin } from "./reclaim-fixture-origin.js";

export const reclaimFixtureProfile = "rmt-reclaim-v1" as const;
export type ReclaimFixtureScope = [number, string, string];
export type ReclaimFixtureModule = {
  schemaVersion: 1; profile: typeof reclaimFixtureProfile; chainId: 31337;
  reclaimFactory: Address; factoryRuntimeHash: Hash;
  coreFactory: Address; coreFactoryRuntimeHash: Hash; rewardToken: Address; rewardTokenRuntimeHash: Hash;
  campaignCreationCode: Hex; campaignCreationCodeHash: Hash; campaignRuntimeTemplate: Hex;
  campaignImmutableReferences: Record<string, { start: number; length: number }[]>;
  campaignImmutableNames: Record<string, string>;
  collections: { address: Address; runtimeHash: Hash; standard: 1 | 2; items: { tokenId: string; maxQuantity: string }[] }[];
  deployment: { transactionHash: Hash; blockNumber: string; blockHash: Hash };
  compilerInputSha256: string;
};
export type ReclaimFixtureBirth = {
  campaign: Address; creator: Address; controller: Address; intentId: Hash; rewardToken: Address;
  rewardTokenRuntimeHash: Hash; runtimeHash: Hash; initialRewardPerUnit: string; walletCap: number;
  deployment: BlockEvidence & { transactionHash: Hash; logIndex: number };
};
export type ReclaimFixtureEvent = BlockEvidence & {
  campaign: Address; transactionHash: Hash; logIndex: number; eventName: string;
  args: Record<string, unknown>; settlement?: {
    kind: "fund" | "recover" | "trade-in" | "return";
    rewardToken: Address; from: Address; to: Address; amount: string;
    receiptId?: string; claimant?: Address; collection?: Address; standard?: 1 | 2;
    tokenIds?: string[]; quantities?: string[];
    evidence: "exact-receipt-transfer-and-single-transaction-block-deltas";
    origin?: ReclaimOrigin;
  };
};
export type ReclaimFixtureSnapshot = BlockEvidence & {
  campaign: Address; controller: Address; controllerEpoch: string; policyEpoch: string;
  rewardPerUnit: string; walletCap: number; paused: boolean; closed: boolean;
  reserve: string; funded: string; paid: string; repaid: string; recovered: string; unsolicited: string;
  outstandingLiability: "0"; rewardBalance: string; tradeInNonce: string;
  collections: { collection: Address; runtimeHash: Hash; eligibilityRoot: Hash; collectionCap: number;
    walletCap: number; standard: 0 | 1 | 2; enabled: boolean }[];
};
export type ReclaimFixtureRange = {
  births: ReclaimFixtureBirth[]; events: ReclaimFixtureEvent[]; states: ReclaimFixtureSnapshot[];
};
