import type {
  RmtNftProjectMarketReadModel,
  RmtNftProjectMarketplaceRead,
  RmtNftProjectOnchainRead,
} from "@rmt/shared/nft/project-market";
import { RMT_NFT_ACTIVITY_SOURCES } from "@rmt/shared/nft/activity-sources";
import { rmtCuratedNftProject } from "@rmt/shared/nft/project-registry";
import { isAddressEqual } from "viem";

type ReaderOptions = {
  env?: Partial<NodeJS.ProcessEnv>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function configuration(env: Partial<NodeJS.ProcessEnv>, prefix: "NFT_INDEXER" | "NFT_MARKETPLACE_INDEXER") {
  const url = env[`${prefix}_URL`]?.trim();
  const token = env[`${prefix}_READ_TOKEN`]?.trim();
  if (!url || !token) return null;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || token.length < 32) return null;
    return { url: parsed.origin, token };
  } catch {
    return null;
  }
}

async function readService<T>(fetchImpl: typeof fetch, url: string, token: string, timeoutMs: number): Promise<T> {
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Internal NFT evidence service returned ${response.status}.`);
  return await response.json() as T;
}

function validateOnchain(value: RmtNftProjectOnchainRead, projectId: string, address: `0x${string}`) {
  if (value.projectId !== projectId || value.chainId !== 4663 || !isAddressEqual(value.collectionAddress, address)) {
    throw new Error("NFT onchain response identity mismatch.");
  }
  if (value.recentActivity.some((item) => item.marketMeaning !== "NOT_ESTABLISHED" || !["MINT", "TRANSFER", "BURN"].includes(item.kind))) {
    throw new Error("NFT onchain response authority mismatch.");
  }
  return value;
}

function validateMarketplace(value: RmtNftProjectMarketplaceRead, projectId: string, address: `0x${string}`) {
  if (value.projectId !== projectId || value.chainId !== 4663 || !isAddressEqual(value.collectionAddress, address)
    || value.provider !== "OPENSEA" || value.protocol !== "SEAPORT_1_6") {
    throw new Error("NFT marketplace response identity mismatch.");
  }
  if (value.recentProviderSales.some((sale) => sale.authority !== "PROVIDER_REPORTED_SALE" || sale.settlementVerificationStatus !== "NOT_VERIFIED")) {
    throw new Error("NFT marketplace response authority mismatch.");
  }
  return value;
}

export async function readRmtNftProjectMarket(
  projectId: string,
  options: ReaderOptions = {},
): Promise<RmtNftProjectMarketReadModel | null> {
  const project = rmtCuratedNftProject(projectId);
  if (!project || project.status !== "ACTIVE") return null;
  const source = RMT_NFT_ACTIVITY_SOURCES.find((item) => item.projectId === project.projectId);
  if (!source) return null;
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const onchainConfig = configuration(env, "NFT_INDEXER");
  const marketplaceConfig = configuration(env, "NFT_MARKETPLACE_INDEXER");

  const [onchainResult, marketplaceResult] = await Promise.allSettled([
    onchainConfig
      ? readService<RmtNftProjectOnchainRead>(fetchImpl, `${onchainConfig.url}/internal/v1/projects/${project.projectId}/onchain`, onchainConfig.token, timeoutMs)
      : Promise.reject(new Error("NFT indexer read configuration is missing.")),
    marketplaceConfig
      ? readService<RmtNftProjectMarketplaceRead>(fetchImpl, `${marketplaceConfig.url}/internal/v1/projects/${project.projectId}/marketplace`, marketplaceConfig.token, timeoutMs)
      : Promise.reject(new Error("NFT marketplace indexer read configuration is missing.")),
  ]);
  let onchain: RmtNftProjectMarketReadModel["onchain"] = { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" };
  let marketplace: RmtNftProjectMarketReadModel["marketplace"] = { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" };
  try {
    if (onchainResult.status === "fulfilled") onchain = validateOnchain(onchainResult.value, project.projectId, source.collectionAddress);
  } catch {}
  try {
    if (marketplaceResult.status === "fulfilled") marketplace = validateMarketplace(marketplaceResult.value, project.projectId, source.collectionAddress);
  } catch {}

  return {
    schemaVersion: 1,
    project: {
      projectId: project.projectId,
      displayName: project.displayName,
      status: project.status,
      rmtCurated: true,
      chainId: 4663,
      collections: [{ contractAddress: source.collectionAddress, standard: source.standard }],
      links: project.links.filter((link) => link.visibility === "PUBLIC").map(({ label, url }) => ({ label, url })),
    },
    onchain,
    marketplace,
    projectToken: project.projectToken,
  };
}
