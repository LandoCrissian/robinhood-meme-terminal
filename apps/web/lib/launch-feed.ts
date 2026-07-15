import type { Address, Hash } from "viem";

export type LaunchFeedItem = {
  launchId: string;
  token: Address;
  creator: Address;
  market: Address;
  rewardVault: Address;
  name: string;
  symbol: string;
  creatorBps: number;
  communityBps: number;
  protocolVersion?: number;
  policyId?: Hash;
  policyVersion?: number;
  curveFeeBps?: number;
  protocolFeeShareBps?: number;
  postGraduationFeeBps?: number;
  graduationTarget?: string;
  fairStartEnabled?: boolean;
  officialMigration?: boolean;
  transactionHash: Hash;
  blockNumber: string;
  metadataURI: string;
  reserveWei: string;
  volumeWei: string;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  progressBps: number;
  graduated: boolean;
  image?: string;
};

export type LaunchFeedResponse = {
  launches: LaunchFeedItem[];
  syncedAt: string;
};
