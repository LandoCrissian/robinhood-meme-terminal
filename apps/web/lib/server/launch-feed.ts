import { createPublicClient, getAddress, http, isAddress, keccak256, toHex, type Address } from "viem";
import {
  getFactoryAddress,
  isFreshMainnetVersionRegistryConfigured,
  isMainnetVersionRegistryConfigurationValid,
  memeLaunchFactoryAbi,
  publicMainnetV5FactoryAddress,
  rmtLaunchFactoryV6Abi,
  publicMainnetVersionRegistryAddress,
  versionRegistryAbi
} from "../contracts";
import {
  activeChain,
  activeFactoryStartBlock,
  isFactoryStartBlockConfigurationValid,
  isFactoryStartBlockExplicitlyConfigured,
  isMainnetRelease,
  publicMainnetV5FactoryStartBlock
} from "../network";
import type { LaunchFeedItem } from "../launch-feed";
import { resolveTokenMetadata } from "../token-metadata";

const marketSignalsAbi = [
  { type: "function", name: "realEthReserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "progressBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "graduated", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  {
    type: "event",
    name: "Trade",
    anonymous: false,
    inputs: [
      { name: "trader", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "isBuy", type: "bool", indexed: true },
      { name: "tokenAmount", type: "uint256", indexed: false },
      { name: "ethAmount", type: "uint256", indexed: false },
      { name: "feeAmount", type: "uint256", indexed: false },
      { name: "virtualEthReserve", type: "uint256", indexed: false },
      { name: "virtualTokenReserve", type: "uint256", indexed: false },
      { name: "realEthReserve", type: "uint256", indexed: false }
    ]
  }
] as const;

const tokenBalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }]
  }
] as const;

const publicClient = createPublicClient({
  chain: activeChain,
  transport: http(
    isMainnetRelease
      ? process.env.RMT_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_RPC_URL ?? activeChain.rpcUrls.default.http[0]
      : process.env.RMT_TESTNET_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_TESTNET_RPC_URL ?? activeChain.rpcUrls.default.http[0],
    { retryCount: 3, timeout: 12_000 }
  )
});
const V5_VERSION = keccak256(toHex("RMT_FACTORY_V5"));
const V6_VERSION = keccak256(toHex("RMT_FACTORY_V6"));
const FIXED_TOKEN_SUPPLY = 1_000_000_000n * 10n ** 18n;

export async function resolveActiveFactory() {
  if (!isMainnetRelease) {
    const address = getFactoryAddress();
    if (!address) return null;
    const protocolVersion = await publicClient.readContract({
      address,
      abi: rmtLaunchFactoryV6Abi,
      functionName: "protocolVersion"
    }).catch(() => null);
    return { address, version: Number(protocolVersion) === 6 ? 6 : 5 } as const;
  }
  if (!isMainnetVersionRegistryConfigurationValid) return null;
  const [registered, registeredVersion] = await Promise.all([
    publicClient.readContract({
      address: publicMainnetVersionRegistryAddress,
      abi: versionRegistryAbi,
      functionName: "activeFactory"
    }),
    publicClient.readContract({
      address: publicMainnetVersionRegistryAddress,
      abi: versionRegistryAbi,
      functionName: "activeVersion"
    })
  ]);
  if (!isAddress(registered)) return null;
  const address = getAddress(registered);
  if (registeredVersion === V5_VERSION && address === publicMainnetV5FactoryAddress) {
    return { address, version: 5 } as const;
  }
  if (
    registeredVersion === V6_VERSION
      && isFreshMainnetVersionRegistryConfigured
      && isFactoryStartBlockExplicitlyConfigured
      && isFactoryStartBlockConfigurationValid
  ) return { address, version: 6 } as const;
  return null;
}

async function readMarketSignals(
  market: Address,
  token: Address,
  creator: Address,
  launchBlock: bigint,
  latestBlock: bigint
) {
  try {
    const windowStart = latestBlock > 19_999n ? latestBlock - 19_999n : 0n;
    const activityFromBlock = launchBlock > windowStart ? launchBlock : windowStart;
    const [reserve, progress, graduated, creatorBalanceRead, marketInventoryRead, tradesRead] = await Promise.all([
      publicClient.readContract({ address: market, abi: marketSignalsAbi, functionName: "realEthReserve" }),
      publicClient.readContract({ address: market, abi: marketSignalsAbi, functionName: "progressBps" }),
      publicClient.readContract({ address: market, abi: marketSignalsAbi, functionName: "graduated" }),
      publicClient.readContract({ address: token, abi: tokenBalanceAbi, functionName: "balanceOf", args: [creator] }).catch(() => null),
      publicClient.readContract({ address: token, abi: tokenBalanceAbi, functionName: "balanceOf", args: [market] }).catch(() => null),
      publicClient.getContractEvents({
        address: market,
        abi: marketSignalsAbi,
        eventName: "Trade",
        fromBlock: activityFromBlock,
        toBlock: latestBlock,
        strict: true
      }).catch(() => null)
    ]);

    const trades = tradesRead ?? [];
    const creatorAddress = creator.toLowerCase();
    let volume = 0n;
    let buyCount = 0;
    let sellCount = 0;
    let creatorBought = 0n;
    let creatorSold = 0n;
    let creatorTradeCount = 0;
    for (const trade of trades) {
      volume += trade.args.ethAmount;
      if (trade.args.isBuy) buyCount += 1;
      else sellCount += 1;
      if (trade.args.trader.toLowerCase() !== creatorAddress) continue;
      creatorTradeCount += 1;
      if (trade.args.isBuy) creatorBought += trade.args.tokenAmount;
      else creatorSold += trade.args.tokenAmount;
    }

    const creatorBalance = creatorBalanceRead ?? null;
    const marketInventory = marketInventoryRead ?? null;
    const circulatingSupply = marketInventory !== null && FIXED_TOKEN_SUPPLY > marketInventory
      ? FIXED_TOKEN_SUPPLY - marketInventory
      : 0n;
    const creatorOutsideCurveBps = creatorBalance === null || marketInventory === null
      ? undefined
      : creatorBalance === 0n
        ? 0
        : circulatingSupply > 0n
          ? Math.min(10_000, Number(creatorBalance * 10_000n / circulatingSupply))
          : undefined;
    const creatorNet = creatorBought - creatorSold;
    const creatorFlow: NonNullable<LaunchFeedItem["creatorFlow"]> = tradesRead === null
      ? "unknown"
      : creatorTradeCount === 0
        ? "inactive"
        : creatorNet > 0n
          ? "buying"
          : creatorNet < 0n
            ? "selling"
            : "balanced";

    return {
      reserveWei: reserve.toString(),
      volumeWei: volume.toString(),
      tradeCount: trades.length,
      buyCount,
      sellCount,
      progressBps: Math.min(10_000, Number(progress)),
      graduated,
      creatorBalanceWei: creatorBalance === null ? undefined : creatorBalance.toString(),
      creatorOutsideCurveBps,
      creatorFlow
    };
  } catch {
    return {
      reserveWei: "0",
      volumeWei: "0",
      tradeCount: 0,
      buyCount: 0,
      sellCount: 0,
      progressBps: 0,
      graduated: false,
      creatorFlow: "unknown" as const
    };
  }
}
export async function readFreshLaunches(
  limit = 25,
  resolvedFactory?: Awaited<ReturnType<typeof resolveActiveFactory>>
): Promise<LaunchFeedItem[]> {
  const activeFactory = resolvedFactory ?? await resolveActiveFactory();
  if (!activeFactory) return [];

  const protocolVersion = await publicClient.readContract({
    address: activeFactory.address,
    abi: rmtLaunchFactoryV6Abi,
    functionName: "protocolVersion"
  }).catch(() => null);
  if (activeFactory.version === 6 && Number(protocolVersion) !== 6) return [];

  const latestBlock = await publicClient.getBlockNumber();
  const requestedStart = activeFactory.version === 6
    ? activeFactoryStartBlock
    : isMainnetRelease ? publicMainnetV5FactoryStartBlock : activeFactoryStartBlock;
  if (latestBlock < requestedStart) return [];
  let cursor = latestBlock;
  const launches: LaunchFeedItem[] = [];

  if (activeFactory.version === 6) {
    while (cursor >= requestedStart && launches.length < limit) {
      const candidate = cursor > 19_999n ? cursor - 19_999n : 0n;
      const fromBlock = candidate < requestedStart ? requestedStart : candidate;
      const logs = await publicClient.getContractEvents({
        address: activeFactory.address,
        abi: rmtLaunchFactoryV6Abi,
        eventName: "TokenLaunchedV6",
        fromBlock,
        toBlock: cursor,
        strict: true
      });

      launches.push(...logs.flatMap((log) => log.transactionHash ? [{
        launchId: log.args.launchId.toString(),
        token: log.args.token,
        creator: log.args.creator,
        market: log.args.market,
        rewardVault: log.args.feeSplitter,
        name: log.args.name,
        symbol: log.args.symbol,
        creatorBps: Number(log.args.creatorFeeShareBps),
        communityBps: 0,
        protocolVersion: 6,
        policyId: log.args.policyId,
        policyVersion: Number(log.args.policyVersion),
        curveFeeBps: Number(log.args.curveFeeBps),
        protocolFeeShareBps: Number(log.args.protocolFeeShareBps),
        postGraduationFeeBps: Number(log.args.postGraduationFeeBps),
        graduationTarget: log.args.graduationTarget.toString(),
        fairStartEnabled: log.args.fairStartEnabled,
        officialMigration: log.args.officialMigration,
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber.toString(),
        metadataURI: log.args.metadataURI,
        reserveWei: "0",
        volumeWei: "0",
        tradeCount: 0,
        buyCount: 0,
        sellCount: 0,
        progressBps: 0,
        graduated: false
      }] : []));

      if (fromBlock === requestedStart) break;
      cursor = fromBlock - 1n;
    }
  } else {
    while (cursor >= requestedStart && launches.length < limit) {
      const candidate = cursor > 19_999n ? cursor - 19_999n : 0n;
      const fromBlock = candidate < requestedStart ? requestedStart : candidate;
      const logs = await publicClient.getContractEvents({
        address: activeFactory.address,
        abi: memeLaunchFactoryAbi,
        eventName: "TokenLaunched",
        fromBlock,
        toBlock: cursor,
        strict: true
      });

      launches.push(...logs.flatMap((log) => log.transactionHash ? [{
        launchId: log.args.launchId.toString(),
        token: log.args.token,
        creator: log.args.creator,
        market: log.args.market,
        rewardVault: log.args.rewardVault,
        name: log.args.name,
        symbol: log.args.symbol,
        creatorBps: Number(log.args.rewardBps[0]),
        communityBps: Number(log.args.rewardBps[1]),
        protocolVersion: 5,
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber.toString(),
        metadataURI: log.args.metadataURI,
        reserveWei: "0",
        volumeWei: "0",
        tradeCount: 0,
        buyCount: 0,
        sellCount: 0,
        progressBps: 0,
        graduated: false
      }] : []));

      if (fromBlock === requestedStart) break;
      cursor = fromBlock - 1n;
    }
  }

  launches.sort((a, b) => {
    const blockDifference = BigInt(b.blockNumber) - BigInt(a.blockNumber);
    if (blockDifference !== 0n) return blockDifference > 0n ? 1 : -1;
    const launchDifference = BigInt(b.launchId) - BigInt(a.launchId);
    if (launchDifference !== 0n) return launchDifference > 0n ? 1 : -1;
    return a.token.toLowerCase().localeCompare(b.token.toLowerCase());
  });
  const recent = launches.slice(0, limit);
  return Promise.all(recent.map(async (launch) => {
    const [metadata, signals] = await Promise.all([
      resolveTokenMetadata(launch.metadataURI),
      readMarketSignals(launch.market, launch.token, launch.creator, BigInt(launch.blockNumber), latestBlock)
    ]);
    return { ...launch, ...signals, image: metadata?.image };
  }));
}
