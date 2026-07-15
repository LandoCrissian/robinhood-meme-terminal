"use client";

import { useQuery } from "@tanstack/react-query";
import { type Address, type Hash } from "viem";
import { usePublicClient } from "wagmi";
import { rmtLaunchFactoryV6Abi } from "./contracts";
import { activeChain, activeFactoryStartBlock } from "./network";
import { useFactoryAddress } from "./use-factory-address";

export type LaunchRecord = {
  launchId: bigint;
  token: Address;
  creator: Address;
  market: Address;
  rewardVault: Address;
  name: string;
  symbol: string;
  metadataURI: string;
  rewardBps: readonly [number, number, number, number, number];
  policyId: Hash;
  policyVersion: number;
  curveFeeBps: number;
  postGraduationFeeBps: number;
  graduationTarget: bigint;
  fairStartEnabled: boolean;
  fairStartDelayBlocks: bigint;
  fairStartDurationBlocks: bigint;
  fairStartMaxTxBps: number;
  fairStartMaxWalletBps: number;
  officialMigration: boolean;
  blockNumber: bigint;
  transactionHash: Hash | null;
};

export function useLaunchRecord(tokenAddress: Address) {
  const factoryAddress = useFactoryAddress();
  const publicClient = usePublicClient({ chainId: activeChain.id });

  return useQuery({
    queryKey: ["launch-record", activeChain.id, factoryAddress, tokenAddress],
    enabled: Boolean(factoryAddress && publicClient),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    queryFn: async (): Promise<LaunchRecord | null> => {
      if (!factoryAddress || !publicClient) return null;

      const protocolVersion = await publicClient.readContract({
        address: factoryAddress,
        abi: rmtLaunchFactoryV6Abi,
        functionName: "protocolVersion"
      }).catch(() => null);
      if (protocolVersion !== 6) return null;

      let cursor = await publicClient.getBlockNumber();
      while (cursor >= activeFactoryStartBlock) {
        const candidate = cursor > 19_999n ? cursor - 19_999n : 0n;
        const fromBlock = candidate < activeFactoryStartBlock ? activeFactoryStartBlock : candidate;
        const logs = await publicClient.getContractEvents({
          address: factoryAddress,
          abi: rmtLaunchFactoryV6Abi,
          eventName: "TokenLaunchedV6",
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
            rewardVault: log.args.feeSplitter,
            name: log.args.name,
            symbol: log.args.symbol,
            metadataURI: log.args.metadataURI,
            rewardBps: [Number(log.args.creatorFeeShareBps), 0, 0, 0, Number(log.args.protocolFeeShareBps)],
            policyId: log.args.policyId,
            policyVersion: Number(log.args.policyVersion),
            curveFeeBps: Number(log.args.curveFeeBps),
            postGraduationFeeBps: Number(log.args.postGraduationFeeBps),
            graduationTarget: log.args.graduationTarget,
            fairStartEnabled: log.args.fairStartEnabled,
            fairStartDelayBlocks: log.args.fairStartDelayBlocks,
            fairStartDurationBlocks: log.args.fairStartDurationBlocks,
            fairStartMaxTxBps: Number(log.args.fairStartMaxTxBps),
            fairStartMaxWalletBps: Number(log.args.fairStartMaxWalletBps),
            officialMigration: log.args.officialMigration,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash
          };
        }
        if (fromBlock === activeFactoryStartBlock) break;
        cursor = fromBlock - 1n;
      }

      return null;
    }
  });
}
