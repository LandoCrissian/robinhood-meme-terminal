import { getAddress, isAddress, zeroAddress } from "viem";
import { z } from "zod";
import type { RobinhoodStockAssetRelationship } from "../external-market";

export const ROBINHOOD_STOCK_ASSET_REGISTRY = "https://api.robinhood.com/rhj/assets";
const ROBINHOOD_CHAIN_ID = 4663;
const CACHE_MS = 5 * 60_000;

const deploymentSchema = z.object({
  contractAddress: z.string().refine(isAddress),
  chainId: z.number().int().positive()
});

const assetSchema = z.object({
  id: z.string().min(3).max(100),
  tokenSymbol: z.string().trim().min(1).max(24),
  tokenName: z.string().trim().min(1).max(160),
  deployments: z.array(deploymentSchema).max(30),
  currentMultiplier: z.string().regex(/^\d+(?:\.\d+)?$/),
  status: z.enum(["ASSET_STATUS_ACTIVE", "ASSET_STATUS_INACTIVE", "ASSET_STATUS_UNSPECIFIED"]),
  logoUrl: z.string().url().max(500).optional()
}).passthrough();

const responseSchema = z.object({
  assets: z.array(assetSchema).max(1_000)
});

export type RobinhoodStockAsset = {
  assetId: string;
  tokenSymbol: string;
  tokenName: string;
  contractAddress: `0x${string}`;
  currentMultiplier: string;
  status: "active" | "inactive";
  logoUrl: string | null;
};

export type RobinhoodStockRegistrySnapshot = {
  coverage: "complete" | "unavailable";
  assetsByAddress: Map<string, RobinhoodStockAsset>;
};

export type VNextStockTokenExecutionAssets = {
  inputAsset: string;
  outputAsset: string;
};

export type RobinhoodStockRegistryReader = () => Promise<RobinhoodStockRegistrySnapshot>;

export type StockTokenExecutionPolicy =
  | { status: "eligible" }
  | { status: "view-only"; asset: RobinhoodStockAsset }
  | { status: "verification-unavailable" };

export class StockTokenExecutionPolicyError extends Error {
  constructor(
    message: string,
    readonly status: 451 | 503
  ) {
    super(message);
    this.name = "StockTokenExecutionPolicyError";
  }
}

let cached: { expiresAt: number; snapshot: RobinhoodStockRegistrySnapshot } | undefined;

function safeRobinhoodLogo(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "cdn.robinhood.com" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseRobinhoodStockAssets(payload: unknown) {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw new Error("Robinhood Stock Token registry returned invalid data.");
  const assets = new Map<string, RobinhoodStockAsset>();
  for (const asset of parsed.data.assets) {
    const deployment = asset.deployments.find((candidate) => candidate.chainId === ROBINHOOD_CHAIN_ID);
    if (!deployment) continue;
    const contractAddress = getAddress(deployment.contractAddress);
    assets.set(contractAddress.toLowerCase(), {
      assetId: asset.id,
      tokenSymbol: asset.tokenSymbol,
      tokenName: asset.tokenName,
      contractAddress,
      currentMultiplier: asset.currentMultiplier,
      status: asset.status === "ASSET_STATUS_ACTIVE" ? "active" : "inactive",
      logoUrl: safeRobinhoodLogo(asset.logoUrl)
    });
  }
  return assets;
}

export async function fetchRobinhoodStockRegistry(): Promise<RobinhoodStockRegistrySnapshot> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.snapshot;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(ROBINHOOD_STOCK_ASSET_REGISTRY, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Robinhood Stock Token registry returned ${response.status}.`);
    const snapshot = {
      coverage: "complete" as const,
      assetsByAddress: parseRobinhoodStockAssets(await response.json())
    };
    cached = { expiresAt: now + CACHE_MS, snapshot };
    return snapshot;
  } catch {
    if (cached) return cached.snapshot;
    return { coverage: "unavailable", assetsByAddress: new Map() };
  } finally {
    clearTimeout(timeout);
  }
}

export function stockTokenExecutionPolicyFromSnapshot(
  token: string,
  snapshot: RobinhoodStockRegistrySnapshot
): StockTokenExecutionPolicy {
  if (snapshot.coverage !== "complete") return { status: "verification-unavailable" };
  const asset = snapshot.assetsByAddress.get(token.toLowerCase());
  return asset ? { status: "view-only", asset } : { status: "eligible" };
}

export async function stockTokenExecutionPolicy(token: string): Promise<StockTokenExecutionPolicy> {
  return stockTokenExecutionPolicyFromSnapshot(token, await fetchRobinhoodStockRegistry());
}

export async function requireStockTokenExecutionEligible(token: string) {
  const policy = await stockTokenExecutionPolicy(token);
  if (policy.status === "verification-unavailable") {
    throw new StockTokenExecutionPolicyError(
      "Robinhood Stock Token identity verification is temporarily unavailable.",
      503
    );
  }
  if (policy.status === "view-only") {
    throw new StockTokenExecutionPolicyError(
      "Official Robinhood Stock Tokens are view-only in RMT until jurisdiction controls are available.",
      451
    );
  }
  return policy;
}

export async function requireVNextStockTokenExecutionEligible(
  assets: VNextStockTokenExecutionAssets,
  readSnapshot: RobinhoodStockRegistryReader = fetchRobinhoodStockRegistry
) {
  const snapshot = await readSnapshot();
  if (snapshot.coverage !== "complete") {
    throw new StockTokenExecutionPolicyError(
      "Robinhood Stock Token identity verification is temporarily unavailable.",
      503
    );
  }
  const exactTradeAssets = [...new Set([
    getAddress(assets.inputAsset),
    getAddress(assets.outputAsset)
  ].filter((asset) => asset !== zeroAddress))];
  for (const asset of exactTradeAssets) {
    const policy = stockTokenExecutionPolicyFromSnapshot(asset, snapshot);
    if (policy.status === "view-only") {
      throw new StockTokenExecutionPolicyError(
        "Official Robinhood Stock Tokens are view-only in RMT until jurisdiction controls are available.",
        451
      );
    }
  }
  return { status: "eligible" as const };
}

export function stockTokenExecutionPolicyErrorResponse(cause: unknown) {
  if (!(cause instanceof StockTokenExecutionPolicyError)) return null;
  return Response.json(
    { error: cause.message },
    { status: cause.status, headers: { "Cache-Control": "no-store" } }
  );
}

function relationship(
  asset: RobinhoodStockAsset,
  kind: RobinhoodStockAssetRelationship["relationship"]
): RobinhoodStockAssetRelationship {
  return {
    relationship: kind,
    ...asset,
    provenance: "robinhood-live-asset-registry"
  };
}

export function stockAssetRelationshipsForToken(
  selectedToken: string,
  assetsByAddress: ReadonlyMap<string, RobinhoodStockAsset>
) {
  if (!isAddress(selectedToken, { strict: false })) return [];
  const asset = assetsByAddress.get(getAddress(selectedToken).toLowerCase());
  return asset ? [relationship(asset, "canonical-stock-token")] : [];
}

export function stockAssetRelationshipsForPair(
  displayedToken: string,
  baseToken: string,
  quoteToken: string,
  assetsByAddress: ReadonlyMap<string, RobinhoodStockAsset>
) {
  const displayed = displayedToken.toLowerCase();
  const base = assetsByAddress.get(baseToken.toLowerCase());
  const quote = assetsByAddress.get(quoteToken.toLowerCase());
  const relationships: RobinhoodStockAssetRelationship[] = [
    ...stockAssetRelationshipsForToken(displayedToken, assetsByAddress)
  ];
  for (const asset of [base, quote]) {
    if (!asset || asset.contractAddress.toLowerCase() === displayed) continue;
    relationships.push(relationship(asset, "paired-market-asset"));
  }
  return [...new Map(relationships.map((item) => [
    `${item.relationship}:${item.contractAddress.toLowerCase()}`,
    item
  ])).values()];
}
