import { createPublicClient, getAddress, http, isAddress } from "viem";
import {
  getFactoryAddress,
  memeLaunchFactoryAbi,
  publicMainnetVersionRegistryAddress,
  versionRegistryAbi
} from "../contracts";
import { activeChain, activeFactoryStartBlock, isMainnetRelease } from "../network";
import type { LaunchFeedItem } from "../launch-feed";
import { resolveTokenMetadata } from "../token-metadata";

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
      rewardVault: log.args.rewardVault,
      name: log.args.name,
      symbol: log.args.symbol,
      creatorBps: Number(log.args.rewardBps[0]),
      communityBps: Number(log.args.rewardBps[1]),
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber.toString(),
      metadataURI: log.args.metadataURI
    }] : []));

    if (fromBlock === requestedStart) break;
    cursor = fromBlock - 1n;
  }

  launches.sort((a, b) => BigInt(a.blockNumber) > BigInt(b.blockNumber) ? -1 : 1);
  const recent = launches.slice(0, limit);
  return Promise.all(recent.map(async (launch) => {
    const metadata = await resolveTokenMetadata(launch.metadataURI);
    return { ...launch, image: metadata?.image };
  }));
}
