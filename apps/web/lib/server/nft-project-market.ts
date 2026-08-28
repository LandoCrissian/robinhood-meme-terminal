import type {
  RmtNftProjectMarketReadModel,
  RmtNftProjectMarketplaceRead,
  RmtNftProjectOnchainRead,
} from "@rmt/shared/nft/project-market";
import type {
  RmtNftInventoryItem,
  RmtNftItemMetadata,
  RmtNftItemRead,
  RmtNftProjectInventoryRead,
} from "@rmt/shared/nft/project-inventory";
import { RMT_NFT_ACTIVITY_SOURCES } from "@rmt/shared/nft/activity-sources";
import { RMT_SEAPORT_1_6_ADDRESS } from "@rmt/shared/nft/marketplace-evidence";
import { rmtCuratedNftProject } from "@rmt/shared/nft/project-registry";
import { isSafeRmtNftInlineSvg } from "@rmt/shared/nft/inline-svg-safety";
import { isAddress, isAddressEqual, zeroAddress } from "viem";

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

class NftServiceResponseError extends Error {
  constructor(readonly status: number) {
    super(`Internal NFT evidence service returned ${status}.`);
  }
}

async function readService<T>(fetchImpl: typeof fetch, url: string, token: string, timeoutMs: number): Promise<T> {
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new NftServiceResponseError(response.status);
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

function validNonzeroAddress(value: unknown): value is `0x${string}` {
  return validAddress(value) && !isAddressEqual(value, zeroAddress);
}

function validPaymentAsset(value: unknown): boolean {
  if (!isRecord(value) || value.chainId !== 4663 || typeof value.symbol !== "string"
    || !Number.isInteger(value.decimals) || (value.decimals as number) < 0 || (value.decimals as number) > 255) return false;
  if (value.kind === "NATIVE") return value.address === null;
  return value.kind === "ERC20" && typeof value.address === "string" && isAddress(value.address);
}

function safeInlineSvg(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("data:image/svg+xml;base64,")) return false;
  try {
    const encoded = value.slice("data:image/svg+xml;base64,".length);
    if (!encoded || encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return false;
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.byteLength > 256 * 1024 || bytes.toString("base64") !== encoded) return false;
    const svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return isSafeRmtNftInlineSvg(svg);
  } catch {
    return false;
  }
}

function validateMetadata(input: unknown): RmtNftItemMetadata {
  if (!isRecord(input) || input.authority !== "ONCHAIN_TOKEN_URI"
    || !["READY", "UNAVAILABLE", "INVALID", "UNSUPPORTED"].includes(String(input.status))
    || !["DATA_JSON_BASE64", "IPFS", "HTTPS", "OTHER"].includes(String(input.tokenUriKind))
    || (input.metadataDigest !== null && !isHex32(input.metadataDigest))
    || !Array.isArray(input.attributes) || input.attributes.length > 64
    || input.attributes.some((attribute) => !isRecord(attribute) || typeof attribute.traitType !== "string"
      || attribute.traitType.length > 120 || typeof attribute.value !== "string" || attribute.value.length > 500)
    || (input.name !== null && (typeof input.name !== "string" || input.name.length > 200))
    || (input.description !== null && (typeof input.description !== "string" || input.description.length > 2_000))) {
    throw new Error("NFT metadata response is malformed.");
  }
  if (input.status === "READY" && (input.tokenUriKind !== "DATA_JSON_BASE64"
    || input.metadataDigest === null || (input.image !== null && !safeInlineSvg(input.image)))) {
    throw new Error("NFT metadata authority is contradictory.");
  }
  if (input.status !== "READY" && (input.name !== null || input.description !== null || input.image !== null || input.attributes.length !== 0)) {
    throw new Error("Unavailable NFT metadata contains presentation claims.");
  }
  if (input.status === "UNSUPPORTED" && !["IPFS", "HTTPS"].includes(String(input.tokenUriKind))) {
    throw new Error("NFT remote metadata classification is contradictory.");
  }
  return input as unknown as RmtNftItemMetadata;
}

function validateInventoryItem(input: unknown): RmtNftInventoryItem {
  if (!isRecord(input) || !isDecimalInteger(input.tokenId) || !validNonzeroAddress(input.owner)) {
    throw new Error("NFT inventory item is malformed.");
  }
  return { tokenId: input.tokenId, owner: input.owner, metadata: validateMetadata(input.metadata) };
}

function validateInventory(input: unknown, projectId: string, address: `0x${string}`, standard: "ERC721" | "ERC1155", limit: number, afterTokenId?: string) {
  if (!isRecord(input) || input.schemaVersion !== 1 || input.projectId !== projectId || input.chainId !== 4663
    || !sameAddress(input.collectionAddress, address) || input.collectionStandard !== standard
    || !["AVAILABLE", "PARTIAL", "UNAVAILABLE"].includes(String(input.availability))
    || ![null, "SOURCE_BACKFILLING", "SOURCE_ERROR", "SOURCE_STALE"].includes(input.availabilityReason as never)
    || (input.asOf !== null && !isTimestamp(input.asOf)) || !Array.isArray(input.items) || input.items.length > limit
    || (input.nextCursor !== null && !isDecimalInteger(input.nextCursor))) {
    throw new Error("NFT inventory response is malformed.");
  }
  const items = input.items.map(validateInventoryItem);
  for (let index = 1; index < items.length; index++) {
    if (BigInt(items[index - 1]!.tokenId) >= BigInt(items[index]!.tokenId)) throw new Error("NFT inventory ordering is invalid.");
  }
  const coherent = input.availability === "AVAILABLE"
    ? input.availabilityReason === null && input.asOf !== null
      && (afterTokenId === undefined || items.length === 0 || BigInt(items[0]!.tokenId) > BigInt(afterTokenId))
      && (input.nextCursor === null || (items.length > 0 && input.nextCursor === items.at(-1)!.tokenId))
    : input.availability === "PARTIAL"
      ? input.availabilityReason === "SOURCE_BACKFILLING" && items.length === 0 && input.nextCursor === null
      : ["SOURCE_ERROR", "SOURCE_STALE"].includes(String(input.availabilityReason)) && items.length === 0 && input.nextCursor === null;
  if (!coherent) throw new Error("NFT inventory response state is contradictory.");
  return { ...input, items } as unknown as RmtNftProjectInventoryRead;
}

function validateItem(input: unknown, projectId: string, address: `0x${string}`, standard: "ERC721" | "ERC1155", tokenId: string) {
  if (!isRecord(input) || input.schemaVersion !== 1 || input.projectId !== projectId || input.chainId !== 4663
    || !sameAddress(input.collectionAddress, address) || standard !== "ERC721" || input.collectionStandard !== "ERC721"
    || input.tokenId !== tokenId || !isDecimalInteger(input.tokenId) || !validNonzeroAddress(input.owner) || !isTimestamp(input.asOf)
    || !isRecord(input.tokenBoundAccount) || input.tokenBoundAccount.authority !== "ONCHAIN_ERC6551_ACCOUNT"
    || input.tokenBoundAccount.chainId !== 4663 || !sameAddress(input.tokenBoundAccount.collectionAddress, address)
    || input.tokenBoundAccount.tokenId !== tokenId || !validNonzeroAddress(input.tokenBoundAccount.accountAddress)) {
    throw new Error("NFT item response identity mismatch.");
  }
  return { ...input, metadata: validateMetadata(input.metadata) } as unknown as RmtNftItemRead;
}

export type RmtNftInventoryReaderResult = RmtNftProjectInventoryRead | { availability: "UNAVAILABLE"; reason: "DATA_UNAVAILABLE" };
export type RmtNftItemReaderResult = RmtNftItemRead | { availability: "UNAVAILABLE"; reason: "DATA_UNAVAILABLE" };

export type RmtNftInventoryReadRequest = {
  afterTokenId?: string;
  limit?: number;
};

export async function readRmtNftProjectInventory(
  projectId: string,
  request: RmtNftInventoryReadRequest = {},
  options: ReaderOptions = {},
): Promise<RmtNftInventoryReaderResult | null> {
  const project = rmtCuratedNftProject(projectId);
  if (!project || project.status !== "ACTIVE") return null;
  const source = RMT_NFT_ACTIVITY_SOURCES.find((item) => item.projectId === project.projectId);
  if (!source) return null;
  const limit = request.limit ?? 24;
  if (!Number.isInteger(limit) || limit < 1 || limit > 48
    || (request.afterTokenId !== undefined && !isDecimalInteger(request.afterTokenId))) {
    return { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" };
  }
  const config = configuration(options.env ?? process.env, "NFT_INDEXER");
  if (!config) return { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" };
  const query = new URLSearchParams({ limit: String(limit) });
  if (request.afterTokenId !== undefined) query.set("afterTokenId", request.afterTokenId);
  try {
    const raw = await readService<unknown>(options.fetchImpl ?? fetch,
      `${config.url}/internal/v1/projects/${project.projectId}/inventory?${query}`, config.token, options.timeoutMs ?? 5_000);
    return validateInventory(raw, project.projectId, source.collectionAddress, source.standard, limit, request.afterTokenId);
  } catch {
    return { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" };
  }
}

export async function readRmtNftItem(
  projectId: string,
  tokenId: string,
  options: ReaderOptions = {},
): Promise<RmtNftItemReaderResult | null> {
  const project = rmtCuratedNftProject(projectId);
  if (!project || project.status !== "ACTIVE") return null;
  const source = RMT_NFT_ACTIVITY_SOURCES.find((item) => item.projectId === project.projectId);
  if (!source || !isDecimalInteger(tokenId)) return null;
  const config = configuration(options.env ?? process.env, "NFT_INDEXER");
  if (!config) return { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" };
  try {
    const raw = await readService<unknown>(options.fetchImpl ?? fetch,
      `${config.url}/internal/v1/projects/${project.projectId}/items/${tokenId}`, config.token, options.timeoutMs ?? 5_000);
    return validateItem(raw, project.projectId, source.collectionAddress, source.standard, tokenId);
  } catch (error) {
    if (error instanceof NftServiceResponseError && error.status === 404) return null;
    return { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" };
  }
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
  if (["AVAILABLE", "PARTIAL"].includes(value.availability) && value.asOf === null) {
    throw new Error("NFT marketplace current evidence lacks observation provenance.");
  }
  if (value.availabilityReason === "STALE" && value.lowestNormalizedListing !== null) {
    throw new Error("NFT marketplace stale exact-order state contains a current listing.");
  }
  if (value.sourceStatus !== "ERROR" && value.availability === "UNAVAILABLE"
    && !["SOURCE_STALE", "SOURCE_NOT_READY"].includes(value.availabilityReason ?? "")) {
    throw new Error("NFT marketplace unavailable source reason is contradictory.");
  }
  if (value.availabilityReason === "SOURCE_NOT_READY" && value.asOf !== null) {
    throw new Error("NFT marketplace not-ready source has observation provenance.");
  }
  if (value.availabilityReason === "SOURCE_STALE" && value.asOf === null) {
    throw new Error("NFT marketplace stale source lacks historical observation provenance.");
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
