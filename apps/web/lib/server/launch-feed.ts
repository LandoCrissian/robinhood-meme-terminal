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

async function readMarketSignals(market: Address, launchBlock: bigint, latestBlock: bigint) {
  try {
    const windowStart = latestBlock > 19_999n ? latestBlock - 19_999n : 0n;
    const activityFromBlock = launchBlock > windowStart ? launchBlock : windowStart;
    const [reserve, progress, graduated, trades] = await Promise.all([
      publicClient.readContract({ address: market, abi: marketSignalsAbi, functionName: "realEthReserve" }),
      publicClient.readContract({ address: market, abi: marketSignalsAbi, functionName: "progressBps" }),
      publicClient.readContract({ address: market, abi: marketSignalsAbi, functionName: "graduated" }),
      publicClient.getContractEvents({
        address: market,
        abi: marketSignalsAbi,
        eventName: "Trade",
        fromBlock: activityFromBlock,
        toBlock: latestBlock,
        strict: true
      }).catch(() => [])
    ]);

    let volume = 0n;
    let buyCount = 0;
    let sellCount = 0;
    for (const trade of trades) {
      volume += trade.args.ethAmount;
      if (trade.args.isBuy) buyCount += 1;
      else sellCount += 1;
    }

    return {
      reserveWei: reserve.toString(),
      volumeWei: volume.toString(),
      tradeCount: trades.length,
      buyCount,
      sellCount,
      progressBps: Math.min(10_000, Number(progress)),
      graduated
    };
  } catch {
    return {
      reserveWei: "0",
      volumeWei: "0",
      tradeCount: 0,
      buyCount: 0,
      sellCount: 0,
      progressBps: 0,
      graduated: false
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

  launches.sort((a, b) => BigInt(a.blockNumber) > BigInt(b.blockNumber) ? -1 : 1);
  const recent = launches.slice(0, limit);
  return Promise.all(recent.map(async (launch) => {
    const [metadata, signals] = await Promise.all([
      resolveTokenMetadata(launch.metadataURI),
      readMarketSignals(launch.market, BigInt(launch.blockNumber), latestBlock)
    ]);
    return { ...launch, ...signals, image: metadata?.image };
  }));
}
