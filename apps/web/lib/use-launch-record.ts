"use client";

import { useQuery } from "@tanstack/react-query";
import { type Address, type Hash } from "viem";
import { usePublicClient } from "wagmi";
import { robinhoodChainTestnet } from "@rmt/shared/chains";
import { memeLaunchFactoryAbi, publicTestnetFactoryStartBlock } from "./contracts";
import { useFactoryAddress } from "./use-factory-address";

export type LaunchRecord = {
  launchId: bigint;
  token: Address;
  creator: Address;
  market: Address;
  rewardVault: Address;
  metadataURI: string;
  rewardBps: readonly [number, number, number, number, number];
  blockNumber: bigint;
  transactionHash: Hash | null;
};

export function useLaunchRecord(tokenAddress: Address) {
  const factoryAddress = useFactoryAddress();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });

  return useQuery({
    queryKey: ["launch-record", robinhoodChainTestnet.id, factoryAddress, tokenAddress],
    enabled: Boolean(factoryAddress && publicClient),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    queryFn: async (): Promise<LaunchRecord | null> => {
      if (!factoryAddress || !publicClient) return null;

      let cursor = await publicClient.getBlockNumber();
      while (cursor >= publicTestnetFactoryStartBlock) {
        const candidate = cursor > 19_999n ? cursor - 19_999n : 0n;
        const fromBlock = candidate < publicTestnetFactoryStartBlock ? publicTestnetFactoryStartBlock : candidate;
        const logs = await publicClient.getContractEvents({
          address: factoryAddress,
          abi: memeLaunchFactoryAbi,
          eventName: "TokenLaunched",
          args: { token: tokenAddress },
          fromBlock,
          toBlock: cursor,
          strict: true
        });
        const log = logs[0];
        if (log) {
          return {
            launchId: log.args.launchId,
            token: log.args.token,
            creator: log.args.creator,
            market: log.args.market,
            rewardVault: log.args.rewardVault,
            metadataURI: log.args.metadataURI,
            rewardBps: log.args.rewardBps.map(Number) as [number, number, number, number, number],
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash
          };
        }
        if (fromBlock === publicTestnetFactoryStartBlock) break;
        cursor = fromBlock - 1n;
      }

      return null;
    }
  });
}
