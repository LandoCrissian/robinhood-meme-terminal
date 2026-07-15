"use client";

import { useQuery } from "@tanstack/react-query";
import { type Address, type Hash } from "viem";
import { usePublicClient } from "wagmi";
import { rmtLaunchFactoryV6Abi } from "./contracts";
import { activeChain, activeFactoryStartBlock } from "./network";
import { useFactoryAddress } from "./use-factory-address";

const tokenIdentityAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "metadataURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }
] as const;

export type LaunchRecordHint = {
  launchId: string;
  token: Address;
  blockNumber?: string;
  transactionHash?: Hash;
};

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

function sameAddress(left: Address, right: Address) {
  return left.toLowerCase() === right.toLowerCase();
}

export function useLaunchRecord(tokenAddress: Address, hint?: LaunchRecordHint) {
  const factoryAddress = useFactoryAddress();
  const publicClient = usePublicClient({ chainId: activeChain.id });

  return useQuery({
    queryKey: ["launch-record", activeChain.id, factoryAddress, tokenAddress, hint?.launchId ?? "discover"],
    enabled: Boolean(factoryAddress && publicClient),
    staleTime: 60_000,
    gcTime: 30 * 60 * 1000,
    retry: 2,
    retryDelay: (attempt) => Math.min(750 * 2 ** attempt, 3_000),
    refetchOnReconnect: true,
    queryFn: async (): Promise<LaunchRecord | null> => {
      if (!factoryAddress || !publicClient) return null;

      const protocolVersion = await publicClient.readContract({
        address: factoryAddress,
        abi: rmtLaunchFactoryV6Abi,
        functionName: "protocolVersion"
      });
      if (protocolVersion !== 6) return null;

      let launchId: bigint | null = hint ? BigInt(hint.launchId) : null;
      let storedLaunch = launchId === null ? null : await publicClient.readContract({
        address: factoryAddress,
        abi: rmtLaunchFactoryV6Abi,
        functionName: "getLaunch",
        args: [launchId]
      }).catch(() => null);

      if (storedLaunch && !sameAddress(storedLaunch.token, tokenAddress)) {
        storedLaunch = null;
        launchId = null;
      }

      if (!storedLaunch) {
        const launchCount = await publicClient.readContract({
          address: factoryAddress,
          abi: rmtLaunchFactoryV6Abi,
          functionName: "launchCount"
        });
        const batchSize = 10n;
        let end = launchCount;
        while (end > 0n && !storedLaunch) {
          const start = end > batchSize ? end - batchSize : 0n;
          const ids = Array.from({ length: Number(end - start) }, (_, index) => end - 1n - BigInt(index));
          const results = await Promise.all(ids.map((id) => publicClient.readContract({
              address: factoryAddress,
              abi: rmtLaunchFactoryV6Abi,
              functionName: "getLaunch",
              args: [id]
            }).catch(() => null)));
          const matchIndex = results.findIndex((result) => result !== null && sameAddress(result.token, tokenAddress));
          if (matchIndex >= 0) {
            const match = results[matchIndex];
            if (match) {
              storedLaunch = match;
              launchId = ids[matchIndex];
            }
          }
          end = start;
        }
      }

      if (!storedLaunch || launchId === null) return null;

      const [policy, identity] = await Promise.all([
        publicClient.readContract({
          address: factoryAddress,
          abi: rmtLaunchFactoryV6Abi,
          functionName: "getPolicy",
          args: [storedLaunch.policyId]
        }),
        Promise.all([
          publicClient.readContract({ address: tokenAddress, abi: tokenIdentityAbi, functionName: "name" }),
          publicClient.readContract({ address: tokenAddress, abi: tokenIdentityAbi, functionName: "symbol" }),
          publicClient.readContract({ address: tokenAddress, abi: tokenIdentityAbi, functionName: "metadataURI" })
        ])
      ]);

      if (Number(policy.policyVersion) !== Number(storedLaunch.policyVersion)) return null;

      return {
        launchId,
        token: storedLaunch.token,
        creator: storedLaunch.creator,
        market: storedLaunch.market,
        rewardVault: storedLaunch.rewardVault,
        name: identity[0],
        symbol: identity[1],
        metadataURI: identity[2],
        rewardBps: [Number(policy.creatorFeeShareBps), 0, 0, 0, Number(policy.protocolFeeShareBps)],
        policyId: storedLaunch.policyId,
        policyVersion: Number(storedLaunch.policyVersion),
        curveFeeBps: Number(policy.curveFeeBps),
        postGraduationFeeBps: Number(policy.postGraduationFeeBps),
        graduationTarget: policy.graduationTarget,
        fairStartEnabled: Number(policy.fairStartMode) !== 0,
        fairStartDelayBlocks: policy.fairStartDelayBlocks,
        fairStartDurationBlocks: policy.fairStartDurationBlocks,
        fairStartMaxTxBps: Number(policy.fairStartMaxTxBps),
        fairStartMaxWalletBps: Number(policy.fairStartMaxWalletBps),
        officialMigration: storedLaunch.officialMigration,
        blockNumber: hint?.blockNumber && BigInt(hint.launchId) === launchId ? BigInt(hint.blockNumber) : activeFactoryStartBlock,
        transactionHash: hint && BigInt(hint.launchId) === launchId ? hint.transactionHash ?? null : null
      };
    }
  });
}
