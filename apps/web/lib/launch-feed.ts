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
  transactionHash: Hash;
  blockNumber: string;
  metadataURI: string;
  reserveWei: string;
  progressBps: number;
  graduated: boolean;
  image?: string;
};

export type LaunchFeedResponse = {
  launches: LaunchFeedItem[];
  syncedAt: string;
};
