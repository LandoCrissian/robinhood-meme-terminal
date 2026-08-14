import type { StrategySpec } from "../../../packages/agent-core/src/index.ts";
import type { PaperEvaluationMarketSource, PaperEvaluationMarketSourceInput } from "./paper-evaluation.ts";

const ROBINHOOD_CHAIN_ID = 4_663;
const USD_REFERENCE_ASSET_ID = "fiat:USD";
const USD_DECIMALS = 6;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const MAX_DIRECTORY_MARKETS = 5_000;
const MAX_USD_NUMBER = 1e15;

export interface VNextMarketDirectoryReader {
  readonly sourceId: string;
  read(): Promise<unknown>;
}

export interface RobinhoodStockAssetLike {
  assetId: string;
  tokenSymbol: string;
  tokenName: string;
  contractAddress: `0x${string}`;
  currentMultiplier: string;
  status: "active" | "inactive";
  logoUrl?: string | null;
}

export interface RobinhoodStockRegistrySnapshotLike {
  coverage: "complete" | "unavailable";
  assetsByAddress: ReadonlyMap<string, RobinhoodStockAssetLike>;
}

export interface RobinhoodStockRegistryReader {
  readonly sourceId: string;
  read(): Promise<RobinhoodStockRegistrySnapshotLike>;
}

export interface RmtRobinhoodStockMarketSourceConfig { maximumObservations: number; }

type DirectoryMarket = {
  address: string;
  name: string;
  symbol: string;
  dexId?: string;
  pairAddress?: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24h?: number;
  priceChange24h?: number;
  marketCapUsd?: number;
};

type DirectoryResponse = { markets: DirectoryMarket[]; updatedAt: number };

function fail(message: string): never { throw new Error(message); }
function nonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be non-empty`);
  return value.trim();
}
function normalizeAddress(value: string, field: string): string {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value) || /^0x0{40}$/i.test(value)) fail(`${field} must be a nonzero EVM address`);
  return value.toLowerCase();
}
function boundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be non-empty`);
  const normalized = value.trim();
  if (normalized.length > maximum) fail(`${field} exceeds ${maximum} characters`);
  return normalized;
}
function optionalBoundedText(value: unknown, field: string, maximum: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return boundedText(value, field, maximum);
}
function finiteNumber(value: unknown, field: string, minimum: number, maximum = MAX_USD_NUMBER): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${field} must be a finite number from ${minimum} to ${maximum}`);
  return value;
}
function optionalFiniteNumber(value: unknown, field: string, minimum: number, maximum = MAX_USD_NUMBER): number | undefined {
  if (value === undefined || value === null) return undefined;
  return finiteNumber(value, field, minimum, maximum);
}
function usdAtomic(value: number): string {
  finiteNumber(value, "USD value", 0);
  const fixed = value.toFixed(USD_DECIMALS);
  const [whole, fraction = ""] = fixed.split(".");
  return (BigInt(whole!) * 10n ** BigInt(USD_DECIMALS) + BigInt(fraction.padEnd(USD_DECIMALS, "0"))).toString();
}
function parseUpdatedAt(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) fail("RMT market directory updatedAt must be an ISO timestamp");
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail("RMT market directory updatedAt is invalid");
  return parsed;
}
function parseDirectoryMarket(value: unknown, index: number): DirectoryMarket {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`directory markets[${index}] must be an object`);
  const record = value as Record<string, unknown>;
  return {
    address: normalizeAddress(record.address as string, `directory markets[${index}].address`),
    name: boundedText(record.name, `directory markets[${index}].name`, 160),
    symbol: boundedText(record.symbol, `directory markets[${index}].symbol`, 32),
    dexId: optionalBoundedText(record.dexId, `directory markets[${index}].dexId`, 80),
    pairAddress: record.pairAddress === undefined ? undefined : normalizeAddress(record.pairAddress as string, `directory markets[${index}].pairAddress`),
    priceUsd: finiteNumber(record.priceUsd, `directory markets[${index}].priceUsd`, 0),
    liquidityUsd: finiteNumber(record.liquidityUsd, `directory markets[${index}].liquidityUsd`, 0),
    volume24h: optionalFiniteNumber(record.volume24h, `directory markets[${index}].volume24h`, 0),
    priceChange24h: optionalFiniteNumber(record.priceChange24h, `directory markets[${index}].priceChange24h`, -1_000_000, 1_000_000),
    marketCapUsd: optionalFiniteNumber(record.marketCapUsd, `directory markets[${index}].marketCapUsd`, 0),
  };
}
function parseDirectory(value: unknown): DirectoryResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("RMT market directory response must be an object");
  const record = value as Record<string, unknown>;
  if (record.stale === true) fail("RMT market directory is stale");
  if (record.error !== undefined && record.error !== null && String(record.error).trim()) fail("RMT market directory returned an error");
  if (!Array.isArray(record.markets)) fail("RMT market directory markets must be an array");
  if (record.markets.length > MAX_DIRECTORY_MARKETS) fail("RMT market directory exceeds safety maximum");
  return { markets: record.markets.map(parseDirectoryMarket), updatedAt: parseUpdatedAt(record.updatedAt) };
}
function validateRegistry(snapshot: RobinhoodStockRegistrySnapshotLike): Map<string, RobinhoodStockAssetLike> {
  if (snapshot.coverage !== "complete") fail("Robinhood Stock Token registry coverage is unavailable");
  if (!(snapshot.assetsByAddress instanceof Map)) fail("Robinhood Stock Token registry must be address-keyed");
  const active = new Map<string, RobinhoodStockAssetLike>();
  const symbols = new Map<string, string>();
  for (const [key, asset] of snapshot.assetsByAddress.entries()) {
    const address = normalizeAddress(asset.contractAddress, "Robinhood Stock Token contractAddress");
    if (normalizeAddress(key, "Robinhood Stock Token registry key") !== address) fail("Robinhood Stock Token registry key does not match contractAddress");
    nonEmpty(asset.assetId, "Robinhood Stock Token assetId");
    const tokenSymbol = boundedText(asset.tokenSymbol, "Robinhood Stock Token symbol", 24);
    boundedText(asset.tokenName, "Robinhood Stock Token name", 160);
    if (asset.status !== "active" && asset.status !== "inactive") fail("Robinhood Stock Token status is invalid");
    if (asset.status !== "active") continue;
    const symbolKey = tokenSymbol.toLowerCase();
    const previous = symbols.get(symbolKey);
    if (previous && previous !== address) fail(`Robinhood Stock Token symbol is ambiguous: ${tokenSymbol}`);
    symbols.set(symbolKey, address);
    active.set(address, { ...asset, contractAddress: address as `0x${string}`, tokenSymbol });
  }
  return active;
}
function canonicalAssetId(asset: RobinhoodStockAssetLike): string {
  return `eip155:${ROBINHOOD_CHAIN_ID}/contract:${asset.contractAddress.toLowerCase()}`;
}
function identityKeys(asset: RobinhoodStockAssetLike): Set<string> {
  return new Set([asset.tokenSymbol, asset.assetId, asset.contractAddress, canonicalAssetId(asset)].map((value) => value.toLowerCase()));
}
function strategyAllowsAsset(strategy: StrategySpec, asset: RobinhoodStockAssetLike): boolean {
  const keys = identityKeys(asset);
  const include = strategy.universe.includeAssets?.map((value) => value.toLowerCase()) ?? [];
  const exclude = strategy.universe.excludeAssets?.map((value) => value.toLowerCase()) ?? [];
  if (include.length > 0 && !include.some((value) => keys.has(value))) return false;
  if (exclude.some((value) => keys.has(value))) return false;
  return true;
}
function observationFor(market: DirectoryMarket, asset: RobinhoodStockAssetLike) {
  const features: Record<string, string | number | boolean> = {
    assetClass: "RWA",
    contractAddress: asset.contractAddress.toLowerCase(),
    registryAssetId: asset.assetId,
    registrySymbol: asset.tokenSymbol,
  };
  if (market.dexId !== undefined) features.dexId = market.dexId;
  if (market.pairAddress !== undefined) features.pairAddress = market.pairAddress;
  if (market.priceChange24h !== undefined) features.priceChange24h = market.priceChange24h;
  if (market.volume24h !== undefined) features.volume24hUsdAtomic6 = usdAtomic(market.volume24h);
  if (market.marketCapUsd !== undefined) features.marketCapUsdAtomic6 = usdAtomic(market.marketCapUsd);
  return {
    assetId: canonicalAssetId(asset),
    quoteAssetId: USD_REFERENCE_ASSET_ID,
    referencePriceAtomic: usdAtomic(market.priceUsd),
    referencePriceDecimals: USD_DECIMALS,
    liquidityUsdAtomic: usdAtomic(market.liquidityUsd),
    liquidityUsdDecimals: USD_DECIMALS,
    features,
  };
}

export class RmtRobinhoodStockMarketSource implements PaperEvaluationMarketSource {
  readonly sourceId: string;
  private readonly directory: VNextMarketDirectoryReader;
  private readonly stockRegistry: RobinhoodStockRegistryReader;
  private readonly config: RmtRobinhoodStockMarketSourceConfig;

  constructor(input: { directory: VNextMarketDirectoryReader; stockRegistry: RobinhoodStockRegistryReader; config: RmtRobinhoodStockMarketSourceConfig }) {
    this.directory = input.directory;
    this.stockRegistry = input.stockRegistry;
    this.config = structuredClone(input.config);
    nonEmpty(this.directory.sourceId, "directory sourceId");
    nonEmpty(this.stockRegistry.sourceId, "stock registry sourceId");
    if (!Number.isInteger(this.config.maximumObservations) || this.config.maximumObservations <= 0 || this.config.maximumObservations > 256) fail("maximumObservations must be an integer from 1 to 256");
    this.sourceId = `${this.directory.sourceId}+${this.stockRegistry.sourceId}:rwa-v1`;
  }

  async capture(input: PaperEvaluationMarketSourceInput): Promise<unknown> {
    if (!input.strategy.universe.assetClasses.includes("RWA")) fail("RMT Robinhood stock source requires RWA strategy scope");
    if (input.strategy.universe.assetClasses.some((assetClass) => assetClass !== "RWA")) fail("RMT Robinhood stock source does not classify COMMUNITY assets");

    const [directoryRaw, registrySnapshot] = await Promise.all([this.directory.read(), this.stockRegistry.read()]);
    const directory = parseDirectory(directoryRaw);
    const activeStockAssets = validateRegistry(registrySnapshot);
    const minimumLiquidity = input.strategy.universe.minimumLiquidityUsd ?? 0;
    const candidates = directory.markets
      .filter((market) => market.priceUsd > 0)
      .map((market) => ({ market, asset: activeStockAssets.get(market.address) }))
      .filter((entry): entry is { market: DirectoryMarket; asset: RobinhoodStockAssetLike } => Boolean(entry.asset))
      .filter(({ market, asset }) => market.liquidityUsd >= minimumLiquidity && strategyAllowsAsset(input.strategy, asset))
      .sort((left, right) => right.market.liquidityUsd - left.market.liquidityUsd || (right.market.volume24h ?? 0) - (left.market.volume24h ?? 0) || left.asset.contractAddress.localeCompare(right.asset.contractAddress));
    const unique = new Map<string, { market: DirectoryMarket; asset: RobinhoodStockAssetLike }>();
    for (const candidate of candidates) {
      const key = candidate.asset.contractAddress.toLowerCase();
      if (!unique.has(key)) unique.set(key, candidate);
    }
    const selected = [...unique.values()].slice(0, this.config.maximumObservations);
    if (selected.length === 0) fail("no verified Robinhood Stock Token markets satisfy the strategy");
    return { chainId: ROBINHOOD_CHAIN_ID, capturedAt: directory.updatedAt, observations: selected.map(({ market, asset }) => observationFor(market, asset)) };
  }
}