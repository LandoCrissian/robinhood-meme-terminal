import type {
  RmtNftProjectMarketReadModel,
  RmtNftProjectMarketplaceRead,
  RmtNftProjectOnchainRead,
} from "@rmt/shared/nft/project-market";
import { RMT_NFT_ACTIVITY_SOURCES } from "@rmt/shared/nft/activity-sources";
import { RMT_SEAPORT_1_6_ADDRESS } from "@rmt/shared/nft/marketplace-evidence";
import { rmtCuratedNftProject } from "@rmt/shared/nft/project-registry";
import { isAddress, isAddressEqual } from "viem";

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

const DECIMAL_INTEGER = /^(0|[1-9]\d*)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDecimalInteger(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_INTEGER.test(value);
}

function isPositiveInteger(value: unknown): value is string {
  return isDecimalInteger(value) && value !== "0";
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isMovementKind(value: unknown): value is "MINT" | "TRANSFER" | "BURN" {
  return value === "MINT" || value === "TRANSFER" || value === "BURN";
}

function isHex32(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function sameAddress(value: unknown, expected: `0x${string}`) {
  return typeof value === "string" && isAddress(value) && isAddressEqual(value, expected);
}

function validAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && isAddress(value);
}

function validPaymentAsset(value: unknown): boolean {
  if (!isRecord(value) || value.chainId !== 4663 || typeof value.symbol !== "string"
    || !Number.isInteger(value.decimals) || (value.decimals as number) < 0 || (value.decimals as number) > 255) return false;
  if (value.kind === "NATIVE") return value.address === null;
  return value.kind === "ERC20" && typeof value.address === "string" && isAddress(value.address);
}

function validateOnchain(
  input: unknown,
  projectId: string,
  address: `0x${string}`,
  standard: "ERC721" | "ERC1155",
) {
  if (!isRecord(input)) throw new Error("NFT onchain response is malformed.");
  const value = input as unknown as RmtNftProjectOnchainRead;
  if (value.schemaVersion !== 1 || value.projectId !== projectId || value.chainId !== 4663
    || !sameAddress(value.collectionAddress, address) || value.collectionStandard !== standard) {
    throw new Error("NFT onchain response identity mismatch.");
  }
  if (!Array.isArray(value.recentActivity) || !isTimestamp(value.asOf)
    || (value.holderCount !== null && !isDecimalInteger(value.holderCount))
    || (value.circulatingTokenCount !== null && !isDecimalInteger(value.circulatingTokenCount))) {
    throw new Error("NFT onchain response is malformed.");
  }
  const coherent = value.sourceStatus === "SYNCED"
    ? value.availability === "AVAILABLE" && value.completeness === "COMPLETE"
    : value.sourceStatus === "BACKFILLING"
      ? value.availability === "PARTIAL" && value.completeness === "PARTIAL"
        && value.holderCount === null && value.circulatingTokenCount === null
      : value.sourceStatus === "ERROR"
        && value.availability === "UNAVAILABLE" && value.completeness === "UNAVAILABLE"
        && value.holderCount === null && value.circulatingTokenCount === null && value.recentActivity.length === 0;
  if (!coherent) throw new Error("NFT onchain response state is contradictory.");
  if (value.recentActivity.some((item) => !isRecord(item)
    || item.marketMeaning !== "NOT_ESTABLISHED" || !isMovementKind(item.kind)
    || !isDecimalInteger(item.blockNumber) || !isDecimalInteger(item.tokenId) || !isDecimalInteger(item.amount)
    || !isNonnegativeSafeInteger(item.logIndex) || !isNonnegativeSafeInteger(item.movementIndex)
    || !isHex32(item.transactionHash) || !isHex32(item.blockHash)
    || typeof item.from !== "string" || !isAddress(item.from)
    || typeof item.to !== "string" || !isAddress(item.to))) {
    throw new Error("NFT onchain response authority mismatch.");
  }
  return value;
}

function validateMarketplace(input: unknown, projectId: string, address: `0x${string}`) {
  if (!isRecord(input)) throw new Error("NFT marketplace response is malformed.");
  const value = input as unknown as RmtNftProjectMarketplaceRead;
  if (value.schemaVersion !== 1 || value.projectId !== projectId || value.chainId !== 4663 || !sameAddress(value.collectionAddress, address)
    || value.provider !== "OPENSEA" || value.protocol !== "SEAPORT_1_6") {
    throw new Error("NFT marketplace response identity mismatch.");
  }
  if (!Array.isArray(value.recentProviderSales) || !Array.isArray(value.volume24hByPaymentAsset)
    || !["BACKFILLING", "SYNCED", "ERROR"].includes(value.sourceStatus)
    || !["AVAILABLE", "PARTIAL", "UNAVAILABLE"].includes(value.availability)
    || !["EXACT_CONTRACT_SCOPE", "MULTI_CONTRACT_COLLECTION_SCOPE"].includes(value.identityScope)
    || typeof value.providerCollectionSlug !== "string" || value.providerCollectionSlug.length === 0
    || ![null, "STALE", "SOURCE_ERROR", "SOURCE_STALE", "SOURCE_NOT_READY"].includes(value.availabilityReason)
    || (value.asOf !== null && !isTimestamp(value.asOf))) throw new Error("NFT marketplace response is malformed.");
  if (["SOURCE_ERROR", "SOURCE_STALE", "SOURCE_NOT_READY"].includes(value.availabilityReason ?? "")
    && (value.availability !== "UNAVAILABLE" || value.lowestNormalizedListing !== null
      || value.recentProviderSales.length !== 0 || value.volume24hByPaymentAsset.length !== 0)) {
    throw new Error("NFT marketplace unavailable source contains current evidence.");
  }
  if (value.availabilityReason === "SOURCE_NOT_READY" && value.asOf !== null) {
    throw new Error("NFT marketplace not-ready source has observation provenance.");
  }
  if ((value.sourceStatus === "ERROR") !== (value.availabilityReason === "SOURCE_ERROR")
    || (value.sourceStatus === "ERROR" && value.availability !== "UNAVAILABLE")) {
    throw new Error("NFT marketplace error state is contradictory.");
  }
  if (value.sourceStatus === "BACKFILLING" && !["PARTIAL", "UNAVAILABLE"].includes(value.availability)) {
    throw new Error("NFT marketplace backfill state is contradictory.");
  }
  if (value.sourceStatus === "SYNCED" && !["AVAILABLE", "UNAVAILABLE"].includes(value.availability)) {
    throw new Error("NFT marketplace synced state is contradictory.");
  }
  const listing = value.lowestNormalizedListing;
  if (listing !== null && (!isRecord(listing)
    || listing.authority !== "LOWEST_NORMALIZED_OPENSEA_LISTING" || listing.rmtExecutable !== false
    || !sameAddress(listing.protocolAddress, RMT_SEAPORT_1_6_ADDRESS)
    || !isHex32(listing.orderHash) || !isDecimalInteger(listing.tokenId)
    || !isPositiveInteger(listing.quantity) || !isDecimalInteger(listing.grossAmount)
    || !isTimestamp(listing.exactRevalidatedAt) || !validPaymentAsset(listing.paymentAsset)
    || listing.paymentAsset.kind !== "NATIVE" || listing.paymentAsset.address !== null
    || listing.paymentAsset.chainId !== 4663 || !validAddress(listing.maker))) {
    throw new Error("NFT marketplace listing authority mismatch.");
  }
  if (value.recentProviderSales.some((sale) => !isRecord(sale)
    || sale.authority !== "PROVIDER_REPORTED_SALE" || sale.settlementVerificationStatus !== "NOT_VERIFIED"
    || !isDecimalInteger(sale.tokenId) || !isPositiveInteger(sale.quantity) || !isTimestamp(sale.eventTimestamp)
    || !validAddress(sale.seller) || !validAddress(sale.buyer)
    || (sale.transactionHash !== null && !isHex32(sale.transactionHash))
    || (sale.orderHash !== null && !isHex32(sale.orderHash))
    || (sale.grossAmount !== null && !isDecimalInteger(sale.grossAmount))
    || (sale.paymentAsset !== null && !validPaymentAsset(sale.paymentAsset)))) {
    throw new Error("NFT marketplace response authority mismatch.");
  }
  if (value.volume24hByPaymentAsset.some((volume) => !isRecord(volume)
    || volume.authority !== "OPENSEA_REPORTED_24H_VOLUME" || !validPaymentAsset(volume.paymentAsset)
    || !isDecimalInteger(volume.grossAmount) || !isNonnegativeSafeInteger(volume.saleCount))) {
    throw new Error("NFT marketplace volume authority mismatch.");
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
      ? readService<unknown>(fetchImpl, `${onchainConfig.url}/internal/v1/projects/${project.projectId}/onchain`, onchainConfig.token, timeoutMs)
      : Promise.reject(new Error("NFT indexer read configuration is missing.")),
    marketplaceConfig
      ? readService<unknown>(fetchImpl, `${marketplaceConfig.url}/internal/v1/projects/${project.projectId}/marketplace`, marketplaceConfig.token, timeoutMs)
      : Promise.reject(new Error("NFT marketplace indexer read configuration is missing.")),
  ]);
  let onchain: RmtNftProjectMarketReadModel["onchain"] = { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" };
  let marketplace: RmtNftProjectMarketReadModel["marketplace"] = { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" };
  try {
    if (onchainResult.status === "fulfilled") onchain = validateOnchain(onchainResult.value, project.projectId, source.collectionAddress, source.standard);
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
