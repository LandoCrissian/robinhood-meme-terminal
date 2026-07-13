import { createPublicClient, getAddress, http, isAddress, type Address } from "viem";
import {
  getFactoryAddress,
  memeLaunchFactoryAbi,
  publicMainnetVersionRegistryAddress,
  versionRegistryAbi
} from "../contracts";
import { activeChain, activeFactoryStartBlock, isMainnetRelease } from "../network";
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
  transport: http(activeChain.rpcUrls.default.http[0], { retryCount: 2, timeout: 8_000 })
});

async function resolveActiveFactory() {
  if (!isMainnetRelease) return getFactoryAddress();
  const registered = await publicClient.readContract({
    address: publicMainnetVersionRegistryAddress,
    abi: versionRegistryAbi,
    functionName: "activeFactory"
  });
  return isAddress(registered) ? getAddress(registered) : null;
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

export async function readFreshLaunches(limit = 25): Promise<LaunchFeedItem[]> {
  const factoryAddress = await resolveActiveFactory();
  if (!factoryAddress) return [];

  const latestBlock = await publicClient.getBlockNumber();
  const configuredStart = process.env.NEXT_PUBLIC_FACTORY_START_BLOCK;
  const requestedStart = configuredStart && /^\d+$/.test(configuredStart)
    ? BigInt(configuredStart)
    : activeFactoryStartBlock;
  let cursor = latestBlock;
  const launches: LaunchFeedItem[] = [];

  while (cursor >= requestedStart && launches.length < limit) {
    const candidate = cursor > 19_999n ? cursor - 19_999n : 0n;
    const fromBlock = candidate < requestedStart ? requestedStart : candidate;
    const logs = await publicClient.getContractEvents({
      address: factoryAddress,
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
